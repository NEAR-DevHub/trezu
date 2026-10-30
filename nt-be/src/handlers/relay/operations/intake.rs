//! The durable request path: persist the operation with its credit, drive it
//! for a bounded time, and answer `200`, the confirmed error, or `202`.

use std::{sync::Arc, time::Duration};

use axum::{
    Json,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};

use crate::{
    AppState,
    auth::AuthUser,
    config::plans::PlanType,
    handlers::relay::{
        access::AuthorizedRelay,
        effects::accounting,
        parse::{
            RelayError, RelayOperation as DaoOperation, RelaySubmission, error_response,
            success_response,
        },
    },
    utils::api_error::ApiError,
};

use super::{
    engine::{
        HANDLER_DRIVE_BUDGET, HANDLER_RESPONSE_BUDGET, OPERATION_LEASE, RelayEngine,
        delegate_max_block_height,
    },
    models::{
        IdempotencyKey, NewRelayOperation, OperationKind, OperationState, RelayOperation,
        RelaySubmissionStatus,
    },
    rpc::RelayRpc,
    store::RelayStore,
};

/// A delegate action closer than this to its `max_block_height` is sent back
/// for a fresh signature: the worker cannot rescue an expired signature.
const DELEGATE_EXPIRY_MARGIN_BLOCKS: u64 = 20;
const STATUS_POLL: Duration = Duration::from_millis(300);

fn db_error(error: impl std::fmt::Display) -> RelayError {
    error_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("Database error: {error}"),
    )
}

pub async fn submit(
    state: &Arc<AppState>,
    auth_user: &AuthUser,
    raw_payload: Vec<u8>,
    authorized: AuthorizedRelay,
    proposal_type: Option<String>,
    address_book_payment: bool,
) -> Result<Response, RelayError> {
    let AuthorizedRelay {
        treasury_id,
        submission,
        operation,
        plan_type,
        ..
    } = authorized;

    if matches!(submission, RelaySubmission::MetaTransaction(_))
        && let Some(max_block_height) = delegate_max_block_height(&raw_payload)
    {
        let height = RelayRpc::from_state(state)
            .block_height()
            .await
            .map_err(|error| {
                error_response(StatusCode::BAD_GATEWAY, format!("block height: {error}"))
            })?;
        if max_block_height < height + DELEGATE_EXPIRY_MARGIN_BLOCKS {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                format!(
                    "delegate action expires at block {max_block_height}, head is {height}: sign again"
                ),
            ));
        }
    }

    let operation_kind = match (&submission, &operation) {
        (RelaySubmission::WalletContract(_), _) => OperationKind::WalletReplay,
        (_, DaoOperation::AddProposals(_)) => OperationKind::AddProposal,
        (_, DaoOperation::Votes(_)) => OperationKind::ActProposal,
    };
    let new = NewRelayOperation {
        idempotency_key: IdempotencyKey::derive(&treasury_id, &auth_user.account_id, &raw_payload),
        treasury_id: treasury_id.clone(),
        actor_account_id: auth_user.account_id.clone(),
        operation_kind,
        submission_payload: raw_payload,
        credit_reserved: plan_type != PlanType::Enterprise,
        proposal_type,
        address_book_payment,
    };

    let mut tx = state.db_pool.begin().await.map_err(db_error)?;
    let inserted = RelayStore::insert_or_load_operation(&mut tx, new)
        .await
        .map_err(db_error)?;
    if inserted.inserted {
        accounting::reserve_gas_credit(&mut *tx, &treasury_id, plan_type).await?;
    }
    tx.commit().await.map_err(db_error)?;

    let operation = inserted.operation;
    if !inserted.inserted {
        tracing::info!(
            submission_id = %operation.id,
            state = %operation.state,
            "relay request matched an existing operation"
        );
    }
    let latest = if operation.state.is_terminal() {
        operation
    } else {
        drive_until_terminal(state, operation).await?
    };
    respond(state, latest).await
}

/// Run the operation on a task of its own that keeps going up to
/// [`HANDLER_DRIVE_BUDGET`], but answer once [`HANDLER_RESPONSE_BUDGET`] has
/// passed; whatever the task has not finished by then continues under its
/// lease and, after that, in the worker.
async fn drive_until_terminal(
    state: &Arc<AppState>,
    operation: RelayOperation,
) -> Result<RelayOperation, RelayError> {
    let store = RelayStore::new(&state.db_pool);
    let Some(claimed) = store
        .claim_operation(operation.id, OPERATION_LEASE)
        .await
        .map_err(db_error)?
    else {
        return await_terminal(state, operation, HANDLER_RESPONSE_BUDGET).await;
    };
    let engine = RelayEngine::new(state.clone());
    let mut driver = tokio::spawn(async move {
        engine
            .run_operation(claimed, HANDLER_DRIVE_BUDGET)
            .await
            .into_operation()
    });
    match tokio::time::timeout(HANDLER_RESPONSE_BUDGET, &mut driver).await {
        Ok(Ok(latest)) => Ok(latest),
        Ok(Err(join_error)) => Err(db_error(format!("relay driver failed: {join_error}"))),
        Err(_elapsed) => Ok(store
            .operation(operation.id)
            .await
            .map_err(db_error)?
            .unwrap_or(operation)),
    }
}

/// Another holder owns the operation: watch it until it ends or the budget
/// does.
async fn await_terminal(
    state: &Arc<AppState>,
    mut operation: RelayOperation,
    budget: Duration,
) -> Result<RelayOperation, RelayError> {
    let started = std::time::Instant::now();
    let store = RelayStore::new(&state.db_pool);
    while !operation.state.is_terminal() && started.elapsed() < budget {
        tokio::time::sleep(STATUS_POLL).await;
        operation = store
            .operation(operation.id)
            .await
            .map_err(db_error)?
            .unwrap_or(operation);
    }
    Ok(operation)
}

async fn respond(state: &Arc<AppState>, operation: RelayOperation) -> Result<Response, RelayError> {
    let transactions = RelayStore::new(&state.db_pool)
        .transactions_of(operation.id)
        .await
        .map_err(db_error)?;
    let status = RelaySubmissionStatus::from_rows(&operation, &transactions);
    match operation.state {
        OperationState::Succeeded => {
            let proposal_ids = status.proposal_ids.filter(|ids| !ids.is_empty());
            Ok(success_response(proposal_ids, status.tx_hash.unwrap_or_default()).into_response())
        }
        OperationState::Failed => Err(operation
            .failure()
            .map(|failure| failure.api_error(status.tx_hash.clone()))
            .unwrap_or_else(|| ApiError::rejected_before_send(StatusCode::INTERNAL_SERVER_ERROR))),
        OperationState::ManualReview => Err(ApiError::tx_status_unknown(status.tx_hash.clone())),
        OperationState::Pending => Ok((
            StatusCode::ACCEPTED,
            [
                (
                    header::LOCATION,
                    format!("/api/relay/submissions/{}", operation.id),
                ),
                (header::RETRY_AFTER, "2".to_owned()),
            ],
            Json(status),
        )
            .into_response()),
    }
}

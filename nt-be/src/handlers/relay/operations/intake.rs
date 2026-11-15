//! The durable request path: record the signed action, wake the worker, and
//! watch the row. The request makes no chain or provider call; it answers
//! `200`, the confirmed error, or `202` with the submission id.

use std::{sync::Arc, time::Duration};

use axum::{
    Json,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};

use crate::{
    AppState,
    auth::AuthUser,
    handlers::relay::{
        access,
        parse::{
            ParsedRelay, RelayError, RelayOperation as DaoOperation, RelaySubmission,
            error_response, success_response,
        },
    },
    utils::api_error::ApiError,
};

use super::{
    models::{
        IdempotencyKey, NewRelayOperation, OperationKind, OperationState, RelayOperation,
        RelayProposalType, RelaySubmissionStatus,
    },
    store::RelayStore,
};

/// How long the request watches its operation before answering `202`.
const RESPONSE_BUDGET: Duration = Duration::from_secs(12);
const STATUS_POLL: Duration = Duration::from_millis(200);
/// Operations one account may have waiting for authorization. Bounds what a
/// single session can store before anything has been checked.
const MAX_UNAUTHORIZED_PER_ACTOR: i64 = 100;

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
    parsed: ParsedRelay,
    proposal_type: Option<RelayProposalType>,
) -> Result<Response, RelayError> {
    access::bind_signer(auth_user, &parsed.submission)?;

    let operation_kind = match (&parsed.submission, &parsed.operation) {
        (RelaySubmission::WalletContract(_), _) => OperationKind::WalletReplay,
        (_, DaoOperation::AddProposals(_)) => OperationKind::AddProposal,
        (_, DaoOperation::Votes(_)) => OperationKind::ActProposal,
    };
    let new = NewRelayOperation {
        idempotency_key: IdempotencyKey::derive(
            &parsed.treasury_id,
            &auth_user.account_id,
            &raw_payload,
        ),
        treasury_id: parsed.treasury_id,
        actor_account_id: auth_user.account_id.clone(),
        operation_kind,
        submission_payload: raw_payload,
        proposal_type,
    };

    let store = RelayStore::new(&state.db_pool);
    let existing = store
        .operation_by_key(new.idempotency_key.as_str())
        .await
        .map_err(db_error)?;
    let operation = match existing {
        Some(operation) => {
            tracing::info!(
                submission_id = %operation.id,
                state = %operation.state,
                "relay request matched an existing operation"
            );
            operation
        }
        None => {
            let mut tx = state.db_pool.begin().await.map_err(db_error)?;
            let waiting = RelayStore::unauthorized_count(&mut tx, auth_user.account_id.as_str())
                .await
                .map_err(db_error)?;
            if waiting >= MAX_UNAUTHORIZED_PER_ACTOR {
                return Err(error_response(
                    StatusCode::TOO_MANY_REQUESTS,
                    format!("{waiting} submissions are already waiting for this account"),
                ));
            }
            let operation = RelayStore::insert_or_load_operation(&mut tx, new)
                .await
                .map_err(db_error)?;
            tx.commit().await.map_err(db_error)?;
            state.relay_wake.notify_one();
            operation
        }
    };

    let latest = await_terminal(state, operation).await?;
    respond(state, latest).await
}

/// Watch the row until the worker ends it or the response budget runs out.
async fn await_terminal(
    state: &Arc<AppState>,
    mut operation: RelayOperation,
) -> Result<RelayOperation, RelayError> {
    let started = std::time::Instant::now();
    let store = RelayStore::new(&state.db_pool);
    while !operation.state.is_terminal() && started.elapsed() < RESPONSE_BUDGET {
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

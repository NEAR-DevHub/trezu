//! Operator endpoints under `/internal/api/relay`, behind the admin login:
//! see what is unfinished, run a waiting operation now, and put a parked one
//! back to work.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    AppState,
    handlers::warnings::admin::{AdminError, require_admin},
};

use super::{
    models::{OperationKind, OperationStage, OperationState, RelayOperation, RelayTransaction},
    store::{RelayStore, RelayStoreError},
};

const UNFINISHED_LIMIT: i64 = 100;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatorTransaction {
    pub step: String,
    pub state: super::models::TransactionState,
    pub tx_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// An operation as an operator needs to see it: where it is, since when, and
/// what it last ran into.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatorSubmission {
    pub submission_id: Uuid,
    pub treasury_id: String,
    pub actor_account_id: String,
    pub kind: OperationKind,
    pub state: OperationState,
    pub stage: OperationStage,
    pub stage_entered_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub next_attempt_at: DateTime<Utc>,
    pub being_worked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub transactions: Vec<OperatorTransaction>,
}

impl OperatorSubmission {
    fn from_rows(operation: RelayOperation, transactions: Vec<RelayTransaction>) -> Self {
        Self {
            submission_id: operation.id,
            treasury_id: operation.treasury_id.to_string(),
            actor_account_id: operation.actor_account_id.to_string(),
            kind: operation.operation_kind,
            state: operation.state,
            stage: operation.stage,
            stage_entered_at: operation.stage_entered_at,
            created_at: operation.created_at,
            next_attempt_at: operation.next_attempt_at,
            being_worked: operation
                .lease_until
                .is_some_and(|until| until > Utc::now()),
            failure_code: operation.failure_code,
            last_error: operation.last_error,
            transactions: transactions
                .into_iter()
                .map(|tx| OperatorTransaction {
                    step: tx.step_key.to_string(),
                    state: tx.state,
                    tx_hash: tx.tx_hash,
                    last_error: tx.last_error,
                })
                .collect(),
        }
    }

    async fn load(store: &RelayStore<'_>, id: Uuid) -> Result<Self, OperatorError> {
        let operation = store
            .operation(id)
            .await?
            .ok_or_else(|| refuse(StatusCode::NOT_FOUND, "unknown submission"))?;
        let transactions = store.transactions_of(id).await?;
        Ok(Self::from_rows(operation, transactions))
    }
}

/// Why an operator request was not carried out.
pub enum OperatorError {
    Login(AdminError),
    Refused(StatusCode, String),
}

impl From<AdminError> for OperatorError {
    fn from(error: AdminError) -> Self {
        Self::Login(error)
    }
}

impl From<RelayStoreError> for OperatorError {
    fn from(error: RelayStoreError) -> Self {
        Self::Refused(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
    }
}

impl IntoResponse for OperatorError {
    fn into_response(self) -> Response {
        match self {
            Self::Login(error) => error.into_response(),
            Self::Refused(status, message) => {
                (status, Json(json!({ "error": message }))).into_response()
            }
        }
    }
}

fn refuse(status: StatusCode, message: impl Into<String>) -> OperatorError {
    OperatorError::Refused(status, message.into())
}

/// Every operation that is not finished: still pending, or parked for review.
pub async fn list_unfinished(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<OperatorSubmission>>, OperatorError> {
    require_admin(&headers, &state)?;
    let store = RelayStore::new(&state.db_pool);
    let mut submissions = Vec::new();
    for operation in store.unfinished(UNFINISHED_LIMIT).await? {
        let transactions = store.transactions_of(operation.id).await?;
        submissions.push(OperatorSubmission::from_rows(operation, transactions));
    }
    Ok(Json(submissions))
}

pub async fn get_submission(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(submission_id): Path<Uuid>,
) -> Result<Json<OperatorSubmission>, OperatorError> {
    require_admin(&headers, &state)?;
    let store = RelayStore::new(&state.db_pool);
    Ok(Json(OperatorSubmission::load(&store, submission_id).await?))
}

/// Run a pending operation's current stage now instead of at its next
/// scheduled attempt.
pub async fn retrigger(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(submission_id): Path<Uuid>,
) -> Result<Json<OperatorSubmission>, OperatorError> {
    let admin = require_admin(&headers, &state)?;
    let store = RelayStore::new(&state.db_pool);
    let current = OperatorSubmission::load(&store, submission_id).await?;
    if !store.retrigger(submission_id).await? {
        return Err(refuse(
            StatusCode::CONFLICT,
            match current.state {
                OperationState::ManualReview => {
                    "the operation is parked for review; resume it instead".to_owned()
                }
                finished => format!("the operation is already {finished}"),
            },
        ));
    }
    state.relay_wake.notify_one();
    tracing::info!(
        admin = %admin.username,
        submission_id = %submission_id,
        stage = %current.stage,
        "relay operation retriggered by an operator"
    );
    Ok(Json(OperatorSubmission::load(&store, submission_id).await?))
}

/// Put an operation parked for review back to work in the stage it stopped in.
pub async fn resume(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(submission_id): Path<Uuid>,
) -> Result<Json<OperatorSubmission>, OperatorError> {
    let admin = require_admin(&headers, &state)?;
    let store = RelayStore::new(&state.db_pool);
    let current = OperatorSubmission::load(&store, submission_id).await?;
    if current.state != OperationState::ManualReview {
        return Err(refuse(
            StatusCode::CONFLICT,
            format!("the operation is {}, not parked for review", current.state),
        ));
    }
    if !store.resume_from_review(submission_id).await? {
        return Err(refuse(
            StatusCode::CONFLICT,
            "the treasury has no gas credit left to take for this operation",
        ));
    }
    state.relay_wake.notify_one();
    tracing::info!(
        admin = %admin.username,
        submission_id = %submission_id,
        stage = %current.stage,
        "parked relay operation resumed by an operator"
    );
    Ok(Json(OperatorSubmission::load(&store, submission_id).await?))
}

#[cfg(test)]
mod tests {
    use axum::http::header::AUTHORIZATION;
    use base64::Engine as _;
    use near_api::AccountId;
    use sqlx::PgPool;

    use super::*;
    use crate::{
        handlers::relay::operations::models::{
            IdempotencyKey, NewRelayOperation, OperationLease, OperationOutcome,
        },
        utils::{admin_auth::AdminCredential, test_utils::build_test_state},
    };

    const DAO: &str = "operator.sputnik-dao.near";
    const LEASE: std::time::Duration = std::time::Duration::from_secs(30);

    fn state(pool: &PgPool) -> Arc<AppState> {
        let mut state = build_test_state(pool.clone());
        state.env_vars.admin_users = vec![AdminCredential {
            username: "ops".to_owned(),
            password: "secret".to_owned(),
        }];
        Arc::new(state)
    }

    fn login() -> HeaderMap {
        let mut headers = HeaderMap::new();
        let token = base64::engine::general_purpose::STANDARD.encode("ops:secret");
        headers.insert(AUTHORIZATION, format!("Basic {token}").parse().unwrap());
        headers
    }

    async fn seed_treasury(pool: &PgPool, credits: i32) {
        sqlx::query(
            "INSERT INTO monitored_accounts (account_id, enabled, gas_covered_transactions) VALUES ($1, true, $2)",
        )
        .bind(DAO)
        .bind(credits)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn credits(pool: &PgPool) -> i32 {
        sqlx::query_scalar(
            "SELECT gas_covered_transactions FROM monitored_accounts WHERE account_id = $1",
        )
        .bind(DAO)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// An authorized operation in the relay stage, held under a lease.
    async fn claimed(pool: &PgPool, payload: &[u8]) -> (Uuid, OperationLease) {
        let treasury_id: AccountId = DAO.parse().unwrap();
        let actor: AccountId = "alice.near".parse().unwrap();
        let mut conn = pool.acquire().await.unwrap();
        let id = RelayStore::insert_or_load_operation(
            &mut conn,
            NewRelayOperation {
                idempotency_key: IdempotencyKey::derive(&treasury_id, &actor, payload),
                treasury_id,
                actor_account_id: actor,
                operation_kind: OperationKind::AddProposal,
                submission_payload: payload.to_vec(),
                proposal_type: None,
            },
        )
        .await
        .unwrap()
        .id;
        let lease = RelayStore::new(pool)
            .claim_operation(id, LEASE)
            .await
            .unwrap()
            .unwrap()
            .lease()
            .unwrap();
        RelayStore::advance_stage_on(
            &mut conn,
            &lease,
            OperationStage::Authorize,
            OperationStage::Relay,
            Some(true),
        )
        .await
        .unwrap();
        (id, lease)
    }

    async fn park(pool: &PgPool, lease: &OperationLease) {
        let mut conn = pool.acquire().await.unwrap();
        RelayStore::complete_operation(
            &mut conn,
            lease,
            &OperationOutcome::ManualReview {
                reason: "rows contradict".to_owned(),
            },
        )
        .await
        .unwrap();
    }

    fn done<T>(result: Result<Json<T>, OperatorError>) -> T {
        match result {
            Ok(Json(value)) => value,
            Err(error) => panic!("refused with {}", error.into_response().status()),
        }
    }

    fn status_of<T>(result: Result<Json<T>, OperatorError>) -> StatusCode {
        match result {
            Ok(_) => StatusCode::OK,
            Err(error) => error.into_response().status(),
        }
    }

    #[sqlx::test]
    async fn every_endpoint_needs_the_admin_login(pool: PgPool) {
        let state = state(&pool);
        let (id, _) = claimed(&pool, b"guarded").await;
        let anonymous = HeaderMap::new();
        assert_eq!(
            status_of(list_unfinished(State(state.clone()), anonymous.clone()).await),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status_of(get_submission(State(state.clone()), anonymous.clone(), Path(id)).await),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status_of(retrigger(State(state.clone()), anonymous.clone(), Path(id)).await),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status_of(resume(State(state), anonymous, Path(id)).await),
            StatusCode::UNAUTHORIZED
        );
    }

    #[sqlx::test]
    async fn retrigger_makes_a_deferred_operation_due_now(pool: PgPool) {
        let state = state(&pool);
        let store = RelayStore::new(&pool);
        let (id, lease) = claimed(&pool, b"deferred").await;
        store
            .defer_operation(
                &lease,
                Utc::now() + chrono::Duration::hours(1),
                Some("provider slow"),
            )
            .await
            .unwrap();
        assert!(
            store
                .claim_due_operations(10, LEASE)
                .await
                .unwrap()
                .is_empty()
        );

        let view = done(retrigger(State(state.clone()), login(), Path(id)).await);
        assert_eq!(view.stage, OperationStage::Relay, "it stays in its stage");
        assert_eq!(view.last_error.as_deref(), Some("provider slow"));
        assert!(view.next_attempt_at <= Utc::now());
        let due = store.claim_due_operations(10, LEASE).await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, id);

        assert_eq!(
            status_of(retrigger(State(state), login(), Path(Uuid::new_v4())).await),
            StatusCode::NOT_FOUND
        );
    }

    #[sqlx::test]
    async fn resume_puts_a_parked_operation_back_and_takes_its_credit(pool: PgPool) {
        seed_treasury(&pool, 1).await;
        let state = state(&pool);
        let (id, lease) = claimed(&pool, b"parked").await;
        assert_eq!(
            status_of(resume(State(state.clone()), login(), Path(id)).await),
            StatusCode::CONFLICT,
            "only a parked operation is resumed"
        );
        park(&pool, &lease).await;
        assert_eq!(
            status_of(retrigger(State(state.clone()), login(), Path(id)).await),
            StatusCode::CONFLICT,
            "a parked operation is resumed, not retriggered"
        );

        let listed = done(list_unfinished(State(state.clone()), login()).await);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].state, OperationState::ManualReview);
        assert_eq!(listed[0].last_error.as_deref(), Some("rows contradict"));

        let view = done(resume(State(state.clone()), login(), Path(id)).await);
        assert_eq!(view.state, OperationState::Pending);
        assert_eq!(view.stage, OperationStage::Relay, "where it stopped");
        assert_eq!(credits(&pool).await, 0, "the credit is taken again");

        let claimed = RelayStore::new(&pool)
            .claim_operation(id, LEASE)
            .await
            .unwrap()
            .unwrap();
        park(&pool, &claimed.lease().unwrap()).await;
        assert_eq!(
            status_of(resume(State(state.clone()), login(), Path(id)).await),
            StatusCode::CONFLICT,
            "no credit left, so it stays parked"
        );
        let still = done(get_submission(State(state), login(), Path(id)).await);
        assert_eq!(still.state, OperationState::ManualReview);
    }

    #[sqlx::test]
    async fn the_list_leaves_out_finished_operations(pool: PgPool) {
        seed_treasury(&pool, 5).await;
        let state = state(&pool);
        let (pending, _) = claimed(&pool, b"pending").await;
        let (_, lease) = claimed(&pool, b"finished").await;
        let mut conn = pool.acquire().await.unwrap();
        RelayStore::complete_operation(
            &mut conn,
            &lease,
            &OperationOutcome::Succeeded {
                proposal_ids: vec![1],
            },
        )
        .await
        .unwrap();

        let listed = done(list_unfinished(State(state), login()).await);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].submission_id, pending);
        assert!(listed[0].being_worked, "its claim is still live");
    }
}

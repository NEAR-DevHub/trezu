//! The relay worker. A loop in every backend process claims due operations
//! and runs each one, on a task of its own, through its stages (see
//! [`super::stages`]) until it is terminal or has to wait. The request path
//! only inserts the row and wakes this loop.

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use bigdecimal::Zero;
use chrono::Utc;
use sqlx::PgConnection;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use crate::{
    AppState, error_event,
    error_event::ErrorCode,
    handlers::intents::confidential::{
        bronze::mark_confidential_history_activity_due,
        proposal_signals::record_confidential_intent_execution,
    },
    services::platform_metrics::{self, PlatformMetric},
};

use super::{
    health::RelayHealth,
    models::{
        OperationLease, OperationOutcome, RelayOperation, RelayProposalType, RelaySubmissionStatus,
    },
    plan::RelayPlan,
    rpc::RelayRpc,
    stages::{
        self, Completion, ExecutedIntent, ProposedIntent, StageContext, StageError, StageResult,
    },
    store::{RelayStore, RelayStoreError},
};

/// How long one holder may own an operation before another may reclaim it;
/// a running holder renews it every [`LEASE_RENEWAL`].
pub const OPERATION_LEASE: Duration = Duration::from_secs(60);
const LEASE_RENEWAL: Duration = Duration::from_secs(20);
/// How long one run may hold an operation before handing it back to the queue.
const RUN_BUDGET: Duration = Duration::from_secs(60);
/// A stage that is not ready for at most this long is waited for inside the
/// run; anything longer releases the operation until it is due again.
const INLINE_WAIT: Duration = Duration::from_secs(2);
/// The loop wakes on an insert; this is how often it looks without one.
const TICK: Duration = Duration::from_secs(2);
const CLAIM_BATCH: usize = 32;
const MAX_CONCURRENT_RUNS: usize = 64;
const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);

pub struct RelayEngine {
    state: Arc<AppState>,
    rpc: RelayRpc,
}

/// The newest row after a run: terminal, or still pending with its lease
/// released (deferred, budget spent, or taken over by another holder).
pub enum RunOutcome {
    Terminal(RelayOperation),
    Pending(RelayOperation),
}

impl RelayEngine {
    pub fn new(state: Arc<AppState>) -> Self {
        let rpc = RelayRpc::from_state(&state);
        Self { state, rpc }
    }

    /// Start the worker loop and its health loop. Both run in every process;
    /// the lease on each row keeps two processes off the same operation.
    pub fn spawn(state: Arc<AppState>, shutdown: CancellationToken) -> tokio::task::JoinHandle<()> {
        if state.env_vars.sponsor_lane_keys.is_empty() {
            tracing::warn!(
                "SPONSOR_LANE_KEYS is not set: relays sign with the shared SIGNER_KEY, and any other sender on that key can invalidate a relay in flight"
            );
        }
        tokio::spawn(RelayHealth::new(state.clone()).run_forever(shutdown.clone()));
        tokio::spawn(Arc::new(Self::new(state)).run_forever(shutdown))
    }

    fn store(&self) -> RelayStore<'_> {
        RelayStore::new(&self.state.db_pool)
    }

    /// Claim what is due and run each operation on its own task, so a slow
    /// one never holds back a new one. Sleeps until an insert wakes it or the
    /// tick passes.
    pub async fn run_forever(self: Arc<Self>, shutdown: CancellationToken) {
        let runs = Arc::new(Semaphore::new(MAX_CONCURRENT_RUNS));
        while !shutdown.is_cancelled() {
            let claimed = self.claim_and_start(&runs).await;
            if claimed == CLAIM_BATCH {
                continue;
            }
            tokio::select! {
                _ = self.state.relay_wake.notified() => {}
                _ = tokio::time::sleep(TICK) => {}
                _ = shutdown.cancelled() => {}
            }
        }
        // Runs that outlive the grace period are picked up by another
        // process once their lease expires.
        let _ = tokio::time::timeout(
            SHUTDOWN_GRACE,
            runs.acquire_many(MAX_CONCURRENT_RUNS as u32),
        )
        .await;
    }

    async fn claim_and_start(self: &Arc<Self>, runs: &Arc<Semaphore>) -> usize {
        // Take the run slots first, so every claimed operation has one.
        let mut permits = Vec::with_capacity(CLAIM_BATCH);
        while permits.len() < CLAIM_BATCH
            && let Ok(permit) = runs.clone().try_acquire_owned()
        {
            permits.push(permit);
        }
        if permits.is_empty() {
            return 0;
        }
        let claimed = match self
            .store()
            .claim_due_operations(permits.len() as i64, OPERATION_LEASE)
            .await
        {
            Ok(claimed) => claimed,
            Err(error) => {
                tracing::warn!(error = %error, "relay worker could not claim operations");
                return 0;
            }
        };
        let count = claimed.len();
        for (operation, permit) in claimed.into_iter().zip(permits) {
            let engine = self.clone();
            tokio::spawn(async move {
                engine.run_operation(operation, RUN_BUDGET).await;
                drop(permit);
            });
        }
        count
    }

    /// Run a claimed operation through its stages until it is terminal, a
    /// stage is not ready, or `budget` is spent.
    pub async fn run_operation(
        &self,
        mut operation: RelayOperation,
        budget: Duration,
    ) -> RunOutcome {
        let Some(lease) = operation.lease() else {
            return RunOutcome::Pending(operation);
        };
        let plan = match RelayPlan::from_operation(&operation) {
            Ok(plan) => plan,
            Err(error) => {
                return self
                    .park(
                        &operation,
                        &lease,
                        format!("stored payload no longer parses: {error}"),
                    )
                    .await;
            }
        };
        let landed_relay = Mutex::new(None);
        let lane_turn = Mutex::new(None);
        let started = Instant::now();
        let mut lease_renewed_at = started;
        loop {
            if started.elapsed() >= budget {
                return self.release(&operation, &lease, Duration::ZERO, None).await;
            }
            if lease_renewed_at.elapsed() >= LEASE_RENEWAL {
                lease_renewed_at = Instant::now();
                if let Err(error) = self.store().extend_lease(&lease, OPERATION_LEASE).await {
                    tracing::warn!(submission_id = %operation.id, error = %error, "relay lease renewal failed");
                    return RunOutcome::Pending(self.reload(&operation).await);
                }
            }
            let result = stages::run(&StageContext {
                state: &self.state,
                rpc: &self.rpc,
                lease: &lease,
                operation: &operation,
                plan: &plan,
                landed_relay: &landed_relay,
                lane_turn: &lane_turn,
            })
            .await;
            let result = match result {
                Ok(StageResult::Advance(to)) => self
                    .store()
                    .advance_stage(&lease, operation.stage, to)
                    .await
                    .map(|row| StageResult::Advanced(Box::new(row)))
                    .map_err(StageError::Store),
                other => other,
            };
            match result {
                Ok(StageResult::Advanced(row)) => operation = *row,
                Ok(StageResult::Advance(_)) => unreachable!("advances are applied above"),
                Ok(StageResult::NotReady(after, note)) => {
                    if after > INLINE_WAIT || started.elapsed() + after >= budget {
                        return self.release(&operation, &lease, after, note).await;
                    }
                    tokio::time::sleep(after).await;
                }
                Ok(StageResult::Done(completion)) => {
                    return self.finish(&operation, &lease, completion).await;
                }
                Err(StageError::Store(RelayStoreError::LeaseLost)) => {
                    return RunOutcome::Pending(self.reload(&operation).await);
                }
                Err(StageError::Store(error)) => {
                    tracing::warn!(submission_id = %operation.id, stage = %operation.stage, error = %error, "relay store error; deferring");
                    return self
                        .release(&operation, &lease, INLINE_WAIT, Some(error.to_string()))
                        .await;
                }
                Err(StageError::Transient(error)) => {
                    tracing::warn!(submission_id = %operation.id, stage = %operation.stage, error = %error, "relay stage not ready; deferring");
                    return self
                        .release(&operation, &lease, INLINE_WAIT, Some(error))
                        .await;
                }
                Err(StageError::Invariant(error)) => {
                    return self.park(&operation, &lease, error).await;
                }
            }
        }
    }

    async fn park(
        &self,
        operation: &RelayOperation,
        lease: &OperationLease,
        reason: String,
    ) -> RunOutcome {
        error_event!(
            ErrorCode::RelaySubmissionInvariantBroken,
            submission_id = %operation.id,
            treasury_id = %operation.treasury_id,
            stage = %operation.stage,
            error = %reason
        );
        self.finish(
            operation,
            lease,
            OperationOutcome::ManualReview { reason }.into(),
        )
        .await
    }

    async fn reload(&self, operation: &RelayOperation) -> RelayOperation {
        match self.store().operation(operation.id).await {
            Ok(Some(row)) => row,
            _ => operation.clone(),
        }
    }

    /// Hand the operation back to the queue, due again after `after`, with
    /// what it is waiting for on the row.
    async fn release(
        &self,
        operation: &RelayOperation,
        lease: &OperationLease,
        after: Duration,
        note: Option<String>,
    ) -> RunOutcome {
        let next_attempt_at = Utc::now() + chrono::Duration::from_std(after).unwrap_or_default();
        if let Err(error) = self
            .store()
            .defer_operation(lease, next_attempt_at, note.as_deref())
            .await
        {
            tracing::warn!(submission_id = %operation.id, error = %error, "relay deferral failed");
        }
        RunOutcome::Pending(self.reload(operation).await)
    }

    /// Commit the terminal state with its accounting and the execution stamp
    /// of every confidential intent the relay approved, then publish it. The
    /// 1Click submit is not awaited here: the stamp makes the intent due, and
    /// the submit queue owns it from then on.
    pub(super) async fn finish(
        &self,
        operation: &RelayOperation,
        lease: &OperationLease,
        completion: Completion,
    ) -> RunOutcome {
        let Completion {
            outcome,
            executed_intents,
            proposed_intents,
        } = completion;
        let committed: Result<(), RelayStoreError> = async {
            let mut tx = self.state.db_pool.begin().await?;
            RelayStore::complete_operation(&mut tx, lease, &outcome).await?;
            self.account(&mut tx, operation, &outcome).await?;
            Self::record_proposals(&mut tx, operation, &proposed_intents).await?;
            Self::record_executions(&mut tx, operation, &executed_intents).await?;
            tx.commit().await?;
            Ok(())
        }
        .await;
        match committed {
            Ok(()) => {}
            Err(RelayStoreError::LeaseLost) => {
                return RunOutcome::Pending(self.reload(operation).await);
            }
            Err(error) => {
                error_event!(
                    ErrorCode::RelaySubmissionStateWriteFailed,
                    submission_id = %operation.id,
                    treasury_id = %operation.treasury_id,
                    state = %outcome.state(),
                    error = %error
                );
                return self
                    .release(
                        operation,
                        lease,
                        INLINE_WAIT,
                        Some(format!("completion not committed: {error}")),
                    )
                    .await;
            }
        }
        if !executed_intents.is_empty() {
            self.wake_intent_submit(operation).await;
        }
        let updated = self.reload(operation).await;
        let transactions = self
            .store()
            .transactions_of(operation.id)
            .await
            .unwrap_or_default();
        let status = RelaySubmissionStatus::from_rows(&updated, &transactions);
        self.log_outcome(&updated, &outcome, &status);
        self.state.publish_relay_submission_updated(status);
        RunOutcome::Terminal(updated)
    }

    /// The relay created the proposal, so it links the intent to it; the
    /// stuck-intent watch can then follow the proposal whoever votes on it.
    async fn record_proposals(
        conn: &mut PgConnection,
        operation: &RelayOperation,
        proposed_intents: &[ProposedIntent],
    ) -> Result<(), RelayStoreError> {
        for intent in proposed_intents {
            sqlx::query(
                r#"
                UPDATE confidential_intents
                SET proposal_id = COALESCE(proposal_id, $3), updated_at = NOW()
                WHERE dao_id = $1 AND payload_hash = $2
                "#,
            )
            .bind(operation.treasury_id.as_str())
            .bind(&intent.payload_hash)
            .bind(intent.proposal_id as i64)
            .execute(&mut *conn)
            .await?;
        }
        Ok(())
    }

    /// The relay saw the `v1.signer` call execute, so it records the
    /// execution itself; the submit queue then needs no detector to find the
    /// intent.
    async fn record_executions(
        conn: &mut PgConnection,
        operation: &RelayOperation,
        executed_intents: &[ExecutedIntent],
    ) -> Result<(), RelayStoreError> {
        for intent in executed_intents {
            record_confidential_intent_execution(
                &mut *conn,
                operation.treasury_id.as_str(),
                &intent.payload_hash,
                Some(intent.proposal_id as i64),
                Utc::now(),
                None,
                Some(&intent.tx_hash),
            )
            .await?;
        }
        Ok(())
    }

    async fn wake_intent_submit(&self, operation: &RelayOperation) {
        self.state.intent_submit_wake.notify_one();
        if let Err(error) = mark_confidential_history_activity_due(
            &self.state.db_pool,
            operation.treasury_id.as_str(),
        )
        .await
        {
            tracing::warn!(treasury_id = %operation.treasury_id, error = %error, "failed to pull the 1Click poll forward");
        }
    }

    /// Credit, sponsor spend and platform metrics, on the completion
    /// transaction so they happen exactly once.
    async fn account(
        &self,
        conn: &mut PgConnection,
        operation: &RelayOperation,
        outcome: &OperationOutcome,
    ) -> Result<(), RelayStoreError> {
        let treasury_id = operation.treasury_id.as_str();
        let succeeded = matches!(outcome, OperationOutcome::Succeeded { .. });
        if operation.credit_reserved && !succeeded {
            sqlx::query(
                r#"
                UPDATE monitored_accounts
                SET gas_covered_transactions = gas_covered_transactions + 1, updated_at = NOW()
                WHERE account_id = $1
                "#,
            )
            .bind(treasury_id)
            .execute(&mut *conn)
            .await?;
        }
        let spend = RelayStore::spend_of_succeeded(conn, operation.id).await?;
        if !spend.is_zero() {
            sqlx::query(
                r#"
                UPDATE monitored_accounts
                SET paid_near = paid_near + $2, updated_at = NOW()
                WHERE account_id = $1
                "#,
            )
            .bind(treasury_id)
            .bind(&spend)
            .execute(&mut *conn)
            .await?;
        }
        if succeeded {
            let metrics = relay_metrics(operation.proposal_type);
            platform_metrics::record_events_on(&mut *conn, treasury_id, &metrics).await?;
        }
        Ok(())
    }

    fn log_outcome(
        &self,
        operation: &RelayOperation,
        outcome: &OperationOutcome,
        status: &RelaySubmissionStatus,
    ) {
        match outcome {
            OperationOutcome::Succeeded { proposal_ids } => tracing::info!(
                submission_id = %operation.id,
                treasury_id = %operation.treasury_id,
                tx_hash = ?status.tx_hash,
                proposal_ids = ?proposal_ids,
                "relay operation succeeded"
            ),
            OperationOutcome::Failed {
                failure_code,
                reason,
            } => {
                let api_error = failure_code.api_error(status.tx_hash.clone());
                if api_error.is_alertable() {
                    error_event!(
                        ErrorCode::RelayConfirmedUnexpectedFailure,
                        submission_id = %operation.id,
                        treasury_id = %operation.treasury_id,
                        stage = %operation.stage,
                        failure_code = %failure_code.as_text(),
                        tx_hash = ?status.tx_hash,
                        error = %reason
                    );
                } else {
                    tracing::warn!(
                        submission_id = %operation.id,
                        treasury_id = %operation.treasury_id,
                        stage = %operation.stage,
                        failure_code = %failure_code.as_text(),
                        tx_hash = ?status.tx_hash,
                        error = %reason,
                        "relay operation failed"
                    );
                }
            }
            OperationOutcome::ManualReview { reason } => error_event!(
                ErrorCode::RelaySubmissionManualReview,
                submission_id = %operation.id,
                treasury_id = %operation.treasury_id,
                stage = %operation.stage,
                tx_hash = ?status.tx_hash,
                error = %reason
            ),
        }
    }
}

/// The usage counters a successful relay records.
pub fn relay_metrics(proposal_type: Option<RelayProposalType>) -> Vec<PlatformMetric> {
    let mut metrics = vec![PlatformMetric::GasCoveredTransactions];
    match proposal_type {
        Some(RelayProposalType::Swap) => metrics.push(PlatformMetric::SwapProposals),
        Some(RelayProposalType::Payment) => metrics.push(PlatformMetric::PaymentProposals),
        Some(RelayProposalType::AddressBookPayment) => metrics.extend([
            PlatformMetric::PaymentProposals,
            PlatformMetric::AddressBookPaymentProposals,
        ]),
        Some(RelayProposalType::Vote) => metrics.push(PlatformMetric::VotesCasted),
        Some(RelayProposalType::Other) => metrics.push(PlatformMetric::OtherProposalsSubmitted),
        None => {}
    }
    metrics
}

#[cfg(test)]
mod tests {
    use near_api::AccountId;
    use sqlx::PgPool;

    use super::*;
    use crate::{
        handlers::relay::operations::models::{
            FailureCode, NewRelayOperation, OperationKind, OperationStage, OperationState,
        },
        utils::test_utils::build_test_state,
    };

    const DAO: &str = "engine.sputnik-dao.near";
    const PAYLOAD_HASH: &str = "bfbc53c1a2fcef411a4e331d56839c7ea53c500aec82f054e51cecdd5ac76026";

    async fn seed_treasury(pool: &PgPool, credits: i32) {
        sqlx::query(
            "INSERT INTO monitored_accounts (account_id, enabled, gas_covered_transactions) VALUES ($1, true, $2)",
        )
        .bind(DAO)
        .bind(credits)
        .execute(pool)
        .await
        .expect("seed treasury");
    }

    async fn credits(pool: &PgPool) -> i32 {
        sqlx::query_scalar(
            "SELECT gas_covered_transactions FROM monitored_accounts WHERE account_id = $1",
        )
        .bind(DAO)
        .fetch_one(pool)
        .await
        .expect("credits")
    }

    /// An operation past authorization, holding one of the treasury's credits.
    async fn authorized(pool: &PgPool, payload: &[u8]) -> (RelayOperation, OperationLease) {
        let treasury_id: AccountId = DAO.parse().unwrap();
        let actor: AccountId = "alice.near".parse().unwrap();
        let mut conn = pool.acquire().await.unwrap();
        let inserted = RelayStore::insert_or_load_operation(
            &mut conn,
            NewRelayOperation {
                treasury_id,
                actor_account_id: actor,
                operation_kind: OperationKind::ActProposal,
                submission_payload: payload.to_vec(),
                proposal_type: Some(RelayProposalType::Vote),
            },
        )
        .await
        .unwrap();
        let claimed = RelayStore::new(pool)
            .claim_operation(inserted.id, OPERATION_LEASE)
            .await
            .unwrap()
            .unwrap();
        let lease = claimed.lease().unwrap();
        sqlx::query(
            "UPDATE monitored_accounts SET gas_covered_transactions = gas_covered_transactions - 1 WHERE account_id = $1",
        )
        .bind(DAO)
        .execute(pool)
        .await
        .unwrap();
        let operation = RelayStore::advance_stage_on(
            &mut conn,
            &lease,
            OperationStage::Authorize,
            OperationStage::Settle,
            Some(true),
        )
        .await
        .unwrap();
        (operation, lease)
    }

    #[sqlx::test]
    async fn success_commits_the_result_and_the_execution_stamp_together(pool: PgPool) {
        seed_treasury(&pool, 5).await;
        sqlx::query(
            "INSERT INTO confidential_intents (dao_id, payload_hash, intent_payload, intent_type, status) \
             VALUES ($1, $2, '{}'::jsonb, 'shield', 'pending'), ($1, 'proposed-only', '{}'::jsonb, 'shield', 'pending')",
        )
        .bind(DAO)
        .bind(PAYLOAD_HASH)
        .execute(&pool)
        .await
        .expect("seed intents");
        let engine = RelayEngine::new(Arc::new(build_test_state(pool.clone())));
        let (operation, lease) = authorized(&pool, b"approve").await;

        let outcome = engine
            .finish(
                &operation,
                &lease,
                Completion {
                    outcome: OperationOutcome::Succeeded {
                        proposal_ids: vec![],
                    },
                    executed_intents: vec![ExecutedIntent {
                        payload_hash: PAYLOAD_HASH.to_owned(),
                        proposal_id: 29,
                        tx_hash: "7UWLRNWxcnt49oa3zLCXEvxCQwMx7HWGWriB9fQo6h4s".to_owned(),
                    }],
                    proposed_intents: vec![ProposedIntent {
                        payload_hash: "proposed-only".to_owned(),
                        proposal_id: 30,
                    }],
                },
            )
            .await;

        let RunOutcome::Terminal(done) = outcome else {
            panic!("the operation ends");
        };
        assert_eq!(done.state, OperationState::Succeeded);
        assert_eq!(done.stage, OperationStage::Settle);
        assert_eq!(credits(&pool).await, 4, "a relayed action keeps its credit");

        let (proposal_id, submit_state, tx_hash): (Option<i64>, String, Option<String>) =
            sqlx::query_as(
                "SELECT proposal_id, submit_state, proposal_execution_transaction_hash \
                 FROM confidential_intents WHERE dao_id = $1 AND payload_hash = $2",
            )
            .bind(DAO)
            .bind(PAYLOAD_HASH)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(proposal_id, Some(29));
        assert_eq!(submit_state, "due", "the submit queue can pick it up");
        assert_eq!(
            tx_hash.as_deref(),
            Some("7UWLRNWxcnt49oa3zLCXEvxCQwMx7HWGWriB9fQo6h4s")
        );

        let (proposal_id, submit_state): (Option<i64>, String) = sqlx::query_as(
            "SELECT proposal_id, submit_state FROM confidential_intents \
             WHERE dao_id = $1 AND payload_hash = 'proposed-only'",
        )
        .bind(DAO)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(proposal_id, Some(30), "a created proposal is linked");
        assert_eq!(submit_state, "idle", "and is not submitted before approval");
    }

    #[sqlx::test]
    async fn failure_refunds_only_a_credit_that_was_taken(pool: PgPool) {
        seed_treasury(&pool, 5).await;
        let engine = RelayEngine::new(Arc::new(build_test_state(pool.clone())));

        let (operation, lease) = authorized(&pool, b"fails-on-chain").await;
        assert_eq!(credits(&pool).await, 4);
        engine
            .finish(
                &operation,
                &lease,
                OperationOutcome::Failed {
                    failure_code: FailureCode::NotSent,
                    reason: "refused".to_owned(),
                }
                .into(),
            )
            .await;
        assert_eq!(
            credits(&pool).await,
            5,
            "a failed relay gives the credit back"
        );

        // Refused at authorization: no credit was taken, none is returned.
        let treasury_id: AccountId = DAO.parse().unwrap();
        let actor: AccountId = "mallory.near".parse().unwrap();
        let mut conn = pool.acquire().await.unwrap();
        let inserted = RelayStore::insert_or_load_operation(
            &mut conn,
            NewRelayOperation {
                treasury_id,
                actor_account_id: actor,
                operation_kind: OperationKind::AddProposal,
                submission_payload: b"not-allowed".to_vec(),
                proposal_type: None,
            },
        )
        .await
        .unwrap();
        let claimed = engine
            .store()
            .claim_operation(inserted.id, OPERATION_LEASE)
            .await
            .unwrap()
            .unwrap();
        let RunOutcome::Terminal(rejected) = engine
            .finish(
                &claimed,
                &claimed.lease().unwrap(),
                OperationOutcome::Failed {
                    failure_code: FailureCode::Rejected(axum::http::StatusCode::FORBIDDEN),
                    reason: "refused at authorization with 403 Forbidden".to_owned(),
                }
                .into(),
            )
            .await
        else {
            panic!("the operation ends");
        };
        assert_eq!(rejected.state, OperationState::Failed);
        assert_eq!(rejected.stage, OperationStage::Authorize);
        assert_eq!(
            rejected.failure(),
            Some(FailureCode::Rejected(axum::http::StatusCode::FORBIDDEN))
        );
        assert_eq!(credits(&pool).await, 5);
    }

    #[sqlx::test]
    async fn a_parked_operation_resumes_only_with_a_credit_to_take(pool: PgPool) {
        seed_treasury(&pool, 1).await;
        let engine = RelayEngine::new(Arc::new(build_test_state(pool.clone())));
        let (operation, lease) = authorized(&pool, b"parked").await;
        assert_eq!(credits(&pool).await, 0);
        engine
            .park(&operation, &lease, "rows contradict".to_owned())
            .await;
        assert_eq!(credits(&pool).await, 1, "parking returns the credit");

        let store = engine.store();
        assert!(store.resume_from_review(operation.id).await.unwrap());
        assert_eq!(credits(&pool).await, 0, "resuming takes it again");
        let resumed = store.operation(operation.id).await.unwrap().unwrap();
        assert_eq!(resumed.state, OperationState::Pending);
        assert_eq!(
            resumed.stage,
            OperationStage::Settle,
            "it resumes where it stopped"
        );
        assert!(
            !store.resume_from_review(operation.id).await.unwrap(),
            "a row that is not parked is left alone"
        );

        let claimed = store
            .claim_operation(operation.id, OPERATION_LEASE)
            .await
            .unwrap()
            .unwrap();
        engine
            .park(&claimed, &claimed.lease().unwrap(), "again".to_owned())
            .await;
        sqlx::query(
            "UPDATE monitored_accounts SET gas_covered_transactions = 0 WHERE account_id = $1",
        )
        .bind(DAO)
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            !store.resume_from_review(operation.id).await.unwrap(),
            "no credit, no resume"
        );
        assert_eq!(
            store.operation(operation.id).await.unwrap().unwrap().state,
            OperationState::ManualReview
        );
    }

    #[test]
    fn metrics_follow_the_proposal_type() {
        assert_eq!(
            relay_metrics(RelayProposalType::from_hint(Some("payment"), true)),
            vec![
                PlatformMetric::GasCoveredTransactions,
                PlatformMetric::PaymentProposals,
                PlatformMetric::AddressBookPaymentProposals
            ]
        );
        assert_eq!(
            relay_metrics(RelayProposalType::from_hint(Some("payment"), false)),
            vec![
                PlatformMetric::GasCoveredTransactions,
                PlatformMetric::PaymentProposals
            ]
        );
        assert_eq!(
            relay_metrics(RelayProposalType::from_hint(
                Some("confidential_transfer"),
                true
            )),
            vec![
                PlatformMetric::GasCoveredTransactions,
                PlatformMetric::OtherProposalsSubmitted
            ]
        );
        assert_eq!(
            relay_metrics(RelayProposalType::from_hint(None, true)),
            vec![PlatformMetric::GasCoveredTransactions]
        );
    }
}

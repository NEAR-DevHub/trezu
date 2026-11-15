//! What the relay worker checks about itself: operations that stopped making
//! progress, by stage, and transactions whose operation ended before they
//! did. Everything is read from the database, so an idle process sees the
//! same picture as the one doing the work.

use std::{
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};

use base64::Engine as _;
use bigdecimal::Zero;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::{
    AppState, error_event, error_event::ErrorCode,
    handlers::relay::post_quantum::read_send_tx_result,
};

use super::{
    models::{RelayQueueHealth, RelayTransaction, TransactionOutcome},
    rpc::{RelayRpc, SendOutcome, StatusOutcome, is_expired_rejection},
    store::{RelayStore, RelayStoreError},
};

const TICK: Duration = Duration::from_secs(2);
const ORPHAN_RECHECK: Duration = Duration::from_secs(30);
const ORPHAN_BATCH: i64 = 20;
const STALL_ALERT_COOLDOWN: Duration = Duration::from_secs(600);
/// A broadcast transaction with no final outcome for this long.
const RECONCILIATION_STALL_SECS: i64 = 600;
/// An operation with nothing in flight and no progress for this long.
const QUEUE_STALL_SECS: i64 = 120;

#[derive(Default)]
struct AlertTimes {
    reconciliation: Option<Instant>,
    queue: Option<Instant>,
}

static LAST_ALERTS: LazyLock<Mutex<AlertTimes>> = LazyLock::new(Mutex::default);

pub struct RelayHealth {
    state: Arc<AppState>,
    rpc: RelayRpc,
}

impl RelayHealth {
    pub fn new(state: Arc<AppState>) -> Self {
        let rpc = RelayRpc::from_state(&state);
        Self { state, rpc }
    }

    fn store(&self) -> RelayStore<'_> {
        RelayStore::new(&self.state.db_pool)
    }

    pub async fn run_forever(self, shutdown: CancellationToken) {
        while !shutdown.is_cancelled() {
            self.check().await;
            tokio::select! {
                _ = tokio::time::sleep(TICK) => {}
                _ = shutdown.cancelled() => {}
            }
        }
    }

    /// One pass: the orphan sweep, then the stall checks.
    pub async fn check(&self) {
        let orphans_settled = self.sweep_orphans().await;
        let store = self.store();
        let health = match store.queue_health().await {
            Ok(health) => health,
            Err(error) => {
                tracing::warn!(error = %error, "relay health could not read the queue");
                return;
            }
        };
        self.check_stalls(&health);
        if health.pending_operations == 0 && orphans_settled == 0 {
            return;
        }
        let stages = store
            .stage_counts()
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|(stage, count)| format!("{stage}={count}"))
            .collect::<Vec<_>>()
            .join(" ");
        tracing::debug!(
            pending_operations = health.pending_operations,
            pending_transactions = health.pending_transactions,
            oldest_pending_seconds = health.oldest_pending_seconds.unwrap_or(0),
            oldest_idle_seconds = health.oldest_idle_seconds.unwrap_or(0),
            manual_review = health.manual_review_operations,
            orphans_settled,
            stages = %stages,
            "relay queue"
        );
    }

    fn check_stalls(&self, health: &RelayQueueHealth) {
        let now = Instant::now();
        let mut last = LAST_ALERTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let cooled = |at: Option<Instant>| {
            at.is_none_or(|at| now.duration_since(at) >= STALL_ALERT_COOLDOWN)
        };
        let oldest_pending = health.oldest_pending_seconds.unwrap_or(0);
        if oldest_pending > RECONCILIATION_STALL_SECS && cooled(last.reconciliation) {
            last.reconciliation = Some(now);
            error_event!(
                ErrorCode::RelayReconciliationStalled,
                oldest_pending_seconds = oldest_pending,
                pending_transactions = health.pending_transactions
            );
        }
        let oldest_idle = health.oldest_idle_seconds.unwrap_or(0);
        if oldest_idle > QUEUE_STALL_SECS && cooled(last.queue) {
            last.queue = Some(now);
            error_event!(
                ErrorCode::RelayQueueStalled,
                pending_operations = health.pending_operations,
                stalled_seconds = oldest_idle,
                stage = %health
                    .oldest_idle_stage
                    .map(|stage| stage.as_str())
                    .unwrap_or_default()
            );
        }
    }

    /// Pending transactions whose operation already ended: settle them once
    /// the chain says, book a late landing's spend, and look at each one no
    /// more than every [`ORPHAN_RECHECK`].
    async fn sweep_orphans(&self) -> usize {
        let orphans = match self
            .store()
            .orphan_pending_transactions(ORPHAN_BATCH, ORPHAN_RECHECK)
            .await
        {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!(error = %error, "relay orphan sweep could not read");
                return 0;
            }
        };
        let checks = orphans.iter().map(|tx| self.sweep_orphan(tx));
        futures::future::join_all(checks)
            .await
            .into_iter()
            .filter(|settled| *settled)
            .count()
    }

    async fn sweep_orphan(&self, tx: &RelayTransaction) -> bool {
        let outcome = match self.orphan_outcome(tx).await {
            Some(outcome) => outcome,
            None => {
                if let Err(error) = self.store().touch_orphan_transaction(tx.id).await {
                    tracing::warn!(tx_hash = %tx.tx_hash, error = %error, "relay orphan touch failed");
                }
                return false;
            }
        };
        match self.settle_orphan(tx, &outcome).await {
            Ok(settled) => settled,
            Err(error) => {
                tracing::warn!(tx_hash = %tx.tx_hash, error = %error, "relay orphan settle failed");
                false
            }
        }
    }

    async fn orphan_outcome(&self, tx: &RelayTransaction) -> Option<TransactionOutcome> {
        let landed = |result: &Value| match read_send_tx_result(result, "", &tx.tx_hash) {
            Ok(_) => TransactionOutcome::Succeeded,
            Err(failure) => TransactionOutcome::Failed {
                reason: failure.message,
            },
        };
        let absent_votes = match self.rpc.status(&self.state.signer_id, &tx.tx_hash).await {
            StatusOutcome::Landed(result) => return Some(landed(&result)),
            StatusOutcome::Known(_) => return None,
            StatusOutcome::Unknown { absent_votes, .. } => absent_votes,
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(&tx.signed_tx);
        match self.rpc.send(&encoded).await {
            SendOutcome::Landed(result) => Some(landed(&result)),
            SendOutcome::Rejected(message)
                if absent_votes > 0 && is_expired_rejection(&message) =>
            {
                Some(TransactionOutcome::Superseded { reason: message })
            }
            _ => {
                let past_validity = self
                    .rpc
                    .block_height()
                    .await
                    .is_ok_and(|height| height as i64 > tx.valid_until_height);
                (past_validity && absent_votes >= self.rpc.absence_quorum()).then(|| {
                    TransactionOutcome::Superseded {
                        reason: "validity window closed, absent everywhere".to_owned(),
                    }
                })
            }
        }
    }

    /// Returns `false` when another settlement already moved the row, in which
    /// case nothing is credited.
    async fn settle_orphan(
        &self,
        tx: &RelayTransaction,
        outcome: &TransactionOutcome,
    ) -> Result<bool, RelayStoreError> {
        let mut db = self.state.db_pool.begin().await?;
        let moved = sqlx::query(
            r#"
            UPDATE relay_transactions t
            SET state = $2, updated_at = NOW()
            FROM relay_operations o
            WHERE t.id = $1 AND o.id = t.operation_id AND o.state <> 'pending' AND t.state = 'pending'
            "#,
        )
        .bind(tx.id)
        .bind(outcome.state())
        .execute(&mut *db)
        .await?
        .rows_affected();
        if moved == 0 {
            db.rollback().await?;
            return Ok(false);
        }
        if matches!(outcome, TransactionOutcome::Succeeded) && !tx.spend_yocto.is_zero() {
            sqlx::query(
                r#"
                UPDATE monitored_accounts m
                SET paid_near = m.paid_near + $2, updated_at = NOW()
                FROM relay_operations o
                WHERE o.id = $1 AND m.account_id = o.treasury_id
                "#,
            )
            .bind(tx.operation_id)
            .bind(&tx.spend_yocto)
            .execute(&mut *db)
            .await?;
        }
        db.commit().await?;
        Ok(true)
    }
}

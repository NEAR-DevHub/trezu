use std::time::Duration;

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool, Postgres, Transaction, postgres::PgQueryResult};
use uuid::Uuid;

use super::models::{
    NewRelayOperation, OperationLease, OperationOutcome, PreparedTransaction, RelayOperation,
    RelayQueueHealth, RelayTransaction, TransactionOutcome,
};

/// Advisory-lock namespace for sponsor access-key lanes.
const LANE_LOCK_NAMESPACE: i32 = 0x5245_4C59;

#[derive(Debug)]
pub enum RelayStoreError {
    /// The fenced write matched no row: the lease expired or was reclaimed, or
    /// the row is already terminal.
    LeaseLost,
    Db(sqlx::Error),
}

impl std::fmt::Display for RelayStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::LeaseLost => f.write_str("relay lease lost or row already terminal"),
            Self::Db(e) => write!(f, "relay store database error: {e}"),
        }
    }
}

impl std::error::Error for RelayStoreError {}

impl From<sqlx::Error> for RelayStoreError {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(e)
    }
}

impl RelayStoreError {
    /// A unique-constraint rejection: one live transaction per step, one
    /// nonce per key, one hash.
    pub fn is_unique_violation(&self) -> bool {
        match self {
            Self::Db(sqlx::Error::Database(error)) => error.is_unique_violation(),
            _ => false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct InsertedOperation {
    pub operation: RelayOperation,
    /// `false` when the idempotency key already existed and that row is returned.
    pub inserted: bool,
}

fn fenced(result: PgQueryResult) -> Result<(), RelayStoreError> {
    if result.rows_affected() == 0 {
        Err(RelayStoreError::LeaseLost)
    } else {
        Ok(())
    }
}

/// A sponsor access-key lane held exclusively (advisory lock) for the time it
/// takes to sign one transaction and commit it as `prepared`. Dropping the
/// claim without committing releases the lane unchanged.
pub struct LaneClaim<'c> {
    tx: Transaction<'c, Postgres>,
    pub public_key: String,
    /// Highest nonce ever committed on this lane, so a fresh signature never
    /// goes below one that may still be in the network.
    pub nonce_floor: Option<i64>,
}

impl LaneClaim<'_> {
    pub async fn commit_prepared(
        mut self,
        lease: &OperationLease,
        prepared: PreparedTransaction,
    ) -> Result<RelayTransaction, RelayStoreError> {
        let row = RelayStore::insert_prepared_on(&mut self.tx, lease, prepared).await?;
        self.tx.commit().await?;
        Ok(row)
    }
}

/// Reads and fenced writes on `relay_operations` / `relay_transactions`.
/// The insert and the completion take a connection so the credit reservation
/// and the final accounting commit atomically with the state change.
pub struct RelayStore<'a> {
    pool: &'a PgPool,
}

impl<'a> RelayStore<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// Insert a pending operation, or return the existing row when the
    /// idempotency key is already taken.
    pub async fn insert_or_load_operation(
        conn: &mut PgConnection,
        new: NewRelayOperation,
    ) -> Result<InsertedOperation, RelayStoreError> {
        let inserted = sqlx::query_as::<_, RelayOperation>(
            r#"
            INSERT INTO relay_operations (
                id, idempotency_key, treasury_id, actor_account_id, operation_kind,
                submission_payload, credit_reserved, proposal_type, address_book_payment
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(new.idempotency_key.as_str())
        .bind(new.treasury_id.as_str())
        .bind(new.actor_account_id.as_str())
        .bind(new.operation_kind)
        .bind(&new.submission_payload)
        .bind(new.credit_reserved)
        .bind(&new.proposal_type)
        .bind(new.address_book_payment)
        .fetch_optional(&mut *conn)
        .await?;

        if let Some(operation) = inserted {
            return Ok(InsertedOperation {
                operation,
                inserted: true,
            });
        }
        let operation = sqlx::query_as::<_, RelayOperation>(
            "SELECT * FROM relay_operations WHERE idempotency_key = $1",
        )
        .bind(new.idempotency_key.as_str())
        .fetch_one(&mut *conn)
        .await?;
        Ok(InsertedOperation {
            operation,
            inserted: false,
        })
    }

    pub async fn operation(&self, id: Uuid) -> Result<Option<RelayOperation>, RelayStoreError> {
        Ok(
            sqlx::query_as::<_, RelayOperation>("SELECT * FROM relay_operations WHERE id = $1")
                .bind(id)
                .fetch_optional(self.pool)
                .await?,
        )
    }

    /// Take up to `limit` due pending operations whose lease is free or
    /// expired, each with a fresh token.
    pub async fn claim_due_operations(
        &self,
        limit: i64,
        lease: Duration,
    ) -> Result<Vec<RelayOperation>, RelayStoreError> {
        Ok(sqlx::query_as::<_, RelayOperation>(
            r#"
            WITH due AS (
                SELECT id
                FROM relay_operations
                WHERE state = 'pending'
                  AND next_attempt_at <= NOW()
                  AND (lease_until IS NULL OR lease_until < NOW())
                ORDER BY next_attempt_at
                LIMIT $1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE relay_operations o
            SET lease_token = gen_random_uuid(),
                lease_until = NOW() + make_interval(secs => $2),
                updated_at = NOW()
            FROM due
            WHERE o.id = due.id
            RETURNING o.*
            "#,
        )
        .bind(limit)
        .bind(lease.as_secs_f64())
        .fetch_all(self.pool)
        .await?)
    }

    /// Take one specific pending operation now, regardless of its schedule,
    /// when nobody else holds it. `None` when it is terminal or leased.
    pub async fn claim_operation(
        &self,
        id: Uuid,
        lease: Duration,
    ) -> Result<Option<RelayOperation>, RelayStoreError> {
        Ok(sqlx::query_as::<_, RelayOperation>(
            r#"
            UPDATE relay_operations
            SET lease_token = gen_random_uuid(),
                lease_until = NOW() + make_interval(secs => $2),
                updated_at = NOW()
            WHERE id = $1
              AND state = 'pending'
              AND (lease_until IS NULL OR lease_until < NOW())
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(lease.as_secs_f64())
        .fetch_optional(self.pool)
        .await?)
    }

    pub async fn extend_lease(
        &self,
        lease: &OperationLease,
        by: Duration,
    ) -> Result<(), RelayStoreError> {
        fenced(
            sqlx::query(
                r#"
                UPDATE relay_operations
                SET lease_until = NOW() + make_interval(secs => $3), updated_at = NOW()
                WHERE id = $1 AND lease_token = $2 AND state = 'pending'
                "#,
            )
            .bind(lease.operation_id)
            .bind(lease.token)
            .bind(by.as_secs_f64())
            .execute(self.pool)
            .await?,
        )
    }

    /// Release the lease and pick the operation up again at `next_attempt_at`.
    pub async fn defer_operation(
        &self,
        lease: &OperationLease,
        next_attempt_at: DateTime<Utc>,
        last_error: Option<&str>,
    ) -> Result<(), RelayStoreError> {
        fenced(
            sqlx::query(
                r#"
                UPDATE relay_operations
                SET lease_token = NULL,
                    lease_until = NULL,
                    next_attempt_at = $3,
                    last_error = COALESCE($4, last_error),
                    updated_at = NOW()
                WHERE id = $1 AND lease_token = $2 AND state = 'pending'
                "#,
            )
            .bind(lease.operation_id)
            .bind(lease.token)
            .bind(next_attempt_at)
            .bind(last_error)
            .execute(self.pool)
            .await?,
        )
    }

    /// Make the operation terminal. Runs on the caller's connection so the
    /// credit, spend and metrics writes commit in the same transaction.
    pub async fn complete_operation(
        conn: &mut PgConnection,
        lease: &OperationLease,
        outcome: &OperationOutcome,
    ) -> Result<(), RelayStoreError> {
        let (proposal_ids, failure_code, last_error) = match outcome {
            OperationOutcome::Succeeded { proposal_ids } => {
                (Some(proposal_ids.as_slice()), None, None)
            }
            OperationOutcome::Failed {
                failure_code,
                reason,
            } => (None, Some(failure_code.as_text()), Some(reason.as_str())),
            OperationOutcome::ManualReview { reason } => (None, None, Some(reason.as_str())),
        };
        fenced(
            sqlx::query(
                r#"
                UPDATE relay_operations
                SET state = $3,
                    proposal_ids = $4,
                    failure_code = $5,
                    last_error = COALESCE($6, last_error),
                    lease_token = NULL,
                    lease_until = NULL,
                    updated_at = NOW()
                WHERE id = $1 AND lease_token = $2 AND state = 'pending'
                "#,
            )
            .bind(lease.operation_id)
            .bind(lease.token)
            .bind(outcome.state())
            .bind(proposal_ids)
            .bind(failure_code)
            .bind(last_error)
            .execute(conn)
            .await?,
        )
    }

    /// Lock the first free lane among `public_keys` for one signing. A lane
    /// is busy while any of its transactions is `prepared` or `pending`.
    pub async fn claim_free_lane(
        &self,
        public_keys: &[String],
    ) -> Result<Option<LaneClaim<'a>>, RelayStoreError> {
        let mut tx = self.pool.begin().await?;
        for public_key in public_keys {
            let locked: bool =
                sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1, hashtext($2))")
                    .bind(LANE_LOCK_NAMESPACE)
                    .bind(public_key)
                    .fetch_one(&mut *tx)
                    .await?;
            if !locked {
                continue;
            }
            let busy: bool = sqlx::query_scalar(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM relay_transactions
                    WHERE public_key = $1 AND state IN ('prepared', 'pending')
                )
                "#,
            )
            .bind(public_key)
            .fetch_one(&mut *tx)
            .await?;
            if busy {
                continue;
            }
            let nonce_floor: Option<i64> = sqlx::query_scalar(
                "SELECT MAX(nonce) FROM relay_transactions WHERE public_key = $1",
            )
            .bind(public_key)
            .fetch_one(&mut *tx)
            .await?;
            return Ok(Some(LaneClaim {
                tx,
                public_key: public_key.clone(),
                nonce_floor,
            }));
        }
        tx.rollback().await?;
        Ok(None)
    }

    /// Commit a signed transaction before it is broadcast. Refused without the
    /// operation lease; the unique step index refuses a second live
    /// transaction for the same step.
    pub async fn insert_prepared_transaction(
        &self,
        lease: &OperationLease,
        prepared: PreparedTransaction,
    ) -> Result<RelayTransaction, RelayStoreError> {
        let mut conn = self.pool.acquire().await?;
        Self::insert_prepared_on(&mut conn, lease, prepared).await
    }

    async fn insert_prepared_on(
        conn: &mut PgConnection,
        lease: &OperationLease,
        prepared: PreparedTransaction,
    ) -> Result<RelayTransaction, RelayStoreError> {
        sqlx::query_as::<_, RelayTransaction>(
            r#"
            INSERT INTO relay_transactions (
                id, operation_id, step_key, public_key, nonce,
                valid_until_height, tx_hash, signed_tx, spend_yocto
            )
            SELECT $1, o.id, $3, $4, $5, $6, $7, $8, $9
            FROM relay_operations o
            WHERE o.id = $2 AND o.lease_token = $10 AND o.state = 'pending'
            RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(lease.operation_id)
        .bind(prepared.step_key.to_string())
        .bind(&prepared.public_key)
        .bind(prepared.nonce)
        .bind(prepared.valid_until_height)
        .bind(&prepared.tx_hash)
        .bind(&prepared.signed_tx)
        .bind(&prepared.spend_yocto)
        .bind(lease.token)
        .fetch_optional(conn)
        .await?
        .ok_or(RelayStoreError::LeaseLost)
    }

    /// Every transaction of the operation, oldest first.
    pub async fn transactions_of(
        &self,
        operation_id: Uuid,
    ) -> Result<Vec<RelayTransaction>, RelayStoreError> {
        Ok(sqlx::query_as::<_, RelayTransaction>(
            "SELECT * FROM relay_transactions WHERE operation_id = $1 ORDER BY created_at, id",
        )
        .bind(operation_id)
        .fetch_all(self.pool)
        .await?)
    }

    /// Pending transactions whose operation already ended (the user's action
    /// expired or failed while the bytes were still unaccounted for), least
    /// recently looked at first, skipping any touched within `recheck_after`.
    pub async fn orphan_pending_transactions(
        &self,
        limit: i64,
        recheck_after: Duration,
    ) -> Result<Vec<RelayTransaction>, RelayStoreError> {
        Ok(sqlx::query_as::<_, RelayTransaction>(
            r#"
            SELECT t.*
            FROM relay_transactions t
            JOIN relay_operations o ON o.id = t.operation_id
            WHERE t.state = 'pending'
              AND o.state <> 'pending'
              AND t.updated_at <= NOW() - make_interval(secs => $2)
            ORDER BY t.updated_at
            LIMIT $1
            "#,
        )
        .bind(limit)
        .bind(recheck_after.as_secs_f64())
        .fetch_all(self.pool)
        .await?)
    }

    /// Note that an orphan was looked at without a verdict, so the next sweep
    /// moves on to others first.
    pub async fn touch_orphan_transaction(
        &self,
        transaction_id: Uuid,
    ) -> Result<(), RelayStoreError> {
        sqlx::query("UPDATE relay_transactions SET updated_at = NOW() WHERE id = $1")
            .bind(transaction_id)
            .execute(self.pool)
            .await?;
        Ok(())
    }

    /// Commit that the stored bytes are about to reach the network. Written
    /// before the send, so a crash mid-send leaves a pending row that is
    /// reconciled by hash rather than re-signed.
    pub async fn mark_broadcast(
        &self,
        lease: &OperationLease,
        transaction_id: Uuid,
    ) -> Result<(), RelayStoreError> {
        fenced(
            sqlx::query(
                r#"
                UPDATE relay_transactions t
                SET state = 'pending',
                    broadcast_at = COALESCE(t.broadcast_at, NOW()),
                    updated_at = NOW()
                FROM relay_operations o
                WHERE t.id = $1
                  AND o.id = t.operation_id
                  AND o.id = $2
                  AND o.lease_token = $3
                  AND t.state IN ('prepared', 'pending')
                "#,
            )
            .bind(transaction_id)
            .bind(lease.operation_id)
            .bind(lease.token)
            .execute(self.pool)
            .await?,
        )
    }

    /// Keep the latest send or status error on a pending transaction.
    pub async fn record_transaction_error(
        &self,
        lease: &OperationLease,
        transaction_id: Uuid,
        error: &str,
    ) -> Result<(), RelayStoreError> {
        fenced(
            sqlx::query(
                r#"
                UPDATE relay_transactions t
                SET last_error = $4, updated_at = NOW()
                FROM relay_operations o
                WHERE t.id = $1
                  AND o.id = t.operation_id
                  AND o.id = $2
                  AND o.lease_token = $3
                  AND t.state = 'pending'
                "#,
            )
            .bind(transaction_id)
            .bind(lease.operation_id)
            .bind(lease.token)
            .bind(error)
            .execute(self.pool)
            .await?,
        )
    }

    /// Make a pending transaction terminal once its outcome is proven.
    pub async fn settle_transaction(
        &self,
        lease: &OperationLease,
        transaction_id: Uuid,
        outcome: &TransactionOutcome,
    ) -> Result<(), RelayStoreError> {
        fenced(
            sqlx::query(
                r#"
                UPDATE relay_transactions t
                SET state = $4,
                    last_error = COALESCE($5, t.last_error),
                    updated_at = NOW()
                FROM relay_operations o
                WHERE t.id = $1
                  AND o.id = t.operation_id
                  AND o.id = $2
                  AND o.lease_token = $3
                  AND t.state = 'pending'
                "#,
            )
            .bind(transaction_id)
            .bind(lease.operation_id)
            .bind(lease.token)
            .bind(outcome.state())
            .bind(settle_error(outcome))
            .execute(self.pool)
            .await?,
        )
    }

    /// Settle a pending transaction of an operation that is already terminal.
    /// No lease exists for such a row; the terminal parent guarantees no live
    /// worker competes for it.
    pub async fn settle_orphan_transaction(
        &self,
        transaction_id: Uuid,
        outcome: &TransactionOutcome,
    ) -> Result<(), RelayStoreError> {
        fenced(
            sqlx::query(
                r#"
                UPDATE relay_transactions t
                SET state = $2,
                    last_error = COALESCE($3, t.last_error),
                    updated_at = NOW()
                FROM relay_operations o
                WHERE t.id = $1
                  AND o.id = t.operation_id
                  AND o.state <> 'pending'
                  AND t.state = 'pending'
                "#,
            )
            .bind(transaction_id)
            .bind(outcome.state())
            .bind(settle_error(outcome))
            .execute(self.pool)
            .await?,
        )
    }

    /// Sponsor NEAR that provably left the account for this operation.
    pub async fn spend_of_succeeded(
        conn: &mut PgConnection,
        operation_id: Uuid,
    ) -> Result<BigDecimal, RelayStoreError> {
        Ok(sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(spend_yocto), 0)::NUMERIC
            FROM relay_transactions
            WHERE operation_id = $1 AND state = 'succeeded'
            "#,
        )
        .bind(operation_id)
        .fetch_one(conn)
        .await?)
    }

    pub async fn queue_health(&self) -> Result<RelayQueueHealth, RelayStoreError> {
        Ok(sqlx::query_as::<_, RelayQueueHealth>(
            r#"
            SELECT
                (SELECT COUNT(*) FROM relay_operations WHERE state = 'pending') AS pending_operations,
                (SELECT COUNT(*) FROM relay_transactions WHERE state = 'pending') AS pending_transactions,
                (SELECT EXTRACT(EPOCH FROM NOW() - MIN(broadcast_at))::BIGINT
                   FROM relay_transactions WHERE state = 'pending') AS oldest_pending_seconds,
                (SELECT COUNT(*) FROM relay_operations WHERE state = 'manual_review') AS manual_review_operations
            "#,
        )
        .fetch_one(self.pool)
        .await?)
    }
}

fn settle_error(outcome: &TransactionOutcome) -> Option<&str> {
    match outcome {
        TransactionOutcome::Succeeded => None,
        TransactionOutcome::Failed { reason } | TransactionOutcome::Superseded { reason } => {
            Some(reason.as_str())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::relay::operations::models::{
        FailureCode, IdempotencyKey, OperationKind, OperationState, StepKey, TransactionState,
    };
    use near_api::AccountId;

    const LEASE: Duration = Duration::from_secs(30);

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn new_operation(payload: &[u8]) -> NewRelayOperation {
        let treasury_id = account("durable.sputnik-dao.near");
        let actor_account_id = account("alice.near");
        NewRelayOperation {
            idempotency_key: IdempotencyKey::derive(&treasury_id, &actor_account_id, payload),
            treasury_id,
            actor_account_id,
            operation_kind: OperationKind::AddProposal,
            submission_payload: payload.to_vec(),
            credit_reserved: true,
            proposal_type: Some("payment".to_owned()),
            address_book_payment: false,
        }
    }

    async fn claimed(pool: &PgPool, payload: &[u8]) -> (RelayOperation, OperationLease) {
        let mut conn = pool.acquire().await.unwrap();
        RelayStore::insert_or_load_operation(&mut conn, new_operation(payload))
            .await
            .unwrap();
        let store = RelayStore::new(pool);
        let mut rows = store.claim_due_operations(10, LEASE).await.unwrap();
        let op = rows.pop().expect("one due operation");
        let lease = op.lease().expect("claimed row carries its lease");
        (op, lease)
    }

    fn prepared(step_key: StepKey, nonce: i64, tx_hash: &str) -> PreparedTransaction {
        PreparedTransaction {
            step_key,
            public_key: "ed25519:sponsorkey".to_owned(),
            nonce,
            valid_until_height: 1_000,
            tx_hash: tx_hash.to_owned(),
            signed_tx: vec![1, 2, 3],
            spend_yocto: BigDecimal::from(0),
        }
    }

    async fn complete(
        pool: &PgPool,
        lease: &OperationLease,
        outcome: OperationOutcome,
    ) -> Result<(), RelayStoreError> {
        let mut conn = pool.acquire().await.unwrap();
        RelayStore::complete_operation(&mut conn, lease, &outcome).await
    }

    fn succeeded(proposal_ids: Vec<i64>) -> OperationOutcome {
        OperationOutcome::Succeeded { proposal_ids }
    }

    fn failed(code: FailureCode, reason: &str) -> OperationOutcome {
        OperationOutcome::Failed {
            failure_code: code,
            reason: reason.to_owned(),
        }
    }

    #[sqlx::test]
    async fn same_signed_request_converges_on_one_operation(pool: PgPool) {
        let mut conn = pool.acquire().await.unwrap();
        let first = RelayStore::insert_or_load_operation(&mut conn, new_operation(b"signed-a"))
            .await
            .unwrap();
        let again = RelayStore::insert_or_load_operation(&mut conn, new_operation(b"signed-a"))
            .await
            .unwrap();
        let other = RelayStore::insert_or_load_operation(&mut conn, new_operation(b"signed-b"))
            .await
            .unwrap();

        assert!(first.inserted);
        assert!(!again.inserted);
        assert_eq!(first.operation.id, again.operation.id);
        assert_eq!(first.operation.state, OperationState::Pending);
        assert_eq!(first.operation.operation_kind, OperationKind::AddProposal);
        assert!(first.operation.credit_reserved);
        assert_eq!(first.operation.proposal_type.as_deref(), Some("payment"));
        assert_eq!(first.operation.submission_payload, b"signed-a");
        assert!(other.inserted);
        assert_ne!(other.operation.id, first.operation.id);
    }

    #[sqlx::test]
    async fn claim_is_exclusive_until_the_lease_expires(pool: PgPool) {
        let store = RelayStore::new(&pool);
        let (op, lease) = claimed(&pool, b"claim").await;

        assert!(
            store
                .claim_due_operations(10, LEASE)
                .await
                .unwrap()
                .is_empty(),
            "a leased row is not claimable"
        );
        assert!(store.claim_operation(op.id, LEASE).await.unwrap().is_none());

        sqlx::query(
            "UPDATE relay_operations SET lease_until = NOW() - INTERVAL '1 second' WHERE id = $1",
        )
        .bind(op.id)
        .execute(&pool)
        .await
        .unwrap();
        let reclaimed = store.claim_operation(op.id, LEASE).await.unwrap().unwrap();
        let new_lease = reclaimed.lease().unwrap();
        assert_ne!(new_lease.token, lease.token);

        assert!(
            matches!(
                store.extend_lease(&lease, LEASE).await,
                Err(RelayStoreError::LeaseLost)
            ),
            "the stale holder's writes match zero rows"
        );
        store.extend_lease(&new_lease, LEASE).await.unwrap();
    }

    #[sqlx::test]
    async fn deferred_operation_is_claimable_again_only_when_due(pool: PgPool) {
        let store = RelayStore::new(&pool);
        let (op, lease) = claimed(&pool, b"defer").await;

        store
            .defer_operation(
                &lease,
                Utc::now() + chrono::Duration::hours(1),
                Some("rpc slow"),
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
        store
            .defer_operation(&lease, Utc::now(), None)
            .await
            .expect_err("lease was released with the deferral");
        assert!(
            store.claim_operation(op.id, LEASE).await.unwrap().is_some(),
            "a direct claim ignores the schedule"
        );
    }

    #[sqlx::test]
    async fn terminal_operations_never_move_again(pool: PgPool) {
        let store = RelayStore::new(&pool);
        let (op, lease) = claimed(&pool, b"terminal").await;

        complete(&pool, &lease, succeeded(vec![7, 8]))
            .await
            .unwrap();
        let done = store.operation(op.id).await.unwrap().unwrap();
        assert_eq!(done.state, OperationState::Succeeded);
        assert_eq!(done.proposal_ids, Some(vec![7, 8]));
        assert!(done.lease_token.is_none());

        assert!(
            store
                .claim_due_operations(10, LEASE)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(store.claim_operation(op.id, LEASE).await.unwrap().is_none());
        for result in [
            store.extend_lease(&lease, LEASE).await,
            store.defer_operation(&lease, Utc::now(), None).await,
            complete(&pool, &lease, failed(FailureCode::NotSent, "late")).await,
            store
                .insert_prepared_transaction(&lease, prepared(StepKey::Relay, 1, "h1"))
                .await
                .map(drop),
        ] {
            assert!(matches!(result, Err(RelayStoreError::LeaseLost)));
        }
    }

    #[sqlx::test]
    async fn completion_rolls_back_with_the_callers_transaction(pool: PgPool) {
        let store = RelayStore::new(&pool);
        let (op, lease) = claimed(&pool, b"atomic").await;

        let mut tx = pool.begin().await.unwrap();
        RelayStore::complete_operation(&mut tx, &lease, &succeeded(vec![]))
            .await
            .unwrap();
        tx.rollback().await.unwrap();
        assert_eq!(
            store.operation(op.id).await.unwrap().unwrap().state,
            OperationState::Pending
        );

        let mut tx = pool.begin().await.unwrap();
        RelayStore::complete_operation(
            &mut tx,
            &lease,
            &failed(FailureCode::SponsorStepFailed, "out of NEAR"),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let done = store.operation(op.id).await.unwrap().unwrap();
        assert_eq!(done.state, OperationState::Failed);
        assert_eq!(done.failure(), Some(FailureCode::SponsorStepFailed));
        assert_eq!(done.last_error.as_deref(), Some("out of NEAR"));
    }

    #[sqlx::test]
    async fn transaction_writes_need_the_operation_lease(pool: PgPool) {
        let store = RelayStore::new(&pool);
        let (op, lease) = claimed(&pool, b"txlease").await;
        let stale = OperationLease {
            operation_id: op.id,
            token: Uuid::new_v4(),
        };

        assert!(matches!(
            store
                .insert_prepared_transaction(&stale, prepared(StepKey::Relay, 1, "h1"))
                .await,
            Err(RelayStoreError::LeaseLost)
        ));
        let tx = store
            .insert_prepared_transaction(&lease, prepared(StepKey::Relay, 1, "h1"))
            .await
            .unwrap();
        assert_eq!(tx.state, TransactionState::Prepared);
        assert_eq!(tx.step_key, StepKey::Relay);
        assert_eq!(tx.nonce, 1);
        assert!(tx.broadcast_at.is_none());

        assert!(matches!(
            store.mark_broadcast(&stale, tx.id).await,
            Err(RelayStoreError::LeaseLost)
        ));
        store.mark_broadcast(&lease, tx.id).await.unwrap();
        let rows = store.transactions_of(op.id).await.unwrap();
        assert_eq!(rows[0].state, TransactionState::Pending);
        assert!(rows[0].broadcast_at.is_some());
    }

    #[sqlx::test]
    async fn one_live_transaction_per_step_and_per_nonce(pool: PgPool) {
        let store = RelayStore::new(&pool);
        let (_op, lease) = claimed(&pool, b"unique").await;
        let first = store
            .insert_prepared_transaction(&lease, prepared(StepKey::StorageTopUp, 5, "h5"))
            .await
            .unwrap();

        let same_step = store
            .insert_prepared_transaction(&lease, prepared(StepKey::StorageTopUp, 6, "h6"))
            .await
            .expect_err("second live transaction for a step is refused");
        assert!(same_step.is_unique_violation());
        let same_nonce = store
            .insert_prepared_transaction(&lease, prepared(StepKey::Relay, 5, "h7"))
            .await
            .expect_err("one nonce signs one payload");
        assert!(same_nonce.is_unique_violation());

        store.mark_broadcast(&lease, first.id).await.unwrap();
        store
            .settle_transaction(
                &lease,
                first.id,
                &TransactionOutcome::Superseded {
                    reason: "nonce passed".to_owned(),
                },
            )
            .await
            .unwrap();
        store
            .insert_prepared_transaction(&lease, prepared(StepKey::StorageTopUp, 6, "h6"))
            .await
            .expect("a superseded transaction frees its step");
    }

    #[sqlx::test]
    async fn lanes_are_exclusive_while_a_transaction_is_live(pool: PgPool) {
        let store = RelayStore::new(&pool);
        let (_op, lease) = claimed(&pool, b"lanes").await;
        let lanes = vec!["ed25519:laneA".to_owned(), "ed25519:laneB".to_owned()];

        let claim = store.claim_free_lane(&lanes).await.unwrap().unwrap();
        assert_eq!(claim.public_key, "ed25519:laneA");
        assert_eq!(claim.nonce_floor, None);

        let other_store = RelayStore::new(&pool);
        let second = other_store.claim_free_lane(&lanes).await.unwrap().unwrap();
        assert_eq!(
            second.public_key, "ed25519:laneB",
            "a lane under advisory lock is skipped"
        );
        drop(second);

        let tx = claim
            .commit_prepared(
                &lease,
                PreparedTransaction {
                    public_key: "ed25519:laneA".to_owned(),
                    ..prepared(StepKey::StorageTopUp, 41, "h41")
                },
            )
            .await
            .unwrap();
        assert_eq!(tx.nonce, 41);

        let next = store.claim_free_lane(&lanes).await.unwrap().unwrap();
        assert_eq!(
            next.public_key, "ed25519:laneB",
            "a lane with a prepared transaction is busy"
        );
        drop(next);
        assert!(store.claim_free_lane(&lanes[..1]).await.unwrap().is_none());

        store.mark_broadcast(&lease, tx.id).await.unwrap();
        store
            .settle_transaction(&lease, tx.id, &TransactionOutcome::Succeeded)
            .await
            .unwrap();
        let freed = store.claim_free_lane(&lanes[..1]).await.unwrap().unwrap();
        assert_eq!(freed.nonce_floor, Some(41), "the lane remembers its nonces");
    }

    #[sqlx::test]
    async fn orphan_transactions_settle_without_a_lease(pool: PgPool) {
        let store = RelayStore::new(&pool);
        let (op, lease) = claimed(&pool, b"orphan").await;
        let tx = store
            .insert_prepared_transaction(&lease, prepared(StepKey::Relay, 9, "h9"))
            .await
            .unwrap();
        store.mark_broadcast(&lease, tx.id).await.unwrap();
        assert!(
            store
                .settle_orphan_transaction(tx.id, &TransactionOutcome::Succeeded)
                .await
                .is_err(),
            "a live operation's transaction is not an orphan"
        );

        complete(
            &pool,
            &lease,
            failed(FailureCode::DelegateExpired, "expired"),
        )
        .await
        .unwrap();
        assert!(
            store
                .orphan_pending_transactions(10, Duration::from_secs(30))
                .await
                .unwrap()
                .is_empty(),
            "a row touched moments ago is not rechecked yet"
        );
        let orphans = store
            .orphan_pending_transactions(10, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(orphans.len(), 1);
        assert_eq!(orphans[0].id, tx.id);
        store.touch_orphan_transaction(tx.id).await.unwrap();
        store
            .settle_orphan_transaction(tx.id, &TransactionOutcome::Succeeded)
            .await
            .unwrap();
        assert!(
            store
                .orphan_pending_transactions(10, Duration::ZERO)
                .await
                .unwrap()
                .is_empty()
        );
        let _ = op;
    }

    #[sqlx::test]
    async fn transaction_lifecycle_spend_and_queue_health(pool: PgPool) {
        let store = RelayStore::new(&pool);
        let (op, lease) = claimed(&pool, b"lifecycle").await;
        let tx = store
            .insert_prepared_transaction(
                &lease,
                PreparedTransaction {
                    spend_yocto: BigDecimal::from(1250),
                    ..prepared(StepKey::Relay, 9, "h9")
                },
            )
            .await
            .unwrap();
        assert!(matches!(
            store.record_transaction_error(&lease, tx.id, "early").await,
            Err(RelayStoreError::LeaseLost)
        ));

        store.mark_broadcast(&lease, tx.id).await.unwrap();
        store
            .record_transaction_error(&lease, tx.id, "rpc-a: timed out")
            .await
            .unwrap();
        store
            .defer_operation(&lease, Utc::now() + chrono::Duration::seconds(5), None)
            .await
            .unwrap();

        let health = store.queue_health().await.unwrap();
        assert_eq!(health.pending_operations, 1);
        assert_eq!(health.pending_transactions, 1);
        assert!(health.oldest_pending_seconds.is_some());
        assert_eq!(health.manual_review_operations, 0);

        let lease = store
            .claim_operation(op.id, LEASE)
            .await
            .unwrap()
            .unwrap()
            .lease()
            .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        assert_eq!(
            RelayStore::spend_of_succeeded(&mut conn, op.id)
                .await
                .unwrap(),
            BigDecimal::from(0)
        );
        store
            .settle_transaction(&lease, tx.id, &TransactionOutcome::Succeeded)
            .await
            .unwrap();
        assert_eq!(
            RelayStore::spend_of_succeeded(&mut conn, op.id)
                .await
                .unwrap(),
            BigDecimal::from(1250)
        );
        let rows = store.transactions_of(op.id).await.unwrap();
        assert_eq!(rows[0].state, TransactionState::Succeeded);
        assert_eq!(rows[0].last_error.as_deref(), Some("rpc-a: timed out"));
        assert!(matches!(
            store
                .settle_transaction(
                    &lease,
                    tx.id,
                    &TransactionOutcome::Failed {
                        reason: "late".to_owned()
                    }
                )
                .await,
            Err(RelayStoreError::LeaseLost)
        ));

        complete(
            &pool,
            &lease,
            OperationOutcome::ManualReview {
                reason: "operator".to_owned(),
            },
        )
        .await
        .unwrap();
        let health = store.queue_health().await.unwrap();
        assert_eq!(health.pending_operations, 0);
        assert_eq!(health.pending_transactions, 0);
        assert_eq!(health.manual_review_operations, 1);
    }
}

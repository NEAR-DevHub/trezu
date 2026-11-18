//! Alerts for confidential work that stopped moving.
//!
//! Each check is one query for rows that should have finished
//! [`STUCK_AFTER`] ago and have not:
//!
//! - `CONF_INTENT_SUBMIT_STALLED`: execution recorded, still not handed to
//!   1Click.
//! - `CONF_INTENT_EXECUTION_UNSTAMPED`: the proposal is approved in
//!   `dao_proposals` but the intent has no execution recorded, so nothing
//!   will submit it.
//! - `BULK_CONF_STALLED`: the bulk header reached 1Click but the bulk row is
//!   not finished, so recipients are not being paid.
//!
//! The `confidential-intent-watch` cron runs it. A stuck row raises its event
//! on every run until it moves; the Sentry rule sets how often that pages.

use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;

use super::submitter::{POLL_SUBMITTED_INTENT_TYPES, intent_deadline};
use crate::AppState;
use crate::error_event;
use crate::error_event::ErrorCode;

const STUCK_AFTER: Duration = Duration::from_secs(20 * 60);

#[derive(sqlx::FromRow)]
struct StuckIntent {
    dao_id: String,
    payload_hash: String,
    intent_payload: Value,
    proposal_id: i64,
    proposal_executed_at: Option<DateTime<Utc>>,
    proposal_execution_transaction_hash: Option<String>,
    submit_state: String,
    submit_attempts: i32,
    submit_last_error: Option<String>,
}

#[derive(sqlx::FromRow)]
struct StuckBulkPayment {
    id: i32,
    dao_id: String,
    header_payload_hash: String,
    header_payload: Value,
    status: String,
    proposal_id: Option<i64>,
    sign_retry_count: i32,
    last_error: Option<String>,
}

fn deadline_passed(intent_payload: &Value, now: DateTime<Utc>) -> bool {
    intent_deadline(intent_payload).is_some_and(|deadline| deadline < now)
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct StuckIntentReport {
    pub stalled: usize,
    pub unstamped: usize,
    pub bulk_stalled: usize,
}

pub struct StuckIntentWatch<'a> {
    state: &'a AppState,
}

impl<'a> StuckIntentWatch<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub async fn sweep(&self) -> Result<StuckIntentReport, sqlx::Error> {
        let now = Utc::now();
        let mut report = StuckIntentReport::default();
        for row in self.stuck_intents().await? {
            if row.proposal_execution_transaction_hash.is_none() {
                report.unstamped += 1;
                error_event!(
                    ErrorCode::ConfIntentExecutionUnstamped,
                    dao_id = %row.dao_id,
                    payload_hash = %row.payload_hash,
                    proposal_id = row.proposal_id,
                    deadline_passed = deadline_passed(&row.intent_payload, now)
                );
                continue;
            }
            // Past the deadline the queue retires the row itself, except one
            // whose last attempt may have reached 1Click.
            if deadline_passed(&row.intent_payload, now) && row.submit_state != "unknown" {
                continue;
            }
            report.stalled += 1;
            error_event!(
                ErrorCode::ConfIntentSubmitStalled,
                dao_id = %row.dao_id,
                payload_hash = %row.payload_hash,
                proposal_id = row.proposal_id,
                proposal_executed_at = ?row.proposal_executed_at,
                submit_state = %row.submit_state,
                submit_attempts = row.submit_attempts,
                submit_last_error = row.submit_last_error.as_deref().unwrap_or("")
            );
        }
        for row in self.stuck_bulk_payments().await? {
            if deadline_passed(&row.header_payload, now) {
                continue;
            }
            report.bulk_stalled += 1;
            error_event!(
                ErrorCode::BulkConfStalled,
                dao_id = %row.dao_id,
                header_payload_hash = %row.header_payload_hash,
                bulk_id = row.id,
                proposal_id = ?row.proposal_id,
                bulk_status = %row.status,
                sign_retry_count = row.sign_retry_count,
                last_error = row.last_error.as_deref().unwrap_or("")
            );
        }
        Ok(report)
    }

    /// Pending intents that are either executed and unsubmitted, or approved
    /// with no execution recorded, for longer than [`STUCK_AFTER`].
    async fn stuck_intents(&self) -> Result<Vec<StuckIntent>, sqlx::Error> {
        sqlx::query_as::<_, StuckIntent>(
            r#"
            SELECT ci.dao_id, ci.payload_hash, ci.intent_payload, ci.proposal_id,
                   ci.proposal_executed_at, ci.proposal_execution_transaction_hash,
                   ci.submit_state, ci.submit_attempts, ci.submit_last_error
            FROM confidential_intents ci
            LEFT JOIN dao_proposals dp
              ON dp.dao_id = ci.dao_id AND dp.proposal_id = ci.proposal_id
            WHERE ci.status = 'pending'
              AND ci.submit_result IS NULL
              AND ci.proposal_id IS NOT NULL
              AND ci.intent_type = ANY($1)
              AND (
                  (ci.proposal_execution_transaction_hash IS NOT NULL
                   AND ci.proposal_executed_at <= NOW() - make_interval(secs => $2))
                  OR
                  (ci.proposal_execution_transaction_hash IS NULL
                   AND dp.status = 'approved'
                   AND dp.updated_at <= NOW() - make_interval(secs => $2))
              )
            ORDER BY ci.id
            "#,
        )
        .bind(POLL_SUBMITTED_INTENT_TYPES)
        .bind(STUCK_AFTER.as_secs_f64())
        .fetch_all(&self.state.db_pool)
        .await
    }

    async fn stuck_bulk_payments(&self) -> Result<Vec<StuckBulkPayment>, sqlx::Error> {
        sqlx::query_as::<_, StuckBulkPayment>(
            r#"
            SELECT b.id, b.dao_id, b.header_payload_hash, b.status, b.proposal_id,
                   b.sign_retry_count, b.last_error,
                   ci.intent_payload AS header_payload
            FROM confidential_bulk_payments b
            JOIN confidential_intents ci
              ON ci.dao_id = b.dao_id AND ci.payload_hash = b.header_payload_hash
            WHERE b.status NOT IN ('completed', 'failed')
              AND ci.status = 'submitted'
              AND ci.updated_at <= NOW() - make_interval(secs => $1)
            ORDER BY b.id
            "#,
        )
        .bind(STUCK_AFTER.as_secs_f64())
        .fetch_all(&self.state.db_pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::test_utils::build_test_state;
    use sqlx::PgPool;

    const DAO: &str = "watch.sputnik-dao.near";
    const FUTURE: &str = "2099-01-01T00:00:00Z";
    const PAST: &str = "2020-01-01T00:00:00Z";

    fn intent_payload(deadline: &str) -> Value {
        serde_json::json!({
            "message": serde_json::json!({ "deadline": deadline }).to_string()
        })
    }

    async fn sweep(pool: &PgPool) -> StuckIntentReport {
        let state = build_test_state(pool.clone());
        StuckIntentWatch::new(&state).sweep().await.expect("sweep")
    }

    /// A pending intent on its own proposal, executed `executed_secs_ago`, or
    /// not executed at all.
    async fn seed_intent(
        pool: &PgPool,
        payload_hash: &str,
        proposal_id: i64,
        deadline: &str,
        executed_secs_ago: Option<i64>,
    ) {
        sqlx::query(
            r#"
            INSERT INTO confidential_intents (
                dao_id, payload_hash, intent_payload, intent_type, status, proposal_id,
                submit_state, proposal_executed_at, proposal_execution_transaction_hash
            )
            VALUES ($1, $2, $3, 'shield', 'pending', $4, 'due',
                    NOW() - make_interval(secs => $5), $6)
            "#,
        )
        .bind(DAO)
        .bind(payload_hash)
        .bind(intent_payload(deadline))
        .bind(proposal_id)
        .bind(executed_secs_ago.map(|secs| secs as f64))
        .bind(executed_secs_ago.map(|_| "6TdwKKX7Nn7TcJ3b5q6j5mCq3kqcZ4R5dT8mS1aWvE9x"))
        .execute(pool)
        .await
        .expect("seed intent");
    }

    async fn seed_proposal(pool: &PgPool, proposal_id: i64, status: &str, updated_secs_ago: i64) {
        sqlx::query(
            r#"
            INSERT INTO dao_proposals (dao_id, proposal_id, status, updated_at)
            VALUES ($1, $2, $3::proposal_status, NOW() - make_interval(secs => $4))
            "#,
        )
        .bind(DAO)
        .bind(proposal_id)
        .bind(status)
        .bind(updated_secs_ago as f64)
        .execute(pool)
        .await
        .expect("seed proposal");
    }

    #[sqlx::test]
    async fn executed_intent_unsubmitted_for_too_long_is_stalled(pool: PgPool) {
        seed_intent(&pool, "stalled", 1, FUTURE, Some(3600)).await;
        seed_intent(&pool, "recent", 2, FUTURE, Some(30)).await;
        seed_intent(&pool, "expired", 3, PAST, Some(3600)).await;

        assert_eq!(
            sweep(&pool).await,
            StuckIntentReport {
                stalled: 1,
                ..StuckIntentReport::default()
            },
            "the recent row is in time, the expired one is the queue's to retire"
        );
    }

    #[sqlx::test]
    async fn expired_intent_with_an_unknown_outcome_stays_stalled(pool: PgPool) {
        seed_intent(&pool, "unknown", 1, PAST, Some(3600)).await;
        sqlx::query("UPDATE confidential_intents SET submit_state = 'unknown'")
            .execute(&pool)
            .await
            .expect("mark unknown");

        assert_eq!(sweep(&pool).await.stalled, 1);
    }

    #[sqlx::test]
    async fn approved_proposal_without_recorded_execution_is_unstamped(pool: PgPool) {
        seed_intent(&pool, "approved-long-ago", 1, FUTURE, None).await;
        seed_proposal(&pool, 1, "approved", 3600).await;
        seed_intent(&pool, "just-approved", 2, FUTURE, None).await;
        seed_proposal(&pool, 2, "approved", 30).await;
        seed_intent(&pool, "open", 3, FUTURE, None).await;
        seed_proposal(&pool, 3, "in_progress", 3600).await;
        seed_intent(&pool, "rejected", 4, FUTURE, None).await;
        seed_proposal(&pool, 4, "rejected", 3600).await;
        seed_intent(&pool, "no-proposal-row", 5, FUTURE, None).await;

        assert_eq!(
            sweep(&pool).await,
            StuckIntentReport {
                unstamped: 1,
                ..StuckIntentReport::default()
            }
        );
    }

    #[sqlx::test]
    async fn submitted_intents_are_ignored(pool: PgPool) {
        seed_intent(&pool, "done", 1, FUTURE, Some(3600)).await;
        sqlx::query(
            "UPDATE confidential_intents SET status = 'submitted', submit_result = '{\"intentHash\":\"x\"}'::jsonb, submit_state = 'done'",
        )
        .execute(&pool)
        .await
        .expect("mark submitted");

        assert_eq!(sweep(&pool).await, StuckIntentReport::default());
    }

    struct BulkSeed<'a> {
        header_hash: &'a str,
        bulk_status: &'a str,
        header_status: &'a str,
        header_updated_secs_ago: i64,
        deadline: &'a str,
    }

    /// A bulk row with its header intent. A `submitted` header carries the
    /// proposal id; a bulk row past `pending` has it linked.
    async fn seed_bulk(pool: &PgPool, seed: BulkSeed<'_>) {
        let header_proposal_id = (seed.header_status == "submitted").then_some(56_i64);
        let bulk_proposal_id = (seed.bulk_status != "pending").then_some(56_i64);
        sqlx::query(
            r#"
            INSERT INTO confidential_intents (
                dao_id, payload_hash, intent_payload, intent_type, status, proposal_id,
                submit_state, updated_at
            )
            VALUES ($1, $2, $3, 'shield', $4, $5, 'done', NOW() - make_interval(secs => $6))
            "#,
        )
        .bind(DAO)
        .bind(seed.header_hash)
        .bind(intent_payload(seed.deadline))
        .bind(seed.header_status)
        .bind(header_proposal_id)
        .bind(seed.header_updated_secs_ago as f64)
        .execute(pool)
        .await
        .expect("seed header");
        sqlx::query(
            r#"
            INSERT INTO confidential_bulk_payments (
                dao_id, bulk_account_id, header_payload_hash, recipient_payload_hashes,
                status, proposal_id
            )
            VALUES ($1, 'watch.bulkpayment.near', $2, ARRAY['r1', 'r2', 'r3'], $3, $4)
            "#,
        )
        .bind(DAO)
        .bind(seed.header_hash)
        .bind(seed.bulk_status)
        .bind(bulk_proposal_id)
        .execute(pool)
        .await
        .expect("seed bulk");
    }

    #[sqlx::test]
    async fn bulk_payment_idle_after_header_submitted_is_stalled(pool: PgPool) {
        let future = FUTURE;
        seed_bulk(
            &pool,
            BulkSeed {
                header_hash: "never-armed",
                bulk_status: "pending",
                header_status: "submitted",
                header_updated_secs_ago: 3600,
                deadline: future,
            },
        )
        .await;
        seed_bulk(
            &pool,
            BulkSeed {
                header_hash: "stuck-signing",
                bulk_status: "signing",
                header_status: "submitted",
                header_updated_secs_ago: 3600,
                deadline: future,
            },
        )
        .await;
        seed_bulk(
            &pool,
            BulkSeed {
                header_hash: "just-submitted",
                bulk_status: "pending",
                header_status: "submitted",
                header_updated_secs_ago: 30,
                deadline: future,
            },
        )
        .await;
        seed_bulk(
            &pool,
            BulkSeed {
                header_hash: "paid-out",
                bulk_status: "completed",
                header_status: "submitted",
                header_updated_secs_ago: 3600,
                deadline: future,
            },
        )
        .await;
        seed_bulk(
            &pool,
            BulkSeed {
                header_hash: "header-unvoted",
                bulk_status: "pending",
                header_status: "pending",
                header_updated_secs_ago: 3600,
                deadline: future,
            },
        )
        .await;
        seed_bulk(
            &pool,
            BulkSeed {
                header_hash: "expired",
                bulk_status: "pending",
                header_status: "submitted",
                header_updated_secs_ago: 3600,
                deadline: PAST,
            },
        )
        .await;
        assert_eq!(
            sweep(&pool).await,
            StuckIntentReport {
                bulk_stalled: 2,
                ..StuckIntentReport::default()
            },
            "never armed and stuck signing are stalled; recent, completed, unvoted and expired are not"
        );
    }
}

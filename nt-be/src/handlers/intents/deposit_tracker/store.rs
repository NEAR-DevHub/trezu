//! Postgres access for `deposit_watches` and `in_process_deposits`.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Duration, Utc};
use sqlx::postgres::PgRow;
use sqlx::{FromRow, PgExecutor, PgPool, Row};

use super::{DepositStatus, WatchKind};

/// Detected/finalized rows older than this no longer keep a watch alive or
/// appear in the activity feed; they stay in the table as evidence.
pub const ACTIVE_DEPOSIT_MAX_AGE: Duration = Duration::hours(24);

#[derive(Debug, Clone)]
pub struct DepositWatch {
    pub id: i64,
    pub dao_id: String,
    pub kind: WatchKind,
    pub quote_deposit_address: Option<String>,
    pub chain: Option<String>,
    pub token_id: Option<String>,
    pub fast_until: DateTime<Utc>,
    pub discovery_until: DateTime<Utc>,
    pub baseline_keys: Option<Vec<String>>,
    pub attempts: i32,
    pub created_at: DateTime<Utc>,
}

impl FromRow<'_, PgRow> for DepositWatch {
    fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        let kind: String = row.try_get("kind")?;
        Ok(Self {
            id: row.try_get("id")?,
            dao_id: row.try_get("dao_id")?,
            kind: WatchKind::parse(&kind).ok_or_else(|| {
                sqlx::Error::Decode(format!("unknown deposit watch kind '{kind}'").into())
            })?,
            quote_deposit_address: row.try_get("quote_deposit_address")?,
            chain: row.try_get("chain")?,
            token_id: row.try_get("token_id")?,
            fast_until: row.try_get("fast_until")?,
            discovery_until: row.try_get("discovery_until")?,
            baseline_keys: row.try_get("baseline_keys")?,
            attempts: row.try_get("attempts")?,
            created_at: row.try_get("created_at")?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct InProcessDeposit {
    pub id: i64,
    pub watch_id: i64,
    pub dao_id: String,
    pub kind: WatchKind,
    pub provider_deposit_key: String,
    pub chain: Option<String>,
    pub origin_tx_hash: Option<String>,
    pub near_tx_hash: Option<String>,
    pub token_id: String,
    pub amount: Option<BigDecimal>,
    pub provider_status: String,
    pub status: DepositStatus,
    pub detected_at: DateTime<Utc>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub ledger_event_id: Option<i64>,
    pub refresh_attempts: i32,
    pub next_refresh_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

impl InProcessDeposit {
    /// When the row last changed state while still in process: settlement
    /// or first detection. Unlike `updated_at`, unchanged re-observations do
    /// not move it.
    pub fn last_transition_at(&self) -> DateTime<Utc> {
        self.detected_at
            .max(self.finalized_at.unwrap_or(self.detected_at))
    }
}

impl FromRow<'_, PgRow> for InProcessDeposit {
    fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        let kind: String = row.try_get("kind")?;
        let status: String = row.try_get("status")?;
        Ok(Self {
            id: row.try_get("id")?,
            watch_id: row.try_get("watch_id")?,
            dao_id: row.try_get("dao_id")?,
            kind: WatchKind::parse(&kind).ok_or_else(|| {
                sqlx::Error::Decode(format!("unknown in-process deposit kind '{kind}'").into())
            })?,
            provider_deposit_key: row.try_get("provider_deposit_key")?,
            chain: row.try_get("chain")?,
            origin_tx_hash: row.try_get("origin_tx_hash")?,
            near_tx_hash: row.try_get("near_tx_hash")?,
            token_id: row.try_get("token_id")?,
            amount: row.try_get("amount")?,
            provider_status: row.try_get("provider_status")?,
            status: DepositStatus::parse(&status).ok_or_else(|| {
                sqlx::Error::Decode(format!("unknown in-process deposit status '{status}'").into())
            })?,
            detected_at: row.try_get("detected_at")?,
            finalized_at: row.try_get("finalized_at")?,
            ledger_event_id: row.try_get("ledger_event_id")?,
            refresh_attempts: row.try_get("refresh_attempts")?,
            next_refresh_at: row.try_get("next_refresh_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

/// One provider observation, normalised. Upserted by `(dao_id, provider_deposit_key)`.
#[derive(Debug, Clone)]
pub struct ObservedDeposit {
    pub provider_deposit_key: String,
    pub chain: Option<String>,
    pub origin_tx_hash: Option<String>,
    /// NEAR-side hash of the credit (bridge mint), when the provider reports it.
    pub near_tx_hash: Option<String>,
    pub token_id: String,
    pub amount: Option<BigDecimal>,
    pub provider_status: String,
    pub status: DepositStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DepositTransition {
    pub id: i64,
    pub previous: Option<DepositStatus>,
    pub current: DepositStatus,
}

impl DepositTransition {
    pub fn changed(&self) -> bool {
        self.previous != Some(self.current)
    }

    pub fn just_finalized(&self) -> bool {
        self.current == DepositStatus::Finalized && self.previous != Some(DepositStatus::Finalized)
    }
}

/// Create or renew a watch. Windows only ever extend; a renewed watch is
/// un-retired and due immediately. `Ok(false)` when `dao_id` is not a
/// monitored account.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_watch(
    pool: &PgPool,
    dao_id: &str,
    kind: WatchKind,
    quote_deposit_address: Option<&str>,
    chain: &str,
    token_id: Option<&str>,
    fast_until: DateTime<Utc>,
    discovery_until: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        INSERT INTO deposit_watches (
            dao_id, kind, quote_deposit_address, chain, token_id,
            fast_until, discovery_until, next_poll_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (dao_id, kind, COALESCE(quote_deposit_address, '')) DO UPDATE SET
            chain = EXCLUDED.chain,
            token_id = COALESCE(EXCLUDED.token_id, deposit_watches.token_id),
            fast_until = GREATEST(deposit_watches.fast_until, EXCLUDED.fast_until),
            discovery_until = GREATEST(deposit_watches.discovery_until, EXCLUDED.discovery_until),
            next_poll_at = NOW(),
            -- A revived watch starts a new life: deposits that settled while it
            -- was retired are history, not new observations.
            baseline_keys = CASE
                WHEN deposit_watches.retired_at IS NULL THEN deposit_watches.baseline_keys
            END,
            created_at = CASE
                WHEN deposit_watches.retired_at IS NULL THEN deposit_watches.created_at
                ELSE NOW()
            END,
            retired_at = NULL,
            last_error = NULL,
            attempts = 0,
            updated_at = NOW()
        "#,
    )
    .bind(dao_id)
    .bind(kind.as_str())
    .bind(quote_deposit_address)
    .bind(chain)
    .bind(token_id)
    .bind(fast_until)
    .bind(discovery_until)
    .execute(pool)
    .await;

    match result {
        Ok(_) => Ok(true),
        Err(sqlx::Error::Database(error)) if error.is_foreign_key_violation() => Ok(false),
        Err(error) => Err(error),
    }
}

/// Claim due watches. The bumped `next_poll_at` is the lease: a crashed
/// worker's claim simply becomes due again after `lease`.
pub async fn claim_due_watches(
    pool: &PgPool,
    limit: i64,
    lease: Duration,
) -> Result<Vec<DepositWatch>, sqlx::Error> {
    sqlx::query_as::<_, DepositWatch>(
        r#"
        UPDATE deposit_watches
        SET next_poll_at = NOW() + $2,
            attempts = attempts + 1,
            updated_at = NOW()
        WHERE id IN (
            SELECT id
            FROM deposit_watches
            WHERE retired_at IS NULL
              AND next_poll_at <= NOW()
            ORDER BY next_poll_at ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        "#,
    )
    .bind(limit)
    .bind(lease_interval(lease))
    .fetch_all(pool)
    .await
}

fn lease_interval(duration: Duration) -> sqlx::postgres::types::PgInterval {
    sqlx::postgres::types::PgInterval {
        months: 0,
        days: 0,
        microseconds: duration.num_microseconds().unwrap_or(i64::MAX),
    }
}

/// Outcome of one poll. `next_poll_at = None` retires the watch.
/// `discovery_until` is the claimed snapshot's window: every renewal raises
/// the stored one, so a mismatch means the watch was renewed mid-poll and
/// this outcome must neither retire it nor push out its immediate poll.
pub struct WatchPollOutcome<'a> {
    pub next_poll_at: Option<DateTime<Utc>>,
    pub error: Option<&'a str>,
    pub baseline_keys: Option<&'a [String]>,
    pub discovery_until: DateTime<Utc>,
}

pub async fn record_watch_poll(
    pool: &PgPool,
    watch_id: i64,
    outcome: WatchPollOutcome<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE deposit_watches
        SET next_poll_at = CASE
                WHEN discovery_until > $5 THEN LEAST(next_poll_at, COALESCE($2, next_poll_at))
                ELSE COALESCE($2, next_poll_at)
            END,
            retired_at = CASE WHEN $2 IS NULL AND discovery_until <= $5 THEN NOW() END,
            last_polled_at = NOW(),
            last_error = $3,
            attempts = CASE WHEN $3 IS NULL THEN 0 ELSE attempts END,
            baseline_keys = COALESCE($4, baseline_keys),
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(watch_id)
    .bind(outcome.next_poll_at)
    .bind(outcome.error)
    .bind(outcome.baseline_keys)
    .bind(outcome.discovery_until)
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert or update one observed deposit. A terminal row (ledger-confirmed
/// or failed) never regresses, and a finalized row is not pulled back to
/// detected by a stale provider read. Returns the previous and current
/// tracker states.
pub async fn upsert_deposit(
    executor: impl PgExecutor<'_>,
    watch_id: i64,
    dao_id: &str,
    kind: WatchKind,
    observed: &ObservedDeposit,
) -> Result<DepositTransition, sqlx::Error> {
    let (id, previous, current): (i64, Option<String>, String) = sqlx::query_as(
        r#"
        WITH existing AS (
            SELECT status
            FROM in_process_deposits
            WHERE dao_id = $2 AND provider_deposit_key = $4
        ),
        upserted AS (
            INSERT INTO in_process_deposits (
                watch_id, dao_id, kind, provider_deposit_key, chain, origin_tx_hash,
                near_tx_hash, token_id, amount, provider_status, status, finalized_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                CASE WHEN $11 = 'finalized' THEN NOW() END
            )
            ON CONFLICT (dao_id, provider_deposit_key) DO UPDATE SET
                provider_status = EXCLUDED.provider_status,
                amount = COALESCE(EXCLUDED.amount, in_process_deposits.amount),
                origin_tx_hash = COALESCE(EXCLUDED.origin_tx_hash, in_process_deposits.origin_tx_hash),
                near_tx_hash = COALESCE(EXCLUDED.near_tx_hash, in_process_deposits.near_tx_hash),
                token_id = EXCLUDED.token_id,
                chain = COALESCE(EXCLUDED.chain, in_process_deposits.chain),
                status = CASE
                    WHEN in_process_deposits.status IN ('ledger_confirmed', 'failed')
                        THEN in_process_deposits.status
                    WHEN in_process_deposits.status = 'finalized' AND EXCLUDED.status = 'detected'
                        THEN in_process_deposits.status
                    ELSE EXCLUDED.status
                END,
                finalized_at = CASE
                    WHEN in_process_deposits.finalized_at IS NOT NULL THEN in_process_deposits.finalized_at
                    WHEN EXCLUDED.status = 'finalized' THEN NOW()
                END,
                updated_at = NOW()
            RETURNING id, status
        )
        SELECT upserted.id, existing.status, upserted.status
        FROM upserted
        LEFT JOIN existing ON TRUE
        "#,
    )
    .bind(watch_id)
    .bind(dao_id)
    .bind(kind.as_str())
    .bind(&observed.provider_deposit_key)
    .bind(&observed.chain)
    .bind(&observed.origin_tx_hash)
    .bind(&observed.near_tx_hash)
    .bind(&observed.token_id)
    .bind(&observed.amount)
    .bind(&observed.provider_status)
    .bind(observed.status.as_str())
    .fetch_one(executor)
    .await?;

    Ok(DepositTransition {
        id,
        previous: previous.as_deref().and_then(DepositStatus::parse),
        current: DepositStatus::parse(&current).ok_or_else(|| {
            sqlx::Error::Decode(format!("unknown in-process deposit status '{current}'").into())
        })?,
    })
}

/// Every tracker row for one watch; liveness is decided by the caller.
pub async fn load_watch_deposits(
    pool: &PgPool,
    watch_id: i64,
) -> Result<Vec<InProcessDeposit>, sqlx::Error> {
    sqlx::query_as::<_, InProcessDeposit>(
        r#"
        SELECT *
        FROM in_process_deposits
        WHERE watch_id = $1
        ORDER BY detected_at ASC
        "#,
    )
    .bind(watch_id)
    .fetch_all(pool)
    .await
}

/// Rows the activity feed shows ahead of ledger history.
pub async fn load_visible_deposits(
    pool: &PgPool,
    dao_id: &str,
) -> Result<Vec<InProcessDeposit>, sqlx::Error> {
    sqlx::query_as::<_, InProcessDeposit>(
        r#"
        SELECT *
        FROM in_process_deposits
        WHERE dao_id = $1
          AND status IN ('detected', 'finalized', 'failed')
          AND GREATEST(detected_at, COALESCE(finalized_at, detected_at)) > NOW() - $2
        ORDER BY detected_at DESC
        LIMIT 50
        "#,
    )
    .bind(dao_id)
    .bind(lease_interval(ACTIVE_DEPOSIT_MAX_AGE))
    .fetch_all(pool)
    .await
}

/// Share pages re-derive the bridge address with the quote address as the
/// account id, so they cannot upsert by DAO. Renewing the quote's existing
/// watch (reviving it if discovery already stopped) keeps the payer's own
/// deposit tracked for as long as they keep the page open. A live watch
/// keeps its schedule and error backoff; only a retired one starts a new
/// life, as in `upsert_watch`. `Ok(false)`: no watch exists for this quote
/// (minted before the tracker, or not a quote).
pub async fn renew_confidential_watch_by_quote(
    pool: &PgPool,
    quote_deposit_address: &str,
    fast_until: DateTime<Utc>,
    discovery_until: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE deposit_watches
        SET fast_until = GREATEST(fast_until, $2),
            discovery_until = GREATEST(discovery_until, $3),
            next_poll_at = CASE WHEN retired_at IS NULL THEN next_poll_at ELSE NOW() END,
            attempts = CASE WHEN retired_at IS NULL THEN attempts ELSE 0 END,
            last_error = CASE WHEN retired_at IS NULL THEN last_error END,
            retired_at = NULL,
            updated_at = NOW()
        WHERE kind = 'confidential'
          AND quote_deposit_address = $1
        "#,
    )
    .bind(quote_deposit_address)
    .bind(fast_until)
    .bind(discovery_until)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Rows the deposit modal shows for one address scope: a confidential quote
/// (its provider key) or a public chain. Confirmed rows stay for the
/// activity window so the modal can say "received".
pub async fn load_recent_deposits_for_scope(
    pool: &PgPool,
    dao_id: &str,
    quote_deposit_address: Option<&str>,
    chain: Option<&str>,
) -> Result<Vec<InProcessDeposit>, sqlx::Error> {
    sqlx::query_as::<_, InProcessDeposit>(
        r#"
        SELECT *
        FROM in_process_deposits
        WHERE dao_id = $1
          AND GREATEST(
                detected_at,
                COALESCE(finalized_at, detected_at),
                COALESCE(ledger_confirmed_at, detected_at)
              ) > NOW() - $2
          AND ($3::text IS NULL OR provider_deposit_key = $3)
          AND ($4::text IS NULL OR chain = $4)
        ORDER BY detected_at DESC
        LIMIT 20
        "#,
    )
    .bind(dao_id)
    .bind(lease_interval(ACTIVE_DEPOSIT_MAX_AGE))
    .bind(quote_deposit_address)
    .bind(chain)
    .fetch_all(pool)
    .await
}

/// Settled public deposit row for one tracker deposit, unclaimed by any other
/// tracker row. With the bridge mint hash the match is exact on the ledger
/// NEAR hash; without it, token + decimal amount + time window is the
/// strongest key available.
/// The gold row a settled deposit resolves to, with the amount it booked so
/// a row the provider reported without one can be filled in on confirm.
#[derive(Debug, Clone, PartialEq, FromRow)]
pub struct LedgerMatch {
    pub event_id: i64,
    pub amount: Option<BigDecimal>,
}

/// Links a settled public deposit to its gold row: by NEAR mint hash when
/// the bridge gave one, else by token + amount inside the lookback (Omni,
/// see `activity::served_by_ledger`). The hashless path may pair two equal
/// deposits with each other's rows or pick an unrelated equal transfer;
/// the `NOT EXISTS` guard keeps each gold row linked at most once and the
/// link is not user-visible, so the ledger stays correct either way.
pub async fn find_public_ledger_match(
    pool: &PgPool,
    dao_id: &str,
    near_tx_hash: Option<&str>,
    token_id: &str,
    amount: Option<&BigDecimal>,
    not_before: DateTime<Utc>,
) -> Result<Option<LedgerMatch>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT g.id AS event_id, g.amount_in AS amount
        FROM gold_treasury_ledger_events g
        WHERE g.dao_id = $1
          AND g.source_kind = 'public_silver_leg'
          AND g.transaction_type = 'deposit'
          AND g.status = 'success'
          AND g.token_in = $3
          AND CASE
                WHEN $2::text IS NOT NULL THEN g.transaction_hash = $2
                ELSE $4::numeric IS NOT NULL AND g.amount_in = $4 AND g.event_time >= $5
              END
          AND NOT EXISTS (
              SELECT 1 FROM in_process_deposits d WHERE d.ledger_event_id = g.id
          )
        ORDER BY g.event_time ASC, g.id ASC
        LIMIT 1
        "#,
    )
    .bind(dao_id)
    .bind(near_tx_hash)
    .bind(token_id)
    .bind(amount)
    .bind(not_before)
    .fetch_optional(pool)
    .await
}

/// Confidential rows carry their bronze provenance in `gold_event_key`, so
/// the quote address is an exact key.
pub async fn find_confidential_ledger_match(
    pool: &PgPool,
    dao_id: &str,
    quote_deposit_address: &str,
) -> Result<Option<LedgerMatch>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT g.id AS event_id, g.amount_in AS amount
        FROM bronze_confidential_history_events he
        JOIN gold_treasury_ledger_events g
          ON g.gold_event_key = 'confidential:' || he.id::text
        WHERE he.account_id = $1
          AND he.deposit_address = $2
        ORDER BY he.created_at_external DESC
        LIMIT 1
        "#,
    )
    .bind(dao_id)
    .bind(quote_deposit_address)
    .fetch_optional(pool)
    .await
}

pub async fn confirm_ledger(
    pool: &PgPool,
    deposit_id: i64,
    ledger: &LedgerMatch,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE in_process_deposits
        SET status = 'ledger_confirmed',
            ledger_event_id = $2,
            amount = COALESCE(amount, $3),
            ledger_confirmed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
          AND status <> 'ledger_confirmed'
        "#,
    )
    .bind(deposit_id)
    .bind(ledger.event_id)
    .bind(&ledger.amount)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn schedule_refresh(
    executor: impl PgExecutor<'_>,
    deposit_id: i64,
    next_refresh_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE in_process_deposits
        SET refresh_attempts = refresh_attempts + 1,
            next_refresh_at = $2,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(deposit_id)
    .bind(next_refresh_at)
    .execute(executor)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    async fn seed_dao(pool: &PgPool, dao_id: &str, confidential: bool) {
        sqlx::query(
            "INSERT INTO monitored_accounts (account_id, enabled, is_confidential_account) \
             VALUES ($1, true, $2) ON CONFLICT (account_id) DO NOTHING",
        )
        .bind(dao_id)
        .bind(confidential)
        .execute(pool)
        .await
        .expect("seed monitored account");
    }

    fn observed(key: &str, status: DepositStatus) -> ObservedDeposit {
        ObservedDeposit {
            provider_deposit_key: key.to_string(),
            chain: Some("eth:8453".to_string()),
            origin_tx_hash: Some("0xabc".to_string()),
            near_tx_hash: None,
            token_id: "intents.near:nep141:usdc.omft.near".to_string(),
            amount: Some(BigDecimal::from(100)),
            provider_status: "PENDING".to_string(),
            status,
        }
    }

    #[sqlx::test]
    async fn failed_deposit_never_regresses(pool: PgPool) {
        seed_dao(&pool, "dao.sputnik-dao.near", false).await;
        let now = Utc::now();
        upsert_watch(
            &pool,
            "dao.sputnik-dao.near",
            WatchKind::Public,
            None,
            "eth:8453",
            None,
            now + Duration::minutes(10),
            now + Duration::minutes(120),
        )
        .await
        .expect("upsert watch");
        let watch = claim_due_watches(&pool, 1, Duration::seconds(60))
            .await
            .expect("claim")
            .remove(0);

        let key = "eth:8453:0xdef:nep141:usdc.omft.near";
        for status in [
            DepositStatus::Failed,
            DepositStatus::Detected,
            DepositStatus::Finalized,
        ] {
            let transition = upsert_deposit(
                &pool,
                watch.id,
                &watch.dao_id,
                watch.kind,
                &observed(key, status),
            )
            .await
            .expect("upsert deposit");
            assert_eq!(
                transition.current,
                DepositStatus::Failed,
                "failed is terminal"
            );
        }
    }

    #[sqlx::test]
    async fn share_page_renews_a_quote_watch_by_its_address(pool: PgPool) {
        seed_dao(&pool, "dao.sputnik-dao.near", true).await;
        let now = Utc::now();
        upsert_watch(
            &pool,
            "dao.sputnik-dao.near",
            WatchKind::Confidential,
            Some("quote-addr"),
            "eth:8453",
            None,
            now + Duration::minutes(10),
            now + Duration::minutes(120),
        )
        .await
        .expect("upsert watch");
        // Discovery ran out before the payer opened the link.
        sqlx::query(
            "UPDATE deposit_watches SET retired_at = NOW(), attempts = 7, \
             last_error = 'x' WHERE quote_deposit_address = 'quote-addr'",
        )
        .execute(&pool)
        .await
        .expect("retire");
        assert!(
            claim_due_watches(&pool, 10, Duration::seconds(60))
                .await
                .expect("claim")
                .is_empty(),
            "retired watch is not due"
        );

        assert!(
            !renew_confidential_watch_by_quote(
                &pool,
                "unknown-quote",
                now + Duration::minutes(10),
                now + Duration::minutes(120),
            )
            .await
            .expect("renew unknown"),
            "no watch for an unknown quote"
        );
        let later = now + Duration::minutes(30);
        assert!(
            renew_confidential_watch_by_quote(
                &pool,
                "quote-addr",
                later + Duration::minutes(10),
                later + Duration::minutes(120),
            )
            .await
            .expect("renew"),
        );

        let revived = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("claim after renew");
        assert_eq!(revived.len(), 1, "renewal revives the watch");
        let watch = &revived[0];
        assert_eq!(watch.quote_deposit_address.as_deref(), Some("quote-addr"));
        assert_eq!(
            watch.attempts, 1,
            "attempt counter restarted (claim adds one)"
        );
        let last_error: Option<String> =
            sqlx::query_scalar("SELECT last_error FROM deposit_watches WHERE id = $1")
                .bind(watch.id)
                .fetch_one(&pool)
                .await
                .expect("read last_error");
        assert!(last_error.is_none(), "revival clears the last error");
        assert!(watch.fast_until >= later + Duration::minutes(9));
        assert!(watch.discovery_until >= later + Duration::minutes(119));

        // A live watch that is backing off from errors keeps its schedule:
        // page opens must not turn into immediate re-polls of a broken quote.
        sqlx::query(
            "UPDATE deposit_watches SET attempts = 5, last_error = 'boom', \
             next_poll_at = NOW() + interval '5 minutes' WHERE id = $1",
        )
        .bind(watch.id)
        .execute(&pool)
        .await
        .expect("simulate backoff");
        assert!(
            renew_confidential_watch_by_quote(
                &pool,
                "quote-addr",
                later + Duration::minutes(20),
                later + Duration::minutes(130),
            )
            .await
            .expect("renew live"),
        );
        assert!(
            claim_due_watches(&pool, 10, Duration::seconds(60))
                .await
                .expect("claim live")
                .is_empty(),
            "live watch keeps its backoff schedule"
        );
        let (attempts, last_error): (i32, Option<String>) =
            sqlx::query_as("SELECT attempts, last_error FROM deposit_watches WHERE id = $1")
                .bind(watch.id)
                .fetch_one(&pool)
                .await
                .expect("read backoff state");
        assert_eq!(attempts, 5, "live watch keeps its attempts");
        assert_eq!(last_error.as_deref(), Some("boom"));
    }

    #[sqlx::test]
    async fn watch_lifecycle_and_deposit_transitions(pool: PgPool) {
        seed_dao(&pool, "dao.sputnik-dao.near", false).await;
        let now = Utc::now();

        assert!(
            upsert_watch(
                &pool,
                "dao.sputnik-dao.near",
                WatchKind::Public,
                None,
                "eth:8453",
                Some("usdc"),
                now + Duration::minutes(10),
                now + Duration::minutes(120),
            )
            .await
            .expect("upsert watch"),
            "monitored account gets a watch"
        );
        assert!(
            !upsert_watch(
                &pool,
                "ghost.near",
                WatchKind::Public,
                None,
                "eth:8453",
                None,
                now,
                now,
            )
            .await
            .expect("fk violation is not an error"),
            "unmonitored account is skipped"
        );
        // Renewal coalesces onto the same row and only extends windows.
        upsert_watch(
            &pool,
            "dao.sputnik-dao.near",
            WatchKind::Public,
            None,
            "sol:mainnet",
            None,
            now + Duration::minutes(5),
            now + Duration::minutes(60),
        )
        .await
        .expect("renew watch");

        let claimed = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("claim");
        assert_eq!(claimed.len(), 1);
        let watch = &claimed[0];
        assert_eq!(watch.chain.as_deref(), Some("sol:mainnet"));
        assert_eq!(watch.token_id.as_deref(), Some("usdc"));
        assert!(watch.fast_until >= now + Duration::minutes(9));
        assert!(watch.discovery_until >= now + Duration::minutes(119));
        assert!(
            claim_due_watches(&pool, 10, Duration::seconds(60))
                .await
                .expect("second claim")
                .is_empty(),
            "claimed watch is leased"
        );

        let key = "eth:8453:0xabc:nep141:usdc.omft.near";
        let first = upsert_deposit(
            &pool,
            watch.id,
            &watch.dao_id,
            watch.kind,
            &observed(key, DepositStatus::Detected),
        )
        .await
        .expect("insert deposit");
        assert_eq!(first.previous, None);
        assert_eq!(first.current, DepositStatus::Detected);
        assert!(first.changed());

        let same = upsert_deposit(
            &pool,
            watch.id,
            &watch.dao_id,
            watch.kind,
            &observed(key, DepositStatus::Detected),
        )
        .await
        .expect("repeat deposit");
        assert!(!same.changed());

        let finalized = upsert_deposit(
            &pool,
            watch.id,
            &watch.dao_id,
            watch.kind,
            &observed(key, DepositStatus::Finalized),
        )
        .await
        .expect("finalize deposit");
        assert!(finalized.just_finalized());

        let stale = upsert_deposit(
            &pool,
            watch.id,
            &watch.dao_id,
            watch.kind,
            &observed(key, DepositStatus::Detected),
        )
        .await
        .expect("stale read");
        assert_eq!(stale.current, DepositStatus::Finalized, "never regresses");
        assert!(!stale.changed());

        let baseline = vec!["eth:8453:0xold:nep141:usdc.omft.near".to_string()];
        record_watch_poll(
            &pool,
            watch.id,
            WatchPollOutcome {
                next_poll_at: Some(now),
                error: None,
                baseline_keys: Some(&baseline),
                discovery_until: watch.discovery_until,
            },
        )
        .await
        .expect("record poll");
        let reclaimed = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("reclaim");
        assert_eq!(reclaimed[0].baseline_keys, Some(baseline));

        let deposits = load_watch_deposits(&pool, watch.id).await.expect("load");
        assert_eq!(deposits.len(), 1);
        assert_eq!(deposits[0].status, DepositStatus::Finalized);
        assert!(deposits[0].finalized_at.is_some());
        assert_eq!(
            load_visible_deposits(&pool, &watch.dao_id)
                .await
                .expect("visible")
                .len(),
            1
        );

        schedule_refresh(&pool, deposits[0].id, now + Duration::seconds(10))
            .await
            .expect("schedule refresh");

        assert!(
            find_public_ledger_match(
                &pool,
                &watch.dao_id,
                None,
                &deposits[0].token_id,
                Some(&BigDecimal::from(100)),
                now - Duration::minutes(30),
            )
            .await
            .expect("match query")
            .is_none()
        );
        let ledger_id: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO gold_treasury_ledger_events (
                gold_event_key, dao_id, source_kind, history_visible, transaction_type,
                status, event_time, token_in, amount_in, transaction_hash
            )
            VALUES ('silver-leg:test', $1, 'public_silver_leg', true, 'deposit',
                    'success', NOW(), $2, 100.000000, 'MintHash1')
            RETURNING id
            "#,
        )
        .bind(&watch.dao_id)
        .bind(&deposits[0].token_id)
        .fetch_one(&pool)
        .await
        .expect("seed gold row");
        let matched = find_public_ledger_match(
            &pool,
            &watch.dao_id,
            None,
            &deposits[0].token_id,
            Some(&BigDecimal::from(100)),
            now - Duration::minutes(30),
        )
        .await
        .expect("match query");
        let ledger = LedgerMatch {
            event_id: ledger_id,
            amount: Some(BigDecimal::from_str("100.000000").unwrap()),
        };
        assert_eq!(
            matched,
            Some(ledger.clone()),
            "numeric equality ignores scale"
        );
        assert!(
            find_public_ledger_match(
                &pool,
                &watch.dao_id,
                None,
                &deposits[0].token_id,
                None,
                now - Duration::minutes(30),
            )
            .await
            .expect("match query")
            .is_none(),
            "no mint hash and no amount never matches blind"
        );
        assert_eq!(
            find_public_ledger_match(
                &pool,
                &watch.dao_id,
                Some("MintHash1"),
                &deposits[0].token_id,
                None,
                now,
            )
            .await
            .expect("match query"),
            Some(ledger.clone()),
            "a known mint hash matches without an amount or window"
        );
        assert!(
            find_public_ledger_match(
                &pool,
                &watch.dao_id,
                Some("OtherHash"),
                &deposits[0].token_id,
                Some(&BigDecimal::from(100)),
                now - Duration::minutes(30),
            )
            .await
            .expect("match query")
            .is_none(),
            "a known mint hash never falls back to amount matching"
        );

        sqlx::query("UPDATE in_process_deposits SET amount = NULL WHERE id = $1")
            .bind(deposits[0].id)
            .execute(&pool)
            .await
            .expect("blank amount");
        confirm_ledger(&pool, deposits[0].id, &ledger)
            .await
            .expect("confirm");
        assert!(
            load_visible_deposits(&pool, &watch.dao_id)
                .await
                .expect("visible")
                .is_empty(),
            "confirmed rows leave the feed"
        );
        let confirmed = load_watch_deposits(&pool, watch.id).await.expect("load");
        assert_eq!(
            confirmed[0].amount, ledger.amount,
            "confirm backfills a missing amount from the gold row"
        );
        assert!(
            find_public_ledger_match(
                &pool,
                &watch.dao_id,
                None,
                &deposits[0].token_id,
                Some(&BigDecimal::from(100)),
                now - Duration::minutes(30),
            )
            .await
            .expect("match query")
            .is_none(),
            "a claimed ledger row cannot match twice"
        );

        record_watch_poll(
            &pool,
            watch.id,
            WatchPollOutcome {
                next_poll_at: None,
                error: None,
                baseline_keys: None,
                discovery_until: watch.discovery_until,
            },
        )
        .await
        .expect("retire");
        assert!(
            claim_due_watches(&pool, 10, Duration::seconds(60))
                .await
                .expect("claim after retire")
                .is_empty()
        );

        let revived_at = Utc::now();
        upsert_watch(
            &pool,
            &watch.dao_id,
            WatchKind::Public,
            None,
            "eth:8453",
            None,
            revived_at + Duration::minutes(10),
            revived_at + Duration::minutes(120),
        )
        .await
        .expect("revive watch");
        let revived = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("claim revived");
        assert_eq!(revived.len(), 1);
        assert_eq!(revived[0].id, watch.id, "same watch row");
        assert_eq!(
            revived[0].baseline_keys, None,
            "a revived watch takes a fresh baseline"
        );
        assert!(
            revived[0].created_at >= revived_at,
            "a revived watch dates from its revival"
        );
    }

    #[sqlx::test]
    async fn live_watch_renewal_keeps_its_baseline(pool: PgPool) {
        seed_dao(&pool, "live.sputnik-dao.near", false).await;
        let now = Utc::now();
        let renew = |pool: PgPool| async move {
            upsert_watch(
                &pool,
                "live.sputnik-dao.near",
                WatchKind::Public,
                None,
                "eth:8453",
                None,
                now + Duration::minutes(10),
                now + Duration::minutes(120),
            )
            .await
            .expect("upsert watch")
        };
        renew(pool.clone()).await;
        let claimed = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("claim");
        let watch = &claimed[0];
        let baseline = vec!["eth:8453:0xseen:nep141:usdc.omft.near".to_string()];
        record_watch_poll(
            &pool,
            watch.id,
            WatchPollOutcome {
                next_poll_at: Some(now + Duration::minutes(5)),
                error: None,
                baseline_keys: Some(&baseline),
                discovery_until: watch.discovery_until,
            },
        )
        .await
        .expect("record poll");

        renew(pool.clone()).await;
        let renewed = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("claim renewed");
        assert_eq!(renewed[0].baseline_keys, Some(baseline));
        assert_eq!(renewed[0].created_at, watch.created_at);
    }

    #[sqlx::test]
    async fn renewal_during_a_poll_survives_the_stale_outcome(pool: PgPool) {
        seed_dao(&pool, "race.sputnik-dao.near", false).await;
        let activate = |pool: PgPool, at: DateTime<Utc>| async move {
            upsert_watch(
                &pool,
                "race.sputnik-dao.near",
                WatchKind::Public,
                None,
                "eth:8453",
                None,
                at + Duration::minutes(10),
                at + Duration::minutes(120),
            )
            .await
            .expect("upsert watch")
        };
        // Watch whose discovery window already ended: its next poll retires it.
        activate(pool.clone(), Utc::now() - Duration::minutes(130)).await;
        let claimed = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("claim");
        let snapshot = &claimed[0];
        assert!(snapshot.discovery_until < Utc::now());

        // The user reopens the address while that poll is in flight.
        activate(pool.clone(), Utc::now()).await;

        // The stale poll concludes "retire": it must not win.
        record_watch_poll(
            &pool,
            snapshot.id,
            WatchPollOutcome {
                next_poll_at: None,
                error: None,
                baseline_keys: None,
                discovery_until: snapshot.discovery_until,
            },
        )
        .await
        .expect("record stale retire");
        let renewed = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("claim renewed");
        assert_eq!(renewed.len(), 1, "renewed watch is still live and due");
        assert_eq!(renewed[0].id, snapshot.id);

        // Same race with a stale error backoff: the renewal's immediate poll wins.
        activate(pool.clone(), Utc::now()).await;
        record_watch_poll(
            &pool,
            snapshot.id,
            WatchPollOutcome {
                next_poll_at: Some(Utc::now() + Duration::minutes(10)),
                error: Some("bridge timeout"),
                baseline_keys: None,
                discovery_until: renewed[0].discovery_until,
            },
        )
        .await
        .expect("record stale backoff");
        assert_eq!(
            claim_due_watches(&pool, 10, Duration::seconds(60))
                .await
                .expect("claim after stale backoff")
                .len(),
            1,
            "stale backoff does not delay the renewed watch"
        );
    }

    #[sqlx::test]
    async fn confidential_watch_is_keyed_by_quote(pool: PgPool) {
        seed_dao(&pool, "conf.sputnik-dao.near", true).await;
        let now = Utc::now();
        for quote in ["quote-a", "quote-b", "quote-a"] {
            upsert_watch(
                &pool,
                "conf.sputnik-dao.near",
                WatchKind::Confidential,
                Some(quote),
                "eth:8453",
                Some("nep141:usdc"),
                now + Duration::minutes(10),
                now + Duration::minutes(120),
            )
            .await
            .expect("upsert confidential watch");
        }
        let claimed = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("claim");
        let mut quotes: Vec<_> = claimed
            .iter()
            .filter_map(|w| w.quote_deposit_address.clone())
            .collect();
        quotes.sort();
        assert_eq!(quotes, vec!["quote-a".to_string(), "quote-b".to_string()]);
    }
}

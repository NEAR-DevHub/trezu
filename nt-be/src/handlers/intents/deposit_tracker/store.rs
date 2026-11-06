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

    /// Whether `token_id` and `chain` are known for this deposit. The bridge
    /// names both per public deposit; a reusable-address payout carries the
    /// watch's last-shown asset until its ledger row names the credited one.
    pub fn asset_confirmed(&self) -> bool {
        self.kind == WatchKind::Public || self.ledger_event_id.is_some()
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

/// The treasury a confidential quote address was handed out to, looked up
/// by the address alone so the caller cannot steer the answer with a
/// different `dao_id`. Retired watches count: the address stays public.
pub async fn find_quote_owner(
    pool: &PgPool,
    quote_deposit_address: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT dao_id FROM deposit_watches
        WHERE kind = 'confidential' AND quote_deposit_address = $1
        LIMIT 1
        "#,
    )
    .bind(quote_deposit_address)
    .fetch_optional(pool)
    .await
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

/// Ledger rows a tracker row has already been linked to. The activity
/// feed never lets one of these stand in for a second, still-processing
/// deposit of the same token and amount.
pub async fn load_claimed_ledger_event_ids(
    pool: &PgPool,
    dao_id: &str,
) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT ledger_event_id
        FROM in_process_deposits
        WHERE dao_id = $1
          AND ledger_event_id IS NOT NULL
          AND ledger_confirmed_at > NOW() - $2
        "#,
    )
    .bind(dao_id)
    .bind(lease_interval(ACTIVE_DEPOSIT_MAX_AGE))
    .fetch_all(pool)
    .await
}

/// Rows the deposit modal shows for one address scope: the treasury's
/// reusable quote address or a public chain. Confirmed rows stay for the
/// activity window so the modal can say "received". `since` narrows the
/// window to rows first seen at or after an instant (a page open).
pub async fn load_recent_deposits_for_scope(
    pool: &PgPool,
    dao_id: &str,
    quote_deposit_address: Option<&str>,
    chain: Option<&str>,
    since: Option<DateTime<Utc>>,
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
          AND (
                $3::text IS NULL
                -- Reusable address: every payout of the DAO's quote.
                OR watch_id IN (
                    SELECT id FROM deposit_watches
                    WHERE dao_id = $1 AND kind = 'confidential' AND quote_deposit_address = $3
                )
              )
          AND ($4::text IS NULL OR chain = $4)
          AND ($5::timestamptz IS NULL OR detected_at >= $5)
        ORDER BY detected_at DESC
        LIMIT 20
        "#,
    )
    .bind(dao_id)
    .bind(lease_interval(ACTIVE_DEPOSIT_MAX_AGE))
    .bind(quote_deposit_address)
    .bind(chain)
    .bind(since)
    .fetch_all(pool)
    .await
}

/// Settled public deposit row for one tracker deposit, unclaimed by any other
/// tracker row. With the bridge mint hash the match is exact on the ledger
/// NEAR hash; without it, token + decimal amount + time window is the
/// strongest key available.
/// The gold row a settled deposit resolves to, with the amount it booked so
/// a row the provider reported without one can be filled in on confirm, and
/// the credited token when the ledger names it better than the tracker did.
#[derive(Debug, Clone, PartialEq, FromRow)]
pub struct LedgerMatch {
    pub event_id: i64,
    pub amount: Option<BigDecimal>,
    pub token_id: Option<String>,
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
        SELECT g.id AS event_id, g.amount_in AS amount, NULL::text AS token_id
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

/// Reusable-address deposits settle as one 1Click history row each, whose
/// `refundTo` is the quote address. Amount plus a time window around the
/// tracker's first sighting picks the row; the `NOT EXISTS` guard keeps
/// each gold row linked at most once. The gold row's `token_in` is the
/// credited token, which the payout feed does not name.
///
/// Shape of a payout row (1Click files each payout on the reusable address
/// as its own child swap; see `fixtures/reusable_payout_history_row.json`,
/// captured from a live row): `refundTo` is the reusable address,
/// `depositAddress` a per-payout child address, `originAsset` the credited
/// token. The parent ANY_INPUT quote (`refundTo` = the DAO, `originAsset`
/// = `1cs_v1:any`) is not a payout and never matches.
pub async fn find_reusable_ledger_match(
    pool: &PgPool,
    dao_id: &str,
    quote_deposit_address: &str,
    amount: Option<&BigDecimal>,
    not_before: DateTime<Utc>,
    not_after: DateTime<Utc>,
) -> Result<Option<LedgerMatch>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT g.id AS event_id, g.amount_in AS amount,
               NULLIF(g.token_in, '1cs_v1:any') AS token_id
        FROM bronze_confidential_history_events he
        JOIN gold_treasury_ledger_events g
          ON g.gold_event_key = 'confidential:' || he.id::text
        WHERE he.account_id = $1
          AND he.raw_payload->>'refundTo' = $2
          AND he.deposit_type = 'INTENTS'
          AND he.created_at_external BETWEEN $4 AND $5
          AND ($3::numeric IS NULL OR g.amount_in = $3)
          AND NOT EXISTS (
              SELECT 1 FROM in_process_deposits d WHERE d.ledger_event_id = g.id
          )
        ORDER BY he.created_at_external ASC, he.id ASC
        LIMIT 1
        "#,
    )
    .bind(dao_id)
    .bind(quote_deposit_address)
    .bind(amount)
    .bind(not_before)
    .bind(not_after)
    .fetch_optional(pool)
    .await
}

/// Links the row to its gold row. A match that names the credited token
/// (and the chain derived from it) replaces the tracker's provisional label,
/// which for a shared reusable watch is only whichever asset was last shown.
pub async fn confirm_ledger(
    pool: &PgPool,
    deposit_id: i64,
    ledger: &LedgerMatch,
    chain: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE in_process_deposits
        SET status = 'ledger_confirmed',
            ledger_event_id = $2,
            amount = COALESCE(amount, $3),
            token_id = COALESCE($4, token_id),
            chain = COALESCE($5, chain),
            ledger_confirmed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
          AND status <> 'ledger_confirmed'
        "#,
    )
    .bind(deposit_id)
    .bind(ledger.event_id)
    .bind(&ledger.amount)
    .bind(&ledger.token_id)
    .bind(chain)
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
            token_id: None,
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
        confirm_ledger(&pool, deposits[0].id, &ledger, None)
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
    async fn reusable_scope_filters_by_since_and_relabels_on_confirm(pool: PgPool) {
        seed_dao(&pool, "rda.sputnik-dao.near", true).await;
        let now = Utc::now();
        upsert_watch(
            &pool,
            "rda.sputnik-dao.near",
            WatchKind::Confidential,
            Some("rda-quote"),
            "sol:mainnet",
            Some("nep141:sol.omft.near"),
            now + Duration::minutes(10),
            now + Duration::minutes(120),
        )
        .await
        .expect("upsert reusable watch");
        let watch = claim_due_watches(&pool, 10, Duration::seconds(60))
            .await
            .expect("claim")
            .into_iter()
            .find(|w| w.quote_deposit_address.as_deref() == Some("rda-quote"))
            .expect("reusable watch");
        // The shared watch labels every payout with the asset last shown.
        for key in ["rda:old", "rda:new"] {
            let mut payout = observed(key, DepositStatus::Finalized);
            payout.chain = Some("sol:mainnet".to_string());
            payout.token_id = "nep141:sol.omft.near".to_string();
            upsert_deposit(
                &pool,
                watch.id,
                &watch.dao_id,
                WatchKind::Confidential,
                &payout,
            )
            .await
            .expect("upsert payout");
        }
        sqlx::query(
            "UPDATE in_process_deposits SET detected_at = NOW() - interval '2 hours' \
             WHERE provider_deposit_key = 'rda:old'",
        )
        .execute(&pool)
        .await
        .expect("age the old payout");

        let all =
            load_recent_deposits_for_scope(&pool, &watch.dao_id, Some("rda-quote"), None, None)
                .await
                .expect("full scope");
        assert_eq!(all.len(), 2);
        let recent = load_recent_deposits_for_scope(
            &pool,
            &watch.dao_id,
            Some("rda-quote"),
            None,
            Some(now - Duration::minutes(30)),
        )
        .await
        .expect("since scope");
        assert_eq!(
            recent
                .iter()
                .map(|d| d.provider_deposit_key.as_str())
                .collect::<Vec<_>>(),
            vec!["rda:new"]
        );

        let event_id: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO gold_treasury_ledger_events (
                gold_event_key, dao_id, source_kind, history_visible, transaction_type,
                status, event_time, token_in, amount_in
            )
            VALUES ('confidential:relabel-test', $1, 'public_silver_leg', true, 'deposit',
                    'success', NOW(), $2, 100.000000)
            RETURNING id
            "#,
        )
        .bind(&watch.dao_id)
        .bind("nep141:base-0x8335.omft.near")
        .fetch_one(&pool)
        .await
        .expect("seed gold row");
        let ledger = LedgerMatch {
            event_id,
            amount: Some(BigDecimal::from(100)),
            token_id: Some("nep141:base-0x8335.omft.near".to_string()),
        };
        confirm_ledger(&pool, recent[0].id, &ledger, Some("eth:8453"))
            .await
            .expect("confirm");

        let rows = load_watch_deposits(&pool, watch.id).await.expect("rows");
        let confirmed = rows
            .iter()
            .find(|d| d.provider_deposit_key == "rda:new")
            .expect("confirmed row");
        assert_eq!(confirmed.status, DepositStatus::LedgerConfirmed);
        assert_eq!(confirmed.token_id, "nep141:base-0x8335.omft.near");
        assert_eq!(confirmed.chain.as_deref(), Some("eth:8453"));
        let provisional = rows
            .iter()
            .find(|d| d.provider_deposit_key == "rda:old")
            .expect("old row");
        assert_eq!(provisional.token_id, "nep141:sol.omft.near");
        assert_eq!(provisional.chain.as_deref(), Some("sol:mainnet"));
    }

    const REUSABLE_PAYOUT_ROW: &str = include_str!("fixtures/reusable_payout_history_row.json");

    async fn seed_history_row(
        pool: &PgPool,
        dao_id: &str,
        payload: &serde_json::Value,
        amount: &str,
    ) -> i64 {
        let bronze_id: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO bronze_confidential_history_events (
                account_id, created_at_external, deposit_address, deposit_memo, status,
                deposit_type, recipient_type, recipient, origin_asset, destination_asset,
                raw_payload
            )
            VALUES ($1, NOW(), $2->>'depositAddress', $2->>'depositMemo', $2->>'status',
                    $2->>'depositType', $2->>'recipientType', $2->>'recipient',
                    $2->>'originAsset', $2->>'destinationAsset', $2)
            RETURNING id
            "#,
        )
        .bind(dao_id)
        .bind(payload)
        .fetch_one(pool)
        .await
        .expect("seed bronze row");
        sqlx::query_scalar(
            r#"
            INSERT INTO gold_treasury_ledger_events (
                gold_event_key, dao_id, source_kind, history_visible, transaction_type,
                status, event_time, token_in, amount_in
            )
            VALUES ('confidential:' || $1::text, $2, 'confidential_history_event', true, 'deposit',
                    'success', NOW(), $3, $4::numeric)
            RETURNING id
            "#,
        )
        .bind(bronze_id)
        .bind(dao_id)
        .bind(payload["originAsset"].as_str())
        .bind(amount)
        .fetch_one(pool)
        .await
        .expect("seed gold row")
    }

    /// Pins the live payload shape: the payout row's `refundTo` is the
    /// reusable address and its `originAsset` the credited token. The parent
    /// quote's shape (`refundTo` = DAO, `originAsset` = `1cs_v1:any`) must
    /// neither match nor leak its placeholder as a token.
    #[sqlx::test]
    async fn reusable_match_keys_on_the_payout_refund_to(pool: PgPool) {
        let payout: serde_json::Value =
            serde_json::from_str(REUSABLE_PAYOUT_ROW).expect("fixture parses");
        let dao_id = payout["recipient"].as_str().unwrap().to_string();
        let rda = payout["refundTo"].as_str().unwrap().to_string();
        let child = payout["depositAddress"].as_str().unwrap().to_string();
        assert_ne!(
            rda, child,
            "fixture: child address differs from the reusable one"
        );
        seed_dao(&pool, &dao_id, true).await;
        let event_id = seed_history_row(&pool, &dao_id, &payout, "0.2").await;
        let window = (
            Utc::now() - Duration::hours(1),
            Utc::now() + Duration::hours(1),
        );

        let matched = find_reusable_ledger_match(&pool, &dao_id, &rda, None, window.0, window.1)
            .await
            .expect("query")
            .expect("payout row matches on refundTo");
        assert_eq!(matched.event_id, event_id);
        assert_eq!(
            matched.token_id.as_deref(),
            Some("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near")
        );
        assert_eq!(
            find_reusable_ledger_match(&pool, &dao_id, &child, None, window.0, window.1)
                .await
                .expect("query"),
            None,
            "the per-payout child address is not the key"
        );

        let mut parent = payout.clone();
        parent["refundTo"] = serde_json::Value::String(dao_id.clone());
        parent["originAsset"] = serde_json::Value::String("1cs_v1:any".to_string());
        parent["depositAddress"] = serde_json::Value::String(rda.clone());
        seed_history_row(&pool, &dao_id, &parent, "0.3").await;
        let mut placeholder = payout.clone();
        placeholder["originAsset"] = serde_json::Value::String("1cs_v1:any".to_string());
        placeholder["depositAddress"] = serde_json::Value::String("child-2".to_string());
        seed_history_row(&pool, &dao_id, &placeholder, "0.4").await;

        let again = find_reusable_ledger_match(
            &pool,
            &dao_id,
            &rda,
            Some(&"0.4".parse().unwrap()),
            window.0,
            window.1,
        )
        .await
        .expect("query")
        .expect("payout without a usable asset still matches");
        assert_eq!(
            again.token_id, None,
            "the ANY_INPUT placeholder is not a token"
        );
        assert_eq!(
            find_reusable_ledger_match(
                &pool,
                &dao_id,
                &rda,
                Some(&"0.3".parse().unwrap()),
                window.0,
                window.1
            )
            .await
            .expect("query"),
            None,
            "the parent quote row never matches the reusable address"
        );
    }

    /// Two equal payouts in sequence each get their own ledger row, in
    /// order, and the unique link index refuses a second claim of a row
    /// that reconcile would otherwise never make.
    #[sqlx::test]
    async fn equal_payouts_each_claim_their_own_ledger_row(pool: PgPool) {
        let payout: serde_json::Value =
            serde_json::from_str(REUSABLE_PAYOUT_ROW).expect("fixture parses");
        let dao_id = payout["recipient"].as_str().unwrap().to_string();
        let rda = payout["refundTo"].as_str().unwrap().to_string();
        seed_dao(&pool, &dao_id, true).await;
        let now = Utc::now();
        upsert_watch(
            &pool,
            &dao_id,
            WatchKind::Confidential,
            Some(&rda),
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
        let first_event = seed_history_row(&pool, &dao_id, &payout, "0.2").await;
        let second_event = seed_history_row(&pool, &dao_id, &payout, "0.2").await;
        let mut rows = Vec::new();
        for key in [
            "rda:2026-11-03T12:00:00+00:00",
            "rda:2026-11-03T12:00:05+00:00",
        ] {
            let mut seen = observed(key, DepositStatus::Finalized);
            seen.amount = Some("0.2".parse().unwrap());
            rows.push(
                upsert_deposit(&pool, watch.id, &dao_id, WatchKind::Confidential, &seen)
                    .await
                    .expect("upsert deposit")
                    .id,
            );
        }
        let amount: BigDecimal = "0.2".parse().unwrap();
        let window = (now - Duration::hours(1), now + Duration::hours(1));

        let first =
            find_reusable_ledger_match(&pool, &dao_id, &rda, Some(&amount), window.0, window.1)
                .await
                .expect("query")
                .expect("first payout matches");
        assert_eq!(first.event_id, first_event, "earliest unclaimed row first");
        confirm_ledger(&pool, rows[0], &first, None)
            .await
            .expect("link first");

        let second =
            find_reusable_ledger_match(&pool, &dao_id, &rda, Some(&amount), window.0, window.1)
                .await
                .expect("query")
                .expect("second payout matches");
        assert_eq!(second.event_id, second_event, "claimed row is skipped");
        confirm_ledger(&pool, rows[1], &second, None)
            .await
            .expect("link second");

        assert!(
            find_reusable_ledger_match(&pool, &dao_id, &rda, Some(&amount), window.0, window.1)
                .await
                .expect("query")
                .is_none(),
            "nothing left to claim"
        );
        let double_claim =
            sqlx::query("UPDATE in_process_deposits SET ledger_event_id = $1 WHERE id = $2")
                .bind(first_event)
                .bind(rows[1])
                .execute(&pool)
                .await;
        assert!(
            double_claim.is_err(),
            "unique link index refuses a second claim"
        );
    }
}

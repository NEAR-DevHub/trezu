//! Balance observations: history for holdings that move without any
//! transaction on the DAO account — staking rewards and lockup contracts.
//!
//! Neither reaches the DAO's indexed history, so the only historical source
//! is reading state at chart boundaries: live for today, archival for the
//! horizon (90 daily + 53 weekly boundaries). Each worker stores its readings
//! as provenance (never re-hits archival RPC for a covered boundary) and
//! replays them as hidden `observation` ledger entries on a synthetic asset
//! (`staking:{pool}`, `lockup:{lockup_account}`) that flow into the unified
//! table and charts. Boundaries whose block cannot be resolved or read are
//! skipped — coverage stays incomplete rather than fabricated, and chart
//! readiness waits for it.
//!
//! This module holds what both workers share: the boundary grid, the
//! chain-validated boundary-block cache, the series rebuild, the cycle
//! budget, per-boundary retry backoff and the required-boundary rule.
//! [`staking`] and [`lockup`] hold the two workers.
//!
//! Rate limits, measured against the configured FastNear archival endpoint:
//! no throttling observed (10-parallel burst all-200); throughput is bounded
//! by ~0.8s round-trip latency. Sequential reads and a per-cycle cap keep us
//! far below any realistic ceiling.

pub mod lockup;
pub mod staking;

use std::collections::BTreeMap;
use std::sync::Arc;

use bigdecimal::BigDecimal;
use chrono::{DateTime, Datelike, Duration, Utc};
use near_api::{Chain, Reference};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Transaction};

use crate::AppState;
use crate::handlers::balance_changes::utils::with_transport_retry;

const DAILY_HORIZON_DAYS: i64 = 90;
const WEEKLY_HORIZON_WEEKS: i64 = 53;
/// Observation entries sort after real movements but before verification
/// rebases inside a block.
const OBSERVATION_INTRA_BLOCK_SEQ: i32 = 900_000;
const NATIVE_DECIMALS: i32 = 24;
/// Bound on archival reads per cycle so one account cannot monopolize a
/// cycle; backfill continues next cycle.
pub(super) const MAX_READS_PER_CYCLE: usize = 200;
/// Backfill reads one account may consume per cycle, so a large backlog on
/// one treasury cannot starve the others. The fresh pass is uncapped.
pub(super) const MAX_READS_PER_ACCOUNT: usize = 60;
/// Boundaries this recent are captured for every account before any backfill.
/// Also the chart's staleness threshold: a completed series older than this
/// window has missed two daily captures.
pub const FRESH_WINDOW_DAYS: i64 = 2;
/// Discovery and validation probes (one cheap chain call each) per cycle,
/// charged to the same budget so an outage cannot fan out across accounts.
pub(super) const MAX_PROBES_PER_CYCLE: usize = 50;
/// NEAR skips heights; a validated boundary block is searched this far back
/// from an estimate before the estimate is declared unusable.
const MAX_SKIPPED_HEIGHTS: u64 = 10;
/// Probe rounds to pin a boundary block down: bisection once the boundary is
/// bracketed, so even a far-off estimate converges within this budget.
const MAX_BOUNDARY_ADJUSTMENTS: usize = 24;
/// A validated block this close before the boundary is accepted as the
/// boundary block.
const BOUNDARY_TOLERANCE_SECS: i64 = 60;
const AVERAGE_BLOCK_MS: i64 = 1100;
const RETRY_BASE_SECS: i64 = 300;
const RETRY_MAX_SECS: i64 = 86_400;

/// Which boundaries an observation pass targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Pass {
    /// Boundaries inside the fresh window, every account, uncapped — daily
    /// capture is never starved by someone else's backlog.
    Fresh,
    /// Every required boundary, oldest first, capped per account.
    Backfill,
}

impl Pass {
    pub(super) const ALL: [Pass; 2] = [Pass::Fresh, Pass::Backfill];

    pub(super) fn targets(
        self,
        required: &[DateTime<Utc>],
        now: DateTime<Utc>,
    ) -> Vec<DateTime<Utc>> {
        match self {
            Pass::Fresh => {
                let fresh_from = now - Duration::days(FRESH_WINDOW_DAYS);
                required
                    .iter()
                    .copied()
                    .filter(|boundary| *boundary >= fresh_from)
                    .collect()
            }
            Pass::Backfill => required.to_vec(),
        }
    }

    pub(super) fn account_cap(self) -> usize {
        match self {
            Pass::Fresh => usize::MAX,
            Pass::Backfill => MAX_READS_PER_ACCOUNT,
        }
    }
}

/// Retry state for one boundary, keyed by the boundary's RFC 3339 timestamp
/// in a cursor's `failed_boundaries` blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct BoundaryFailure {
    pub attempts: u32,
    pub next_retry_at: DateTime<Utc>,
    pub error: String,
}

pub(super) type BoundaryFailures = BTreeMap<String, BoundaryFailure>;

pub(super) fn failure_key(boundary: DateTime<Utc>) -> String {
    boundary.to_rfc3339()
}

pub(super) fn is_backing_off(failures: &BoundaryFailures, key: &str, now: DateTime<Utc>) -> bool {
    failures
        .get(key)
        .is_some_and(|failure| failure.next_retry_at > now)
}

pub(super) fn record_failure(
    failures: &mut BoundaryFailures,
    key: String,
    now: DateTime<Utc>,
    error: &str,
) {
    let attempts = failures.get(&key).map_or(0, |failure| failure.attempts) + 1;
    failures.insert(
        key,
        BoundaryFailure {
            attempts,
            next_retry_at: now + retry_backoff(attempts),
            error: error.to_string(),
        },
    );
}

pub(super) fn retry_backoff(attempts: u32) -> Duration {
    let exponent = attempts.saturating_sub(1).min(16);
    let secs = (RETRY_BASE_SECS.saturating_mul(1i64 << exponent)).min(RETRY_MAX_SECS);
    Duration::seconds(secs)
}

/// Where an account's chart coverage starts and, for a capped account, the
/// cap the chart discards everything before. `None` when the account has no
/// ledger rows yet.
pub(super) async fn account_coverage(
    pool: &PgPool,
    account_id: &str,
) -> Result<Option<(DateTime<Utc>, Option<DateTime<Utc>>)>, sqlx::Error> {
    let (coverage_start, capped_at): (Option<DateTime<Utc>>, Option<DateTime<Utc>>) =
        sqlx::query_as(
            r#"
            SELECT
                GREATEST(
                    (SELECT MIN(block_time) FROM silver_balance_history WHERE account_id = $1),
                    (SELECT MAX(capped_at_time) FROM bronze_public_history_cursors
                     WHERE account_id = $1 AND backfill_capped = true)
                ),
                (SELECT MAX(capped_at_time) FROM bronze_public_history_cursors
                 WHERE account_id = $1 AND backfill_capped = true)
            "#,
        )
        .bind(account_id)
        .fetch_one(pool)
        .await?;
    Ok(coverage_start.map(|start| (start, capped_at)))
}

/// Boundaries a series must cover: every chart boundary from the last one at
/// or before the account's ledger coverage start. That baseline boundary
/// gives the first renderable bucket a carry-forward value, and it keeps the
/// set non-empty for an account whose ledger started after today's boundary.
/// For a capped account the chart discards everything before the cap, so the
/// baseline may not fall below it; the first boundary at or after the cap
/// takes its place.
pub(super) fn required_boundaries(
    boundaries: &[DateTime<Utc>],
    coverage_start: DateTime<Utc>,
    capped_at: Option<DateTime<Utc>>,
) -> Vec<DateTime<Utc>> {
    let baseline = boundaries
        .iter()
        .copied()
        .filter(|boundary| *boundary <= coverage_start)
        .max();
    boundaries
        .iter()
        .copied()
        .filter(|boundary| baseline.is_none_or(|baseline| *boundary >= baseline))
        .filter(|boundary| capped_at.is_none_or(|cap| *boundary >= cap))
        .collect()
}

/// Public accounts whose history is live and fully backfilled: the only ones
/// observation workers may discover for or spend archival reads on. Disabled
/// and paused accounts drop out here, so their cursors stop costing RPC.
pub(super) async fn observable_accounts(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT m.account_id
        FROM monitored_accounts m
        WHERE m.enabled = true
          AND m.history_ingestion_paused_at IS NULL
          AND COALESCE(m.is_confidential_account, false) = false
          AND (
              SELECT COUNT(*) FROM bronze_public_history_cursors c
              WHERE c.account_id = m.account_id
                AND c.source IN (
                    'nearblocks_ft'::public_history_source,
                    'nearblocks_mt'::public_history_source,
                    'nearblocks_receipt'::public_history_source
                )
                AND c.backfill_done = true
          ) = 3
        ORDER BY m.account_id
        "#,
    )
    .fetch_all(pool)
    .await
}

/// One archival reading of a synthetic asset at a chart boundary.
#[derive(Debug, Clone, sqlx::FromRow)]
pub(super) struct ObservationReading {
    pub observed_at: DateTime<Utc>,
    pub block_height: i64,
    pub balance: BigDecimal,
}

/// Rebuild a synthetic asset's `observation` ledger entries from its full
/// reading series and mirror them into the unified table. Ordered replay
/// matters because backfill discovers OLD boundaries after newer ones may
/// already exist: deltas are recomputed from the whole series, never appended.
pub(super) async fn rebuild_observation_series(
    tx: &mut Transaction<'_, Postgres>,
    account_id: &str,
    asset: &str,
    counterparty: &str,
    readings: &[ObservationReading],
) -> Result<(), sqlx::Error> {
    // The staking and lockup workers both rewrite this account's hidden gold
    // rows; without a per-account lock their transactions deadlock on the
    // unified table. Serialise on the account for the rest of the transaction.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
        .bind(account_id)
        .execute(&mut **tx)
        .await?;

    // Delete-then-insert in observation order. Hidden gold rows cascade with
    // their entries, so the sync below re-inserts the full series.
    sqlx::query(
        "DELETE FROM silver_balance_history
         WHERE account_id = $1 AND asset = $2 AND entry_kind = 'observation'",
    )
    .bind(account_id)
    .bind(asset)
    .execute(&mut **tx)
    .await?;

    let mut ordered: Vec<&ObservationReading> = readings.iter().collect();
    ordered.sort_by_key(|reading| (reading.observed_at, reading.block_height));
    let mut entry_keys = Vec::with_capacity(ordered.len());
    let mut heights = Vec::with_capacity(ordered.len());
    let mut times = Vec::with_capacity(ordered.len());
    let mut balances = Vec::with_capacity(ordered.len());
    let mut befores = Vec::with_capacity(ordered.len());
    let mut previous = BigDecimal::from(0);
    for reading in ordered {
        entry_keys.push(format!(
            "observation:{account_id}:{asset}:{}",
            reading.block_height
        ));
        heights.push(reading.block_height);
        times.push(reading.observed_at);
        balances.push(reading.balance.clone());
        befores.push(previous.clone());
        previous = reading.balance.clone();
    }

    sqlx::query(
        r#"
        INSERT INTO silver_balance_history (
            account_id, asset, token_standard, entry_kind, entry_key,
            source, source_event_id, receipt_id, transaction_hash,
            counterparty, block_height, block_time, intra_block_seq,
            delta_raw, delta, decimals, balance_before, balance_after,
            affects_user_balance, user_balance_after
        )
        SELECT
            $1, $2, 'native', 'observation', r.entry_key,
            NULL, NULL, NULL, NULL,
            $3, r.block_height, r.observed_at, $4,
            (r.balance - r.balance_before) * POWER(10::numeric, $5),
            r.balance - r.balance_before,
            $5,
            r.balance_before,
            r.balance,
            TRUE,
            r.balance
        FROM UNNEST(
            $6::text[], $7::bigint[], $8::timestamptz[], $9::numeric[], $10::numeric[]
        ) AS r(entry_key, block_height, observed_at, balance, balance_before)
        "#,
    )
    .bind(account_id)
    .bind(asset)
    .bind(counterparty)
    .bind(OBSERVATION_INTRA_BLOCK_SEQ)
    .bind(NATIVE_DECIMALS)
    .bind(&entry_keys)
    .bind(&heights)
    .bind(&times)
    .bind(&balances)
    .bind(&befores)
    .execute(&mut **tx)
    .await?;

    // Mirror into the unified table so charts see the series without waiting
    // for a gold projection cycle. The epoch is the "everything" sentinel:
    // chrono's MIN_UTC is outside Postgres's timestamptz range and fails the
    // whole transaction.
    crate::handlers::public_history::gold::unified::sync_hidden_ledger_rows(
        tx,
        account_id,
        DateTime::<Utc>::UNIX_EPOCH,
    )
    .await?;
    Ok(())
}

/// Daily boundaries for the last 90 days plus weekly (Monday) boundaries out
/// to 53 weeks, ascending and deduplicated.
pub(super) fn chart_boundaries(now: DateTime<Utc>) -> Vec<DateTime<Utc>> {
    let today = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
    let mut boundaries = Vec::new();
    for weeks_back in (0..=WEEKLY_HORIZON_WEEKS).rev() {
        let day = today - Duration::weeks(weeks_back);
        let monday = day - Duration::days(day.weekday().num_days_from_monday() as i64);
        boundaries.push(monday);
    }
    for days_back in (0..=DAILY_HORIZON_DAYS).rev() {
        boundaries.push(today - Duration::days(days_back));
    }
    boundaries.sort();
    boundaries.dedup();
    boundaries
}

/// Chain-validated block at (or just before) a chart boundary, cached in
/// `observation_boundary_blocks` and shared by every worker and account. The
/// bronze interpolation is only a starting point: NEAR skips heights, so an
/// unvalidated estimate can name a block that never existed and would fail
/// every retry forever.
pub(super) async fn resolve_boundary_block(
    state: &Arc<AppState>,
    boundary: DateTime<Utc>,
) -> Result<BoundaryResolution, sqlx::Error> {
    let cached: Option<i64> = sqlx::query_scalar(
        "SELECT block_height FROM observation_boundary_blocks WHERE boundary = $1",
    )
    .bind(boundary)
    .fetch_optional(&state.db_pool)
    .await?;
    if let Some(height) = cached {
        return Ok(BoundaryResolution {
            block_height: Some(height),
            rpc_calls: 0,
        });
    }
    let Some(estimate) = estimate_block_at(&state.db_pool, boundary).await? else {
        return Ok(BoundaryResolution {
            block_height: None,
            rpc_calls: 0,
        });
    };
    let mut rpc_calls = 0;
    let validated =
        match validate_boundary_block(&state.archival_network, estimate, boundary, &mut rpc_calls)
            .await
        {
            Ok(found) => found,
            Err(error) => {
                tracing::warn!(%boundary, estimate, %error, "boundary block validation failed");
                None
            }
        };
    let Some((height, block_time)) = validated else {
        return Ok(BoundaryResolution {
            block_height: None,
            rpc_calls,
        });
    };
    sqlx::query(
        "INSERT INTO observation_boundary_blocks (boundary, block_height, block_time)
         VALUES ($1, $2, $3)
         ON CONFLICT (boundary) DO NOTHING",
    )
    .bind(boundary)
    .bind(height)
    .bind(block_time)
    .execute(&state.db_pool)
    .await?;
    Ok(BoundaryResolution {
        block_height: Some(height),
        rpc_calls,
    })
}

/// Outcome of a boundary lookup. `rpc_calls` is the exact number of archival
/// block queries spent, so callers can charge their cycle budget even when
/// the boundary stays unresolved. Zero for a cache hit.
#[derive(Debug, Clone, Copy)]
pub(super) struct BoundaryResolution {
    pub block_height: Option<i64>,
    pub rpc_calls: usize,
}

/// Height estimate for a boundary from the indexed events of every monitored
/// account: interpolated between the nearest rows on either side, or
/// extrapolated at the average block time when only one side exists. No
/// indexed history at all → no estimate.
async fn estimate_block_at(
    pool: &PgPool,
    boundary: DateTime<Utc>,
) -> Result<Option<i64>, sqlx::Error> {
    let before: Option<(i64, DateTime<Utc>)> = sqlx::query_as(
        "SELECT block_height, block_time FROM bronze_public_history_events
         WHERE block_time <= $1 ORDER BY block_time DESC LIMIT 1",
    )
    .bind(boundary)
    .fetch_optional(pool)
    .await?;
    let after: Option<(i64, DateTime<Utc>)> = sqlx::query_as(
        "SELECT block_height, block_time FROM bronze_public_history_events
         WHERE block_time >= $1 ORDER BY block_time ASC LIMIT 1",
    )
    .bind(boundary)
    .fetch_optional(pool)
    .await?;

    Ok(match (before, after) {
        (Some((height_before, time_before)), Some((height_after, time_after))) => {
            if height_after <= height_before || time_after <= time_before {
                Some(height_before)
            } else {
                let span = (time_after - time_before).num_seconds().max(1);
                let offset = (boundary - time_before).num_seconds().clamp(0, span);
                Some(height_before + (height_after - height_before) * offset / span)
            }
        }
        (Some((height_before, time_before)), None) => {
            Some(height_before + (boundary - time_before).num_milliseconds() / AVERAGE_BLOCK_MS)
        }
        (None, Some((height_after, time_after))) => Some(
            (height_after - (time_after - boundary).num_milliseconds() / AVERAGE_BLOCK_MS).max(0),
        ),
        (None, None) => None,
    })
}

/// Pin down the latest existing block at or before the boundary, starting
/// from an estimate: extrapolate at the average block time until the
/// boundary is bracketed, then bisect. Only an acceptable block is returned —
/// a far-off "best effort" block would be cached forever and its balance
/// attributed to the wrong day. `Err` only on transport failure.
async fn validate_boundary_block(
    network: &near_api::NetworkConfig,
    estimate: i64,
    boundary: DateTime<Utc>,
    rpc_calls: &mut usize,
) -> Result<Option<(i64, DateTime<Utc>)>, String> {
    let mut probe = estimate.max(0);
    let mut before: Option<(i64, DateTime<Utc>)> = None;
    let mut after: Option<(i64, DateTime<Utc>)> = None;
    for _ in 0..MAX_BOUNDARY_ADJUSTMENTS {
        let Some((height, block_time)) =
            fetch_block_at_or_below(network, probe as u64, rpc_calls).await?
        else {
            return Ok(None);
        };
        if block_time <= boundary {
            if before.is_none_or(|(known, _)| height > known) {
                before = Some((height, block_time));
            }
        } else if after.is_none_or(|(known, _)| height < known) {
            after = Some((height, block_time));
        }
        if let Some(accepted) = accepted_boundary_block(before, after, boundary) {
            return Ok(Some(accepted));
        }
        let Some(next) = next_probe_height(before, after, boundary) else {
            return Ok(None);
        };
        probe = next;
    }
    Ok(None)
}

/// The block at or before the boundary counts as found once it is within
/// tolerance of the boundary, or bracketed by a known later block at most
/// `MAX_SKIPPED_HEIGHTS + 1` heights above it. The bracket is not probed for
/// intervening blocks on purpose: any block hiding in that gap sits at most
/// ~10 heights (a dozen seconds) after the accepted one, which is well inside
/// the tolerance we already accept, and bisecting a gap of skipped heights
/// cannot make progress (each probe walks back to the same known block).
fn accepted_boundary_block(
    before: Option<(i64, DateTime<Utc>)>,
    after: Option<(i64, DateTime<Utc>)>,
    boundary: DateTime<Utc>,
) -> Option<(i64, DateTime<Utc>)> {
    let (height, block_time) = before?;
    let within_tolerance = (boundary - block_time).num_seconds() <= BOUNDARY_TOLERANCE_SECS;
    let bracketed = after
        .is_some_and(|(after_height, _)| after_height - height <= 1 + MAX_SKIPPED_HEIGHTS as i64);
    (within_tolerance || bracketed).then_some((height, block_time))
}

/// Next height to probe: bisect a bracketed boundary, otherwise extrapolate
/// from the one known side at the average block time.
fn next_probe_height(
    before: Option<(i64, DateTime<Utc>)>,
    after: Option<(i64, DateTime<Utc>)>,
    boundary: DateTime<Utc>,
) -> Option<i64> {
    match (before, after) {
        (Some((low, _)), Some((high, _))) => (high - low > 1).then(|| low + (high - low) / 2),
        (Some((low, time)), None) => {
            Some(low + ((boundary - time).num_milliseconds() / AVERAGE_BLOCK_MS).max(1))
        }
        (None, Some((high, time))) => {
            Some((high - ((time - boundary).num_milliseconds() / AVERAGE_BLOCK_MS).max(1)).max(0))
        }
        (None, None) => None,
    }
}

/// The block at `height`, or the nearest existing block below it within
/// `MAX_SKIPPED_HEIGHTS`. `Err` on transport failure, `Ok(None)` when every
/// candidate height was skipped.
async fn fetch_block_at_or_below(
    network: &near_api::NetworkConfig,
    height: u64,
    rpc_calls: &mut usize,
) -> Result<Option<(i64, DateTime<Utc>)>, String> {
    for offset in 0..=MAX_SKIPPED_HEIGHTS {
        let Some(candidate) = height.checked_sub(offset) else {
            break;
        };
        *rpc_calls += 1;
        match with_transport_retry("boundary_block", || {
            Chain::block()
                .at(Reference::AtBlock(candidate))
                .fetch_from(network)
        })
        .await
        {
            Ok(block) => {
                let block_time = DateTime::from_timestamp_nanos(block.header.timestamp as i64);
                return Ok(Some((block.header.height as i64, block_time)));
            }
            Err(error) => {
                let message = error.to_string();
                if is_block_unavailable(&message) {
                    continue;
                }
                return Err(message);
            }
        }
    }
    Ok(None)
}

/// Only the RPC's own "this height has no block" signals. A skipped height on
/// the archival endpoint answers `HANDLER_ERROR / UNKNOWN_BLOCK` with
/// "DB Not Found Error: BLOCK HEIGHT …" (verified live); a garbage-collected
/// block on a non-archival node names itself. Anything else — a 422 from a
/// malformed request, a transport failure — must surface as an error so the
/// boundary backs off instead of being written off as skipped.
fn is_block_unavailable(message: &str) -> bool {
    message.contains("UNKNOWN_BLOCK")
        || message.contains("UnknownBlock")
        || message.contains("DB Not Found")
        || message.contains("GarbageCollectedBlock")
}

pub(super) async fn latest_known_block(
    pool: &PgPool,
) -> Result<Option<(DateTime<Utc>, i64)>, sqlx::Error> {
    let row: Option<(i64, DateTime<Utc>)> = sqlx::query_as(
        "SELECT block_height, block_time FROM bronze_public_history_events
         ORDER BY block_height DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(height, time)| (time, height)))
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use chrono::TimeZone;

    use super::*;

    fn reading(observed_at: DateTime<Utc>, block_height: i64, balance: &str) -> ObservationReading {
        ObservationReading {
            observed_at,
            block_height,
            balance: BigDecimal::from_str(balance).unwrap(),
        }
    }

    async fn series_rows(
        pool: &PgPool,
        account_id: &str,
        asset: &str,
    ) -> sqlx::Result<Vec<(i64, BigDecimal, BigDecimal, BigDecimal, String)>> {
        sqlx::query_as(
            "SELECT block_height, balance_before, balance_after, delta, entry_key
             FROM silver_balance_history
             WHERE account_id = $1 AND asset = $2 AND entry_kind = 'observation'
             ORDER BY block_time, block_height",
        )
        .bind(account_id)
        .bind(asset)
        .fetch_all(pool)
        .await
    }

    /// Backfill discovers OLD boundaries after newer ones exist: the series
    /// must be replayed from the full reading set, deltas included, and the
    /// hidden gold mirror must follow.
    #[sqlx::test]
    async fn rebuild_observation_series_replays_out_of_order_readings(
        pool: PgPool,
    ) -> sqlx::Result<()> {
        let account = "dao.near";
        let asset = "lockup:abc.lockup.near";
        sqlx::query("INSERT INTO monitored_accounts (account_id) VALUES ($1)")
            .bind(account)
            .execute(&pool)
            .await?;
        let day = |d: u32| Utc.with_ymd_and_hms(2026, 9, d, 0, 0, 0).unwrap();

        let mut readings = vec![
            reading(day(3), 300, "30"),
            reading(day(1), 100, "10"),
            reading(day(2), 200, "25"),
        ];
        let mut tx = pool.begin().await?;
        rebuild_observation_series(&mut tx, account, asset, "abc.lockup.near", &readings).await?;
        tx.commit().await?;

        let rows = series_rows(&pool, account, asset).await?;
        let expected = |height: i64, before: &str, after: &str, delta: &str| {
            (
                height,
                BigDecimal::from_str(before).unwrap(),
                BigDecimal::from_str(after).unwrap(),
                BigDecimal::from_str(delta).unwrap(),
                format!("observation:{account}:{asset}:{height}"),
            )
        };
        assert_eq!(
            rows,
            vec![
                expected(100, "0", "10", "10"),
                expected(200, "10", "25", "15"),
                expected(300, "25", "30", "5"),
            ]
        );
        let hidden: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM gold_treasury_ledger_events
             WHERE dao_id = $1 AND source_kind = 'public_balance_ledger'",
        )
        .bind(account)
        .fetch_one(&pool)
        .await?;
        assert_eq!(hidden, 3);

        // An older boundary arriving later rebases every later delta.
        readings.push(reading(
            Utc.with_ymd_and_hms(2026, 8, 31, 0, 0, 0).unwrap(),
            50,
            "4",
        ));
        let mut tx = pool.begin().await?;
        rebuild_observation_series(&mut tx, account, asset, "abc.lockup.near", &readings).await?;
        tx.commit().await?;

        let rows = series_rows(&pool, account, asset).await?;
        assert_eq!(
            rows,
            vec![
                expected(50, "0", "4", "4"),
                expected(100, "4", "10", "6"),
                expected(200, "10", "25", "15"),
                expected(300, "25", "30", "5"),
            ]
        );
        let hidden: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM gold_treasury_ledger_events
             WHERE dao_id = $1 AND source_kind = 'public_balance_ledger'",
        )
        .bind(account)
        .fetch_one(&pool)
        .await?;
        assert_eq!(hidden, 4);
        Ok(())
    }

    #[test]
    fn boundary_block_is_accepted_only_when_pinned_down() {
        let boundary = Utc.with_ymd_and_hms(2026, 9, 10, 0, 0, 0).unwrap();
        let far_before = (1_000, boundary - Duration::hours(2));
        let near_before = (7_000, boundary - Duration::seconds(30));
        let after = (1_012, boundary + Duration::seconds(5));

        assert_eq!(accepted_boundary_block(None, Some(after), boundary), None);
        assert_eq!(
            accepted_boundary_block(Some(far_before), None, boundary),
            None
        );
        assert_eq!(
            accepted_boundary_block(Some(near_before), None, boundary),
            Some(near_before)
        );
        assert_eq!(
            accepted_boundary_block(Some(far_before), Some(after), boundary),
            None,
            "a 12-height gap can still hold another block"
        );
        let adjacent_after = (1_005, boundary + Duration::seconds(5));
        assert_eq!(
            accepted_boundary_block(Some(far_before), Some(adjacent_after), boundary),
            Some(far_before)
        );
    }

    #[test]
    fn probe_bisects_once_bracketed_and_extrapolates_otherwise() {
        let boundary = Utc.with_ymd_and_hms(2026, 9, 10, 0, 0, 0).unwrap();
        let before = (1_000, boundary - Duration::seconds(110));
        let after = (5_000, boundary + Duration::seconds(110));

        assert_eq!(
            next_probe_height(Some(before), Some(after), boundary),
            Some(3_000)
        );
        assert_eq!(
            next_probe_height(Some((1_000, boundary)), Some((1_001, boundary)), boundary),
            None
        );
        assert_eq!(next_probe_height(Some(before), None, boundary), Some(1_100));
        assert_eq!(next_probe_height(None, Some(after), boundary), Some(4_900));
        assert_eq!(next_probe_height(None, None, boundary), None);
    }

    #[test]
    fn skipped_height_messages_are_recognised() {
        assert!(is_block_unavailable(
            "HANDLER_ERROR: UNKNOWN_BLOCK: DB Not Found Error: BLOCK HEIGHT: 215885606"
        ));
        assert!(is_block_unavailable("UnknownBlock"));
        assert!(is_block_unavailable("GarbageCollectedBlock"));
        // A 422 or a generic message is not proof of a skipped height.
        assert!(!is_block_unavailable(
            "server returned 422 Unprocessable Entity"
        ));
        assert!(!is_block_unavailable("account does not exist"));
        assert!(!is_block_unavailable("connection reset by peer"));
    }

    #[test]
    fn boundaries_cover_daily_and_weekly_horizons() {
        let now = DateTime::parse_from_rfc3339("2026-07-30T15:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let boundaries = chart_boundaries(now);

        assert!(boundaries.windows(2).all(|w| w[0] < w[1]));
        assert_eq!(
            *boundaries.last().unwrap(),
            DateTime::parse_from_rfc3339("2026-07-30T00:00:00Z").unwrap()
        );
        let oldest = *boundaries.first().unwrap();
        assert!(now - oldest >= Duration::weeks(WEEKLY_HORIZON_WEEKS));
        assert!(
            boundaries
                .iter()
                .filter(|b| now.signed_duration_since(**b) > Duration::days(91))
                .all(|b| b.weekday() == chrono::Weekday::Mon)
        );
    }

    #[test]
    fn required_boundaries_start_at_the_baseline_before_coverage() {
        let day = |d: u32| Utc.with_ymd_and_hms(2026, 9, d, 0, 0, 0).unwrap();
        let boundaries = vec![day(1), day(2), day(3), day(4)];

        // Coverage inside the horizon: the boundary at or before it is the
        // baseline, everything earlier is optional.
        let coverage = day(2) + Duration::hours(6);
        assert_eq!(
            required_boundaries(&boundaries, coverage, None),
            vec![day(2), day(3), day(4)]
        );
        assert_eq!(
            required_boundaries(&boundaries, day(3), None),
            vec![day(3), day(4)]
        );

        // A ledger that started after today's boundary still requires today's
        // reading; the set must never be empty.
        assert_eq!(
            required_boundaries(&boundaries, day(4) + Duration::hours(1), None),
            vec![day(4)]
        );

        // Coverage older than the horizon requires every boundary.
        assert_eq!(
            required_boundaries(&boundaries, day(1) - Duration::days(400), None),
            boundaries
        );
        assert!(required_boundaries(&[], day(1), None).is_empty());
    }

    #[test]
    fn capped_accounts_never_require_a_boundary_the_chart_would_drop() {
        let day = |d: u32| Utc.with_ymd_and_hms(2026, 9, d, 0, 0, 0).unwrap();
        let boundaries = vec![day(1), day(2), day(3), day(4)];
        // Ledger rows exist from day 1 but the account was capped mid day 2:
        // coverage starts at the cap and the chart hides day 1 and day 2
        // points, so day 3 is the first required boundary.
        let cap = day(2) + Duration::hours(12);
        assert_eq!(
            required_boundaries(&boundaries, cap, Some(cap)),
            vec![day(3), day(4)]
        );
    }

    #[test]
    fn retry_backoff_doubles_and_caps() {
        assert_eq!(retry_backoff(1), Duration::seconds(300));
        assert_eq!(retry_backoff(2), Duration::seconds(600));
        assert_eq!(retry_backoff(3), Duration::seconds(1200));
        assert_eq!(retry_backoff(10), Duration::seconds(RETRY_MAX_SECS));
        assert_eq!(retry_backoff(40), Duration::seconds(RETRY_MAX_SECS));
    }
}

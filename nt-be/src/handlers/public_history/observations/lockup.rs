//! Lockup observations: history for NEAR held in a treasury's lockup contract.
//!
//! The lockup is a separate account the DAO owns (derived from the DAO name),
//! optionally staking into its own pool. None of that reaches the DAO's
//! indexed history, and rewards and vesting releases move value without any
//! transaction, so the only historical source is reading lockup state at
//! chart boundaries. Readings are stored in `bronze_lockup_observations` and
//! replayed as hidden `observation` ledger entries on the synthetic
//! `lockup:{lockup_account}` asset, valued exactly like the dashboard card:
//! gross account balance plus the lockup's staked and unstaked pool position.
//!
//! Discovery is explicit per account (`pending` / `absent` / `present`) so
//! chart readiness can fail closed: an account whose lockup has not been
//! probed yet is not ready, and an account without a lockup is ready at once.
//! `absent` is re-probed daily so a lockup created later enters history.

use std::str::FromStr;
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use near_api::{AccountId, Tokens};
use sqlx::PgPool;
use sqlx::types::Json;

use super::{
    BoundaryFailures, MAX_PROBES_PER_CYCLE, MAX_READS_PER_CYCLE, ObservationReading, Pass,
    account_coverage, chart_boundaries, failure_key, is_backing_off, observable_accounts,
    rebuild_observation_series, record_failure, required_boundaries, resolve_boundary_block,
    retry_backoff,
};
use crate::AppState;
use crate::handlers::balance_changes::utils::with_transport_retry;
use crate::handlers::user::lockup::derive_lockup_account_id;
use crate::services::public_balance_reader::{
    LockupReadingAtBlock, get_lockup_reading_at_block, is_proven_nonexistence,
};

/// A lockup can be created after the first probe; `absent` is re-checked at
/// this cadence so a new lockup enters history instead of staying invisible.
const ABSENT_RECHECK: Duration = Duration::days(1);
/// Archival calls one boundary costs (account balance, pool id, pool total).
const READS_PER_BOUNDARY: usize = 3;

#[derive(Debug, Clone, Copy, Default)]
pub struct LockupObservationStats {
    pub discovered_present: u64,
    pub discovered_absent: u64,
    pub discovery_pending: u64,
    pub observations_written: u64,
    pub boundaries_skipped: u64,
    pub reads_failed: u64,
    pub backlog_boundaries: u64,
    pub max_observation_lag_hours: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "lockup_discovery_status", rename_all = "lowercase")]
pub enum LockupDiscovery {
    Pending,
    Absent,
    Present,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct LockupCursor {
    account_id: String,
    lockup_account_id: String,
}

pub async fn run_lockup_observation_cycle(
    state: &Arc<AppState>,
) -> Result<LockupObservationStats, sqlx::Error> {
    let mut stats = LockupObservationStats::default();
    let mut reads_left = MAX_READS_PER_CYCLE;
    discover_lockups(state, &mut reads_left, &mut stats).await?;

    // Longest-unobserved first, never-observed before that: the order rotates
    // on its own as accounts get served.
    let cursors: Vec<LockupCursor> = sqlx::query_as(
        r#"
        SELECT c.account_id, c.lockup_account_id
        FROM lockup_observation_cursors c
        JOIN monitored_accounts m ON m.account_id = c.account_id
        WHERE c.discovery = 'present'
          AND m.enabled = true
          AND m.history_ingestion_paused_at IS NULL
        ORDER BY c.last_observed_at ASC NULLS FIRST, c.account_id
        "#,
    )
    .fetch_all(&state.db_pool)
    .await?;

    let now = Utc::now();
    for pass in Pass::ALL {
        for cursor in &cursors {
            if reads_left < READS_PER_BOUNDARY {
                break;
            }
            observe_lockup(state, cursor, pass, now, &mut reads_left, &mut stats).await?;
        }
    }

    stats.max_observation_lag_hours = max_observation_lag_hours(&state.db_pool).await?;
    Ok(stats)
}

/// Hours since the least recently covered boundary across completed lockup
/// series of live accounts; `None` without any completed series.
pub(super) async fn max_observation_lag_hours(pool: &PgPool) -> Result<Option<f64>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT (EXTRACT(EPOCH FROM (NOW() - MIN(c.last_observed_at))) / 3600.0)::double precision
        FROM lockup_observation_cursors c
        JOIN monitored_accounts m ON m.account_id = c.account_id
        WHERE c.discovery = 'present' AND c.backfill_done = true
          AND m.enabled = true AND m.history_ingestion_paused_at IS NULL
        "#,
    )
    .fetch_one(pool)
    .await
}

/// One cheap `view_account` per monitored account. Errors (transport,
/// unexpected RPC responses) keep the row `pending` with backoff; only a
/// proven `UnknownAccount` settles as `absent`, and `absent` is re-probed
/// daily. Probes are capped per cycle and charged to the cycle budget.
async fn discover_lockups(
    state: &Arc<AppState>,
    reads_left: &mut usize,
    stats: &mut LockupObservationStats,
) -> Result<(), sqlx::Error> {
    for account_id in observable_accounts(&state.db_pool).await? {
        let Ok(account) = AccountId::from_str(&account_id) else {
            continue;
        };
        sqlx::query(
            r#"
            INSERT INTO lockup_observation_cursors (account_id, lockup_account_id)
            VALUES ($1, $2)
            ON CONFLICT (account_id) DO NOTHING
            "#,
        )
        .bind(&account_id)
        .bind(derive_lockup_account_id(&account).to_string())
        .execute(&state.db_pool)
        .await?;
    }

    let probe_limit = MAX_PROBES_PER_CYCLE.min(*reads_left);
    let due: Vec<(String, String, i32)> = sqlx::query_as(
        r#"
        SELECT c.account_id, c.lockup_account_id, c.discovery_attempts
        FROM lockup_observation_cursors c
        JOIN monitored_accounts m ON m.account_id = c.account_id
        WHERE c.discovery IN ('pending', 'absent')
          AND (c.next_discovery_at IS NULL OR c.next_discovery_at <= NOW())
          AND m.enabled = true
          AND m.history_ingestion_paused_at IS NULL
        ORDER BY c.next_discovery_at ASC NULLS FIRST, c.account_id
        LIMIT $1
        "#,
    )
    .bind(probe_limit as i64)
    .fetch_all(&state.db_pool)
    .await?;
    for (account_id, lockup_account_id, attempts) in due {
        if *reads_left == 0 {
            break;
        }
        *reads_left -= 1;
        match probe_lockup_exists(&state.network, &lockup_account_id).await {
            Ok(exists) => {
                let (status, recheck_at) = if exists {
                    stats.discovered_present += 1;
                    (LockupDiscovery::Present, None)
                } else {
                    stats.discovered_absent += 1;
                    (LockupDiscovery::Absent, Some(Utc::now() + ABSENT_RECHECK))
                };
                sqlx::query(
                    r#"
                    UPDATE lockup_observation_cursors
                    SET discovery = $2, discovery_error = NULL, next_discovery_at = $3,
                        updated_at = NOW()
                    WHERE account_id = $1
                    "#,
                )
                .bind(&account_id)
                .bind(status)
                .bind(recheck_at)
                .execute(&state.db_pool)
                .await?;
            }
            Err(error) => {
                let attempts = attempts.max(0) as u32 + 1;
                tracing::warn!(
                    account_id,
                    lockup = lockup_account_id,
                    attempts,
                    %error,
                    "lockup discovery failed; retrying with backoff"
                );
                sqlx::query(
                    r#"
                    UPDATE lockup_observation_cursors
                    SET discovery_attempts = $2, discovery_error = $3,
                        next_discovery_at = $4, updated_at = NOW()
                    WHERE account_id = $1
                    "#,
                )
                .bind(&account_id)
                .bind(attempts as i32)
                .bind(&error)
                .bind(Utc::now() + retry_backoff(attempts))
                .execute(&state.db_pool)
                .await?;
            }
        }
    }

    let pending_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM lockup_observation_cursors WHERE discovery = 'pending'",
    )
    .fetch_one(&state.db_pool)
    .await?;
    stats.discovery_pending = pending_count.max(0) as u64;
    Ok(())
}

/// Existence probe at the chain head. Deliberately not `fetch_lockup_contract`:
/// that helper returns `None` on Borsh decode failures as well as on absence,
/// and discovery must never settle `absent` on a decode problem.
async fn probe_lockup_exists(
    network: &near_api::NetworkConfig,
    lockup_account_id: &str,
) -> Result<bool, String> {
    let account_id = AccountId::from_str(lockup_account_id).map_err(|error| error.to_string())?;
    match with_transport_retry("lockup_probe", || {
        Tokens::account(account_id.clone())
            .near_balance()
            .fetch_from(network)
    })
    .await
    {
        Ok(_) => Ok(true),
        Err(error) if is_proven_nonexistence(&error.to_string()) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

async fn observe_lockup(
    state: &Arc<AppState>,
    cursor: &LockupCursor,
    pass: Pass,
    now: DateTime<Utc>,
    reads_left: &mut usize,
    stats: &mut LockupObservationStats,
) -> Result<(), sqlx::Error> {
    let Some((coverage_start, capped_at)) =
        account_coverage(&state.db_pool, &cursor.account_id).await?
    else {
        return Ok(());
    };
    let required = required_boundaries(&chart_boundaries(now), coverage_start, capped_at);
    let account_cap = pass.account_cap();

    let Json(mut failures): Json<BoundaryFailures> = sqlx::query_scalar(
        "SELECT failed_boundaries FROM lockup_observation_cursors WHERE account_id = $1",
    )
    .bind(&cursor.account_id)
    .fetch_one(&state.db_pool)
    .await?;

    let asset = format!("lockup:{}", cursor.lockup_account_id);
    let mut account_reads = 0usize;
    for boundary in pass.targets(&required, now) {
        if *reads_left < READS_PER_BOUNDARY || account_reads + READS_PER_BOUNDARY > account_cap {
            break;
        }
        let key = failure_key(boundary);
        if is_backing_off(&failures, &key, now) {
            continue;
        }
        let covered: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                 SELECT 1 FROM bronze_lockup_observations
                 WHERE account_id = $1 AND observed_at = $2
             )",
        )
        .bind(&cursor.account_id)
        .bind(boundary)
        .fetch_one(&state.db_pool)
        .await?;
        if covered {
            continue;
        }
        let resolution = resolve_boundary_block(state, boundary).await?;
        *reads_left = reads_left.saturating_sub(resolution.rpc_calls);
        account_reads += resolution.rpc_calls;
        let Some(block_height) = resolution.block_height else {
            stats.boundaries_skipped += 1;
            if resolution.rpc_calls > 0 {
                record_failure(&mut failures, key, now, "boundary block unresolved");
            }
            continue;
        };
        // Resolution may have eaten into the budget; the balance reads must
        // still fit, otherwise the boundary waits for next cycle with its
        // block already cached.
        if *reads_left < READS_PER_BOUNDARY || account_reads + READS_PER_BOUNDARY > account_cap {
            break;
        }

        *reads_left -= READS_PER_BOUNDARY;
        account_reads += READS_PER_BOUNDARY;
        match get_lockup_reading_at_block(
            &state.archival_network,
            &cursor.lockup_account_id,
            block_height as u64,
        )
        .await
        {
            Ok(reading) => {
                let observation_key = format!(
                    "lockup:{}:{}:{block_height}",
                    cursor.account_id, cursor.lockup_account_id
                );
                apply_lockup_observation(
                    state,
                    cursor,
                    &asset,
                    &observation_key,
                    boundary,
                    block_height,
                    &reading,
                )
                .await?;
                failures.remove(&key);
                stats.observations_written += 1;
            }
            Err(error) => {
                stats.reads_failed += 1;
                tracing::warn!(
                    account_id = cursor.account_id,
                    lockup = cursor.lockup_account_id,
                    block_height,
                    %error,
                    "lockup reading failed; boundary stays uncovered"
                );
                record_failure(&mut failures, key, now, &error);
            }
        }
    }

    let covered_required: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bronze_lockup_observations
         WHERE account_id = $1 AND observed_at = ANY($2)",
    )
    .bind(&cursor.account_id)
    .bind(&required)
    .fetch_one(&state.db_pool)
    .await?;
    let uncovered = required
        .len()
        .saturating_sub(covered_required.max(0) as usize);
    if pass == Pass::Backfill {
        stats.backlog_boundaries += uncovered as u64;
    }
    // A DAO whose ledger starts today still needs its baseline boundary read
    // before the chart may serve a lockup-inclusive total. backfill_done is
    // sticky: once the required horizon has been covered, a transient failure
    // on a fresh boundary must not flip a served chart back to Unavailable.
    // Freshness is reported separately through last_observed_at.
    let backfill_complete = !required.is_empty() && uncovered == 0;
    sqlx::query(
        r#"
        UPDATE lockup_observation_cursors
        SET backfill_done = backfill_done OR $2,
            last_observed_at = (
                SELECT MAX(observed_at) FROM bronze_lockup_observations WHERE account_id = $1
            ),
            failed_boundaries = $3,
            updated_at = NOW()
        WHERE account_id = $1
        "#,
    )
    .bind(&cursor.account_id)
    .bind(backfill_complete)
    .bind(Json(failures))
    .execute(&state.db_pool)
    .await?;
    Ok(())
}

async fn apply_lockup_observation(
    state: &Arc<AppState>,
    cursor: &LockupCursor,
    asset: &str,
    observation_key: &str,
    boundary: DateTime<Utc>,
    block_height: i64,
    reading: &LockupReadingAtBlock,
) -> Result<(), sqlx::Error> {
    let mut tx = state.db_pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO bronze_lockup_observations (
            observation_key, account_id, lockup_account_id, block_height, observed_at,
            balance, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (observation_key) DO NOTHING
        "#,
    )
    .bind(observation_key)
    .bind(&cursor.account_id)
    .bind(&cursor.lockup_account_id)
    .bind(block_height)
    .bind(boundary)
    .bind(reading.total())
    .bind(Json(serde_json::json!({
        "exists": reading.exists,
        "liquid": reading.liquid.to_string(),
        "pool_account_id": reading.pool_account_id,
        "pool_total": reading.pool_total.to_string(),
    })))
    .execute(&mut *tx)
    .await?;

    let readings: Vec<ObservationReading> = sqlx::query_as(
        "SELECT observed_at, block_height, balance FROM bronze_lockup_observations
         WHERE account_id = $1",
    )
    .bind(&cursor.account_id)
    .fetch_all(&mut *tx)
    .await?;
    rebuild_observation_series(
        &mut tx,
        &cursor.account_id,
        asset,
        &cursor.lockup_account_id,
        &readings,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test]
    async fn observation_lag_decodes_for_a_completed_cursor(pool: PgPool) -> sqlx::Result<()> {
        assert_eq!(max_observation_lag_hours(&pool).await?, None);

        sqlx::query("INSERT INTO monitored_accounts (account_id) VALUES ('dao.near')")
            .execute(&pool)
            .await?;
        sqlx::query(
            r#"
            INSERT INTO lockup_observation_cursors
                (account_id, lockup_account_id, discovery, backfill_done, last_observed_at)
            VALUES ('dao.near', 'abc.lockup.near', 'present', true, NOW() - INTERVAL '30 hours')
            "#,
        )
        .execute(&pool)
        .await?;

        let lag = max_observation_lag_hours(&pool)
            .await?
            .expect("completed cursor");
        assert!((lag - 30.0).abs() < 0.1, "lag was {lag}");
        Ok(())
    }
}

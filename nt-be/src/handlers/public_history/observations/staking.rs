//! Staking pool observations: chart-horizon backfill plus daily capture of
//! each treasury's position in the pools it has staked with.
//!
//! Rewards accrue every epoch with no transaction, so the staked series can
//! only come from reading pool state. Pool discovery is a pure bronze query
//! (contracts the DAO has function-called that follow the staking naming
//! scheme) and runs for every observable account each cycle; it is recorded
//! per account so chart readiness can fail closed until it has happened.
//! Each candidate pool is then validated once against the chain: a real pool
//! is observed, anything else is rejected for good instead of being probed
//! every cycle forever.

use std::collections::HashMap;
use std::sync::Arc;

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::types::Json;

use super::{
    BoundaryFailures, MAX_PROBES_PER_CYCLE, MAX_READS_PER_CYCLE, ObservationReading, Pass,
    account_coverage, chart_boundaries, failure_key, is_backing_off, latest_known_block,
    observable_accounts, rebuild_observation_series, record_failure, required_boundaries,
    resolve_boundary_block,
};
use crate::AppState;
use crate::services::chain_balances::staking::{
    get_staking_balance_at_exact_block, is_staking_pool,
};
use crate::services::public_balance_reader::validate_staking_pool_at_block;

/// Archival calls one boundary costs (one pool read).
const READS_PER_BOUNDARY: usize = 1;

#[derive(Debug, Clone, Copy, Default)]
pub struct StakingObservationStats {
    pub accounts_discovered: u64,
    pub pools_discovered: u64,
    pub pools_validated: u64,
    pub pools_rejected: u64,
    pub observations_written: u64,
    pub boundaries_skipped: u64,
    pub reads_failed: u64,
    pub backlog_boundaries: u64,
    pub max_observation_lag_hours: Option<f64>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct PoolCursor {
    account_id: String,
    pool_account_id: String,
}

pub async fn run_staking_observation_cycle(
    state: &Arc<AppState>,
) -> Result<StakingObservationStats, sqlx::Error> {
    let mut stats = StakingObservationStats::default();
    let mut reads_left = MAX_READS_PER_CYCLE;

    let accounts = observable_accounts(&state.db_pool).await?;
    for account_id in &accounts {
        stats.pools_discovered += discover_pools(&state.db_pool, account_id).await?;
        stats.accounts_discovered += 1;
    }
    validate_pending_pools(state, &mut reads_left, &mut stats).await?;

    // Longest-unobserved first, never-observed before that: the order rotates
    // on its own as pools get served.
    let cursors: Vec<PoolCursor> = sqlx::query_as(
        r#"
        SELECT c.account_id, c.pool_account_id
        FROM staking_observation_cursors c
        JOIN monitored_accounts m ON m.account_id = c.account_id
        WHERE c.validated = true
          AND c.rejected_at IS NULL
          AND m.enabled = true
          AND m.history_ingestion_paused_at IS NULL
        ORDER BY c.last_observed_at ASC NULLS FIRST, c.account_id, c.pool_account_id
        "#,
    )
    .fetch_all(&state.db_pool)
    .await?;

    let now = Utc::now();
    let mut coverage_cache = HashMap::new();
    for pass in Pass::ALL {
        let mut account_reads: HashMap<&str, usize> = HashMap::new();
        for cursor in &cursors {
            if reads_left < READS_PER_BOUNDARY {
                break;
            }
            let coverage = match coverage_cache.get(&cursor.account_id) {
                Some(coverage) => *coverage,
                None => {
                    let coverage = account_coverage(&state.db_pool, &cursor.account_id).await?;
                    coverage_cache.insert(cursor.account_id.clone(), coverage);
                    coverage
                }
            };
            let Some((coverage_start, capped_at)) = coverage else {
                continue;
            };
            let required = required_boundaries(&chart_boundaries(now), coverage_start, capped_at);
            let reads = account_reads.entry(cursor.account_id.as_str()).or_default();
            observe_pool(
                state,
                cursor,
                pass,
                &required,
                now,
                &mut reads_left,
                reads,
                &mut stats,
            )
            .await?;
        }
    }

    stats.max_observation_lag_hours = sqlx::query_scalar(
        r#"
        SELECT (EXTRACT(EPOCH FROM (NOW() - MIN(c.last_observed_at))) / 3600.0)::double precision
        FROM staking_observation_cursors c
        JOIN monitored_accounts m ON m.account_id = c.account_id
        WHERE c.validated = true AND c.rejected_at IS NULL AND c.backfill_done = true
          AND m.enabled = true AND m.history_ingestion_paused_at IS NULL
        "#,
    )
    .fetch_one(&state.db_pool)
    .await?;
    Ok(stats)
}

/// Pools the account has ever function-called, filtered to the staking
/// naming scheme. Discovery is derived purely from bronze and recorded per
/// account, so readiness can tell "no pools" from "not looked yet".
async fn discover_pools(pool: &PgPool, account_id: &str) -> Result<u64, sqlx::Error> {
    let candidates: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT DISTINCT contract_account_id
        FROM bronze_public_history_events
        WHERE account_id = $1
          AND source = 'nearblocks_receipt'::public_history_source
          AND contract_account_id IS NOT NULL
          AND (
              contract_account_id LIKE '%.poolv1.near'
              OR contract_account_id LIKE '%.pool.near'
          )
        "#,
    )
    .bind(account_id)
    .fetch_all(pool)
    .await?;

    let mut inserted = 0;
    for candidate in candidates {
        if !is_staking_pool(&candidate) {
            continue;
        }
        inserted += sqlx::query(
            r#"
            INSERT INTO staking_observation_cursors (account_id, pool_account_id)
            VALUES ($1, $2)
            ON CONFLICT (account_id, pool_account_id) DO NOTHING
            "#,
        )
        .bind(account_id)
        .bind(&candidate)
        .execute(pool)
        .await?
        .rows_affected();
    }
    sqlx::query(
        r#"
        INSERT INTO staking_discovery_cursors (account_id)
        VALUES ($1)
        ON CONFLICT (account_id) DO UPDATE SET updated_at = NOW()
        "#,
    )
    .bind(account_id)
    .execute(pool)
    .await?;
    Ok(inserted)
}

/// One chain check per newly discovered pool, capped and charged per cycle.
/// A contract that is provably not a staking pool is rejected permanently;
/// transport failures leave the pool pending for the next cycle.
async fn validate_pending_pools(
    state: &Arc<AppState>,
    reads_left: &mut usize,
    stats: &mut StakingObservationStats,
) -> Result<(), sqlx::Error> {
    let limit = MAX_PROBES_PER_CYCLE.min(*reads_left);
    let pending: Vec<PoolCursor> = sqlx::query_as(
        r#"
        SELECT c.account_id, c.pool_account_id
        FROM staking_observation_cursors c
        JOIN monitored_accounts m ON m.account_id = c.account_id
        WHERE c.validated = false
          AND c.rejected_at IS NULL
          AND m.enabled = true
          AND m.history_ingestion_paused_at IS NULL
        ORDER BY c.created_at, c.account_id, c.pool_account_id
        LIMIT $1
        "#,
    )
    .bind(limit as i64)
    .fetch_all(&state.db_pool)
    .await?;
    if pending.is_empty() {
        return Ok(());
    }
    let Some((_, head_height)) = latest_known_block(&state.db_pool).await? else {
        return Ok(());
    };
    for cursor in pending {
        if *reads_left == 0 {
            break;
        }
        *reads_left -= 1;
        match validate_staking_pool_at_block(
            &state.archival_network,
            &cursor.account_id,
            &cursor.pool_account_id,
            head_height as u64,
        )
        .await
        {
            Ok(true) => {
                sqlx::query(
                    "UPDATE staking_observation_cursors
                     SET validated = true, updated_at = NOW()
                     WHERE account_id = $1 AND pool_account_id = $2",
                )
                .bind(&cursor.account_id)
                .bind(&cursor.pool_account_id)
                .execute(&state.db_pool)
                .await?;
                stats.pools_validated += 1;
            }
            Ok(false) => {
                sqlx::query(
                    "UPDATE staking_observation_cursors
                     SET rejected_at = NOW(), updated_at = NOW()
                     WHERE account_id = $1 AND pool_account_id = $2",
                )
                .bind(&cursor.account_id)
                .bind(&cursor.pool_account_id)
                .execute(&state.db_pool)
                .await?;
                stats.pools_rejected += 1;
            }
            Err(error) => {
                stats.reads_failed += 1;
                tracing::warn!(
                    account_id = cursor.account_id,
                    pool = cursor.pool_account_id,
                    %error,
                    "pool validation failed; retrying next cycle"
                );
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn observe_pool(
    state: &Arc<AppState>,
    cursor: &PoolCursor,
    pass: Pass,
    required: &[DateTime<Utc>],
    now: DateTime<Utc>,
    reads_left: &mut usize,
    account_reads: &mut usize,
    stats: &mut StakingObservationStats,
) -> Result<(), sqlx::Error> {
    let asset = format!("staking:{}", cursor.pool_account_id);
    let account_cap = pass.account_cap();
    let Json(mut failures): Json<BoundaryFailures> = sqlx::query_scalar(
        "SELECT failed_boundaries FROM staking_observation_cursors
         WHERE account_id = $1 AND pool_account_id = $2",
    )
    .bind(&cursor.account_id)
    .bind(&cursor.pool_account_id)
    .fetch_one(&state.db_pool)
    .await?;

    for boundary in pass.targets(required, now) {
        if *reads_left < READS_PER_BOUNDARY || *account_reads + READS_PER_BOUNDARY > account_cap {
            break;
        }
        let key = failure_key(boundary);
        if is_backing_off(&failures, &key, now) {
            continue;
        }
        // Covered boundaries are skipped before block resolution: steady
        // state must cost one covered-boundary probe each, not a block
        // lookup per boundary per cycle.
        let covered: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                 SELECT 1 FROM bronze_staking_observations
                 WHERE account_id = $1 AND pool_account_id = $2 AND observed_at = $3
             )",
        )
        .bind(&cursor.account_id)
        .bind(&cursor.pool_account_id)
        .bind(boundary)
        .fetch_one(&state.db_pool)
        .await?;
        if covered {
            continue;
        }
        let resolution = resolve_boundary_block(state, boundary).await?;
        *reads_left = reads_left.saturating_sub(resolution.rpc_calls);
        *account_reads += resolution.rpc_calls;
        let Some(block_height) = resolution.block_height else {
            stats.boundaries_skipped += 1;
            if resolution.rpc_calls > 0 {
                record_failure(&mut failures, key, now, "boundary block unresolved");
            }
            continue;
        };
        // Resolution may have eaten into the budget; the pool read must still
        // fit, otherwise the boundary waits for next cycle with its block
        // already cached.
        if *reads_left < READS_PER_BOUNDARY || *account_reads + READS_PER_BOUNDARY > account_cap {
            break;
        }
        let observation_key = format!(
            "staking:{}:{}:{block_height}",
            cursor.account_id, cursor.pool_account_id
        );

        *reads_left -= READS_PER_BOUNDARY;
        *account_reads += READS_PER_BOUNDARY;
        // Stringify the boxed error at the await so the worker future stays
        // `Send` while the Ok arm awaits the write.
        match get_staking_balance_at_exact_block(
            &state.archival_network,
            &cursor.account_id,
            &cursor.pool_account_id,
            block_height as u64,
        )
        .await
        .map_err(|error| error.to_string())
        {
            Ok(balance) => {
                apply_observation(
                    state,
                    cursor,
                    &asset,
                    &observation_key,
                    boundary,
                    block_height,
                    &balance,
                )
                .await?;
                failures.remove(&key);
                stats.observations_written += 1;
            }
            Err(error) => {
                stats.reads_failed += 1;
                tracing::warn!(
                    account_id = cursor.account_id,
                    pool = cursor.pool_account_id,
                    block_height,
                    %error,
                    "staking reading failed; boundary stays uncovered"
                );
                record_failure(&mut failures, key, now, &error);
            }
        }
    }

    let covered_required: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bronze_staking_observations
         WHERE account_id = $1 AND pool_account_id = $2 AND observed_at = ANY($3)",
    )
    .bind(&cursor.account_id)
    .bind(&cursor.pool_account_id)
    .bind(required)
    .fetch_one(&state.db_pool)
    .await?;
    let uncovered = required
        .len()
        .saturating_sub(covered_required.max(0) as usize);
    if pass == Pass::Backfill {
        stats.backlog_boundaries += uncovered as u64;
    }
    // backfill_done is sticky: once the required horizon has been covered, a
    // transient failure on a fresh boundary must not flip a served chart back
    // to Unavailable. Freshness is reported separately through
    // last_observed_at.
    sqlx::query(
        r#"
        UPDATE staking_observation_cursors
        SET backfill_done = backfill_done OR $3,
            last_observed_at = (
                SELECT MAX(observed_at) FROM bronze_staking_observations
                WHERE account_id = $1 AND pool_account_id = $2
            ),
            failed_boundaries = $4,
            updated_at = NOW()
        WHERE account_id = $1 AND pool_account_id = $2
        "#,
    )
    .bind(&cursor.account_id)
    .bind(&cursor.pool_account_id)
    .bind(!required.is_empty() && uncovered == 0)
    .bind(Json(failures))
    .execute(&state.db_pool)
    .await?;
    Ok(())
}

/// Store the reading (provenance) and rebuild the pool's ledger entries from
/// the full per-pool series.
async fn apply_observation(
    state: &Arc<AppState>,
    cursor: &PoolCursor,
    asset: &str,
    observation_key: &str,
    boundary: DateTime<Utc>,
    block_height: i64,
    balance: &BigDecimal,
) -> Result<(), sqlx::Error> {
    let mut tx = state.db_pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO bronze_staking_observations (
            observation_key, account_id, pool_account_id, block_height, observed_at, balance
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (observation_key) DO NOTHING
        "#,
    )
    .bind(observation_key)
    .bind(&cursor.account_id)
    .bind(&cursor.pool_account_id)
    .bind(block_height)
    .bind(boundary)
    .bind(balance)
    .execute(&mut *tx)
    .await?;

    let readings: Vec<ObservationReading> = sqlx::query_as(
        "SELECT observed_at, block_height, balance FROM bronze_staking_observations
         WHERE account_id = $1 AND pool_account_id = $2",
    )
    .bind(&cursor.account_id)
    .bind(&cursor.pool_account_id)
    .fetch_all(&mut *tx)
    .await?;
    rebuild_observation_series(
        &mut tx,
        &cursor.account_id,
        asset,
        &cursor.pool_account_id,
        &readings,
    )
    .await?;

    tx.commit().await?;
    Ok(())
}

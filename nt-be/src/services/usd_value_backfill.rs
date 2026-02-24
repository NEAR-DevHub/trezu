//! Background service to populate usd_value on balance_changes records.
//!
//! This service periodically finds balance_changes rows where usd_value IS NULL,
//! fetches the USD price at the exact block_time from DefiLlama, and computes
//! usd_value = abs(amount) / 10^decimals * price.
//!
//! It processes records in batches, grouping by token to minimise API calls.

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::HashMap;
use std::time::Duration;

use super::defillama::DeFiLlamaClient;
use super::price_lookup::token_id_to_unified_asset_id;
use super::price_provider::PriceProvider;
use crate::constants::intents_tokens::{get_defuse_tokens_map, get_tokens_map};

/// How many records to process per cycle
const BATCH_SIZE: i64 = 100;

/// Interval between backfill cycles
const BACKFILL_INTERVAL_SECS: u64 = 30;

/// Delay between individual DefiLlama API calls to avoid rate limiting
const API_CALL_DELAY_MS: u64 = 350;

/// A balance_changes row that needs usd_value populated
#[derive(sqlx::FromRow)]
struct PendingRecord {
    id: i64,
    token_id: String,
    block_time: DateTime<Utc>,
    amount: BigDecimal,
}

/// Run the background usd_value backfill service
pub async fn run_usd_value_backfill_service(pool: PgPool, client: DeFiLlamaClient) {
    log::info!(
        "Starting usd_value backfill service (interval: {}s)",
        BACKFILL_INTERVAL_SECS
    );

    // Wait for other services to start up
    tokio::time::sleep(Duration::from_secs(15)).await;

    let mut interval = tokio::time::interval(Duration::from_secs(BACKFILL_INTERVAL_SECS));

    loop {
        interval.tick().await;

        match backfill_batch(&pool, &client).await {
            Ok(0) => {
                log::debug!("usd_value backfill: no pending records");
            }
            Ok(count) => {
                log::info!("usd_value backfill: updated {} records", count);
            }
            Err(e) => {
                log::warn!("usd_value backfill error: {}", e);
            }
        }
    }
}

/// Process one batch of records that need usd_value populated
async fn backfill_batch(
    pool: &PgPool,
    client: &DeFiLlamaClient,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    // Fetch records that need usd_value, excluding snapshots and zero amounts
    let rows: Vec<PendingRecord> = sqlx::query_as(
        r#"
        SELECT id, token_id, block_time, amount
        FROM balance_changes
        WHERE usd_value IS NULL
          AND counterparty NOT IN ('SNAPSHOT', 'STAKING_SNAPSHOT', 'NOT_REGISTERED')
          AND amount != 0
          AND block_time IS NOT NULL
          AND token_id IS NOT NULL
        ORDER BY block_time DESC
        LIMIT $1
        "#,
    )
    .bind(BATCH_SIZE)
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(0);
    }

    // Build token_id -> (defillama_asset_id, decimals) cache
    let mut token_info_cache: HashMap<String, Option<(String, u8)>> = HashMap::new();
    for row in &rows {
        if token_info_cache.contains_key(&row.token_id) {
            continue;
        }
        let info = resolve_token_info(&row.token_id, client);
        token_info_cache.insert(row.token_id.clone(), info);
    }

    // Prepare records with resolved info
    struct RecordWithInfo {
        id: i64,
        amount: BigDecimal,
        decimals: u8,
        defillama_asset_id: String,
        timestamp: i64,
    }

    let mut records_with_info: Vec<RecordWithInfo> = Vec::new();

    for row in &rows {
        if let Some(Some((defillama_id, decimals))) = token_info_cache.get(&row.token_id) {
            records_with_info.push(RecordWithInfo {
                id: row.id,
                amount: row.amount.clone(),
                decimals: *decimals,
                defillama_asset_id: defillama_id.clone(),
                timestamp: row.block_time.timestamp(),
            });
        }
    }

    let mut updated = 0;

    // Group by timestamp to batch DefiLlama calls
    let mut by_timestamp: HashMap<i64, Vec<&RecordWithInfo>> = HashMap::new();
    for rec in &records_with_info {
        by_timestamp.entry(rec.timestamp).or_default().push(rec);
    }

    for (timestamp, recs) in &by_timestamp {
        // Collect unique asset_ids for this timestamp
        let asset_ids: Vec<String> = recs
            .iter()
            .map(|r| r.defillama_asset_id.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        // Fetch prices from DefiLlama
        let prices = match client.get_prices_at_timestamp(&asset_ids, *timestamp).await {
            Ok(p) => p,
            Err(e) => {
                log::warn!("DefiLlama price fetch failed at {}: {}", timestamp, e);
                tokio::time::sleep(Duration::from_millis(API_CALL_DELAY_MS)).await;
                continue;
            }
        };

        // Update each record in this timestamp group
        for rec in recs {
            if let Some(&price) = prices.get(&rec.defillama_asset_id) {
                let usd_value = compute_usd_value(&rec.amount, rec.decimals, price);

                if let Some(val) = usd_value {
                    sqlx::query("UPDATE balance_changes SET usd_value = $1 WHERE id = $2")
                        .bind(&val)
                        .bind(rec.id)
                        .execute(pool)
                        .await?;
                    updated += 1;
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(API_CALL_DELAY_MS)).await;
    }

    Ok(updated)
}

/// Resolve a token_id to its DefiLlama asset ID and decimals
fn resolve_token_info(token_id: &str, client: &DeFiLlamaClient) -> Option<(String, u8)> {
    let decimals = get_token_decimals(token_id)?;
    let unified_id = token_id_to_unified_asset_id(token_id)?;
    let defillama_id = client.translate_asset_id(&unified_id)?;
    Some((defillama_id, decimals))
}

/// Get the decimal precision for a token_id
fn get_token_decimals(token_id: &str) -> Option<u8> {
    // Native NEAR
    if token_id == "near" {
        return Some(24);
    }

    // Staking pools (staked NEAR)
    if token_id.starts_with("staking:") {
        return Some(24);
    }

    // Normalize: strip "intents.near:" prefix if present
    let normalized = if let Some(stripped) = token_id.strip_prefix("intents.near:") {
        stripped
    } else {
        token_id
    };

    // Look up in defuse tokens map (exact match)
    let defuse_map = get_defuse_tokens_map();
    if let Some(base_token) = defuse_map.get(normalized) {
        return Some(base_token.decimals);
    }

    // Search for a defuse_asset_id that ends with this token contract
    // e.g., "wrap.near" matches "nep141:wrap.near"
    for (defuse_asset_id, base_token) in defuse_map.iter() {
        if defuse_asset_id.ends_with(&format!(":{}", normalized)) {
            return Some(base_token.decimals);
        }
    }

    // Try to find via unified tokens map as a fallback
    let tokens_map = get_tokens_map();
    for unified_token in tokens_map.values() {
        for base_token in &unified_token.grouped_tokens {
            let contract = base_token
                .defuse_asset_id
                .split(':')
                .next_back()
                .unwrap_or("");
            if contract == normalized {
                return Some(base_token.decimals);
            }
        }
    }

    None
}

/// Compute the USD value from raw amount, decimals, and per-token price
///
/// usd_value = abs(amount) / 10^decimals * price
fn compute_usd_value(amount: &BigDecimal, decimals: u8, price: f64) -> Option<BigDecimal> {
    use bigdecimal::FromPrimitive;

    let abs_amount = if amount < &BigDecimal::from(0) {
        -amount
    } else {
        amount.clone()
    };

    let divisor = BigDecimal::from_f64(10_f64.powi(decimals as i32))?;
    let decimal_amount = &abs_amount / &divisor;
    let price_bd = BigDecimal::from_f64(price)?;

    Some(decimal_amount * price_bd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bigdecimal::ToPrimitive;

    #[test]
    fn test_get_token_decimals_near() {
        assert_eq!(get_token_decimals("near"), Some(24));
    }

    #[test]
    fn test_get_token_decimals_staking() {
        assert_eq!(
            get_token_decimals("staking:astro-stakers.poolv1.near"),
            Some(24)
        );
    }

    #[test]
    fn test_get_token_decimals_intents_btc() {
        assert_eq!(
            get_token_decimals("intents.near:nep141:btc.omft.near"),
            Some(8)
        );
    }

    #[test]
    fn test_get_token_decimals_intents_usdc() {
        // USDC on NEAR has 6 decimals
        assert_eq!(
            get_token_decimals(
                "intents.near:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
            ),
            Some(6)
        );
    }

    #[test]
    fn test_get_token_decimals_wrap_near() {
        assert_eq!(get_token_decimals("wrap.near"), Some(24));
    }

    #[test]
    fn test_get_token_decimals_unknown() {
        assert_eq!(get_token_decimals("totally-unknown-token.near"), None);
    }

    #[test]
    fn test_compute_usd_value() {
        // 1.5 NEAR (24 decimals) at $3.00
        let amount = BigDecimal::from(1_500_000_000_000_000_000_000_000_i128);
        let result = compute_usd_value(&amount, 24, 3.0);
        assert!(result.is_some());
        let val = result.unwrap().to_f64().unwrap();
        assert!((val - 4.5).abs() < 0.001, "Expected ~4.5, got {}", val);
    }

    #[test]
    fn test_compute_usd_value_negative_amount() {
        // -2 USDC (6 decimals) at $1.00 -> should be positive $2.00
        let amount = BigDecimal::from(-2_000_000_i64);
        let result = compute_usd_value(&amount, 6, 1.0);
        assert!(result.is_some());
        let val = result.unwrap().to_f64().unwrap();
        assert!((val - 2.0).abs() < 0.001, "Expected ~2.0, got {}", val);
    }
}

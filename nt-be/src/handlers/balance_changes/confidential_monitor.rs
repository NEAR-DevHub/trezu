//! Confidential Treasury Balance Monitoring
//!
//! Polls the 1Click API for confidential treasury balances and records
//! balance changes by diffing against previously stored values.
//!
//! Unlike regular treasuries, confidential balances live off-chain in the
//! 1Click system — there are no on-chain blocks to search. Each poll
//! captures a snapshot and records any detected changes.
//!
//! Balances are decimal-adjusted before storage to match the convention
//! used by the rest of the balance_changes pipeline (e.g. `2.5` NEAR,
//! not `2500000000000000000000000` yoctoNEAR).

use bigdecimal::BigDecimal;
use chrono::Utc;
use near_api::NetworkConfig;
use serde::Deserialize;
use sqlx::PgPool;
use std::collections::HashMap;

use crate::AppState;
use crate::handlers::intents::confidential::refresh_dao_jwt;

use super::counterparty::{convert_raw_to_decimal, ensure_ft_metadata};

/// A single balance entry from the 1Click `/v0/account/balances` endpoint.
#[derive(Deserialize, Debug)]
struct BalanceEntry {
    available: String,
    #[serde(rename = "tokenId")]
    token_id: String,
}

#[derive(Deserialize, Debug)]
struct BalancesResponse {
    balances: Vec<BalanceEntry>,
}

/// Fetch current confidential balances from the 1Click API.
///
/// Returns `(token_id, balance)` pairs where `token_id` is the raw intents
/// token ID (e.g. `nep141:wrap.near`).
async fn fetch_confidential_balances(
    state: &AppState,
    dao_id: &str,
) -> Result<Vec<(String, String)>, Box<dyn std::error::Error>> {
    let access_token = refresh_dao_jwt(state, dao_id)
        .await
        .map_err(|(_, msg)| format!("JWT refresh failed for {}: {}", dao_id, msg))?;

    let url = format!(
        "{}/v0/account/balances",
        state.env_vars.confidential_api_url
    );

    let mut req = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token));
    if let Some(api_key) = &state.env_vars.oneclick_api_key {
        req = req.header("x-api-key", api_key);
    }

    let response = req.send().await?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("1Click API returned {} for {}: {}", status, dao_id, body).into());
    }

    let parsed: BalancesResponse = response.json().await?;

    Ok(parsed
        .balances
        .into_iter()
        .filter(|b| b.available.parse::<u128>().unwrap_or(0) > 0)
        .map(|b| (b.token_id, b.available))
        .collect())
}

/// Convert a raw 1Click token_id to the format stored in `balance_changes`.
///
/// The 1Click API returns IDs like `nep141:wrap.near` while the balance_changes
/// table stores intents tokens as `intents.near:nep141:wrap.near`.
fn to_storage_token_id(raw_token_id: &str) -> String {
    format!("intents.near:{}", raw_token_id)
}

/// Decimal-adjust a raw balance string using the token's metadata decimals.
///
/// Looks up the token in the counterparties table (populating it from the
/// token registry / RPC if missing) and divides the raw amount accordingly.
async fn adjust_balance(
    pool: &PgPool,
    network: &NetworkConfig,
    storage_token_id: &str,
    raw_balance: &str,
) -> Result<BigDecimal, Box<dyn std::error::Error>> {
    let decimals = ensure_ft_metadata(pool, network, storage_token_id).await?;
    convert_raw_to_decimal(raw_balance, decimals)
}

/// Poll confidential balances and record any changes.
///
/// For each token returned by the 1Click API:
/// 1. Look up the most recent `balance_after` in `balance_changes`
/// 2. If the balance differs → insert a new balance change record
/// 3. If the token is new → insert an initial snapshot
/// 4. If a previously-known token is now absent (balance dropped to 0) → insert a zero-out record
///
/// Returns the number of balance change records inserted.
pub async fn poll_confidential_balances(
    state: &AppState,
    account_id: &str,
    block_height: i64,
) -> Result<usize, Box<dyn std::error::Error>> {
    // 1. Fetch current balances from 1Click API
    let current_balances = match fetch_confidential_balances(state, account_id).await {
        Ok(balances) => balances,
        Err(e) => {
            log::warn!(
                "[confidential] {}: Failed to fetch balances: {}",
                account_id,
                e
            );
            return Ok(0);
        }
    };

    // Build map: storage_token_id → decimal-adjusted balance
    let mut current_map: HashMap<String, BigDecimal> = HashMap::new();
    for (raw_id, raw_bal) in &current_balances {
        let storage_id = to_storage_token_id(raw_id);
        match adjust_balance(&state.db_pool, &state.network, &storage_id, raw_bal).await {
            Ok(adjusted) => {
                current_map.insert(storage_id, adjusted);
            }
            Err(e) => {
                log::warn!(
                    "[confidential] {}: Failed to adjust balance for {}: {}",
                    account_id,
                    raw_id,
                    e
                );
            }
        }
    }

    // 2. Get last known balance_after for each token we've tracked for this account
    let known_tokens: Vec<(String, BigDecimal)> = sqlx::query_as(
        r#"
        SELECT DISTINCT ON (token_id) token_id, balance_after
        FROM balance_changes
        WHERE account_id = $1 AND token_id IS NOT NULL
        ORDER BY token_id, block_height DESC
        "#,
    )
    .bind(account_id)
    .fetch_all(&state.db_pool)
    .await?;

    let known_map: HashMap<String, BigDecimal> = known_tokens.into_iter().collect();

    let now = Utc::now();
    let block_timestamp = now.timestamp_nanos_opt().unwrap_or(0);
    let mut inserted = 0;

    // 3. Process current balances — detect new tokens and changes
    for (token_id, current_balance) in &current_map {
        let (should_insert, balance_before) = match known_map.get(token_id) {
            Some(last_balance) => {
                if *last_balance != *current_balance {
                    (true, last_balance.clone())
                } else {
                    (false, last_balance.clone())
                }
            }
            None => {
                // New token — first observation, insert with balance_before = 0
                (true, BigDecimal::from(0))
            }
        };

        if should_insert {
            let amount = current_balance - &balance_before;
            insert_confidential_balance_change(
                &state.db_pool,
                account_id,
                token_id,
                block_height,
                block_timestamp,
                now,
                &amount,
                &balance_before,
                current_balance,
            )
            .await?;
            inserted += 1;

            log::info!(
                "[confidential] {}/{}: Balance changed {} → {} (Δ{})",
                account_id,
                token_id,
                balance_before,
                current_balance,
                amount
            );
        }
    }

    // 4. Detect tokens that disappeared (previously known, now zero or absent)
    for (token_id, last_balance) in &known_map {
        if current_map.contains_key(token_id) {
            continue;
        }
        if *last_balance == BigDecimal::from(0) {
            continue;
        }

        let amount = -last_balance.clone();
        let zero = BigDecimal::from(0);
        insert_confidential_balance_change(
            &state.db_pool,
            account_id,
            token_id,
            block_height,
            block_timestamp,
            now,
            &amount,
            last_balance,
            &zero,
        )
        .await?;
        inserted += 1;

        log::info!(
            "[confidential] {}/{}: Token no longer present, balance {} → 0",
            account_id,
            token_id,
            last_balance
        );
    }

    if inserted > 0 {
        log::info!(
            "[confidential] {}: Recorded {} balance changes",
            account_id,
            inserted
        );
    }

    Ok(inserted)
}

/// Insert a single balance change record for a confidential treasury.
#[allow(clippy::too_many_arguments)]
async fn insert_confidential_balance_change(
    pool: &PgPool,
    account_id: &str,
    token_id: &str,
    block_height: i64,
    block_timestamp: i64,
    block_time: chrono::DateTime<Utc>,
    amount: &BigDecimal,
    balance_before: &BigDecimal,
    balance_after: &BigDecimal,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO balance_changes
        (account_id, token_id, block_height, block_timestamp, block_time,
         amount, balance_before, balance_after,
         transaction_hashes, receipt_id, signer_id, receiver_id,
         counterparty, actions, raw_data, action_kind, method_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (account_id, block_height, token_id) DO NOTHING
        "#,
        account_id,
        token_id,
        block_height,
        block_timestamp,
        block_time,
        amount,
        balance_before,
        balance_after,
        &Vec::<String>::new(),
        &Vec::<String>::new(),
        None::<String>,
        None::<String>,
        "CONFIDENTIAL",
        serde_json::json!({}),
        serde_json::json!({}),
        None::<String>,
        None::<String>,
    )
    .execute(pool)
    .await?;

    Ok(())
}

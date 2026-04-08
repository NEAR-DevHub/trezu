use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use bigdecimal::{BigDecimal, ToPrimitive};
use near_api::{AccountId, Contract, NearToken, Tokens, types::json::U128};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{
    AppState,
    constants::INTENTS_CONTRACT_ID,
    handlers::token::fetch_tokens_with_defuse_extension,
    utils::cache::{CacheKey, cached_json},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenBalanceQuery {
    pub account_id: AccountId,
    pub token_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenBalanceResponse {
    pub account_id: String,
    pub token_id: String,
    pub balance: U128,
    pub locked_balance: Option<U128>,
    pub decimals: u8,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenBalanceStringResponse {
    pub account_id: String,
    pub token_id: String,
    pub balance: String,
    pub locked_balance: Option<String>,
    pub decimals: u8,
}

pub const MIN_NEAR_DISPLAY_BALANCE: NearToken = NearToken::from_millinear(1);

/// Fetch NEAR balance for an account
pub async fn fetch_near_balance(
    state: &Arc<AppState>,
    account_id: AccountId,
) -> Result<TokenBalanceResponse, String> {
    let balance_future = Tokens::account(account_id.clone())
        .near_balance()
        .fetch_from(&state.network);

    let paid_near_future = sqlx::query_scalar::<_, BigDecimal>(
        "SELECT paid_near FROM monitored_accounts WHERE account_id = $1",
    )
    .bind(account_id.as_str())
    .fetch_optional(&state.db_pool);

    let (balance_result, paid_near_result) = tokio::join!(balance_future, paid_near_future);

    let balance = balance_result.map_err(|e| {
        eprintln!("Error fetching NEAR balance for {}: {}", account_id, e);
        format!("Failed to fetch NEAR balance: {}", e)
    })?;

    let paid_near_u128 = paid_near_result
        .ok()
        .flatten()
        .and_then(|v: BigDecimal| v.to_u128())
        .unwrap_or(0);

    let storage_locked = balance.storage_locked.as_yoctonear();
    let deduction = storage_locked.max(paid_near_u128);
    let total = balance.total.as_yoctonear();
    let available_raw = total.saturating_sub(deduction);
    // Display zero if the available balance is below 0.001 NEAR (1 milliNEAR)
    let available = if available_raw < MIN_NEAR_DISPLAY_BALANCE.as_yoctonear() {
        0
    } else {
        available_raw
    };

    Ok(TokenBalanceResponse {
        account_id: account_id.to_string(),
        token_id: "near".to_string(),
        balance: available.into(),
        locked_balance: Some(storage_locked.into()),
        decimals: 24,
    })
}

/// Fetch FT balance for an account
async fn fetch_ft_balance(
    state: &Arc<AppState>,
    account_id: AccountId,
    token_id: AccountId,
) -> Result<TokenBalanceResponse, String> {
    let balance = Tokens::account(account_id.clone())
        .ft_balance(token_id.clone())
        .fetch_from(&state.network)
        .await
        .map_err(|e| {
            eprintln!(
                "Error fetching FT balance for {} on {}: {}",
                account_id, token_id, e
            );
            format!("Failed to fetch token balance: {}", e)
        })?;

    Ok(TokenBalanceResponse {
        account_id: account_id.to_string(),
        token_id: token_id.to_string(),
        balance: balance.amount().into(),
        locked_balance: None,
        decimals: balance.decimals(),
    })
}

pub async fn fetch_intents_balance(
    state: &Arc<AppState>,
    account_id: AccountId,
    token_id: String,
) -> Result<TokenBalanceResponse, String> {
    let balance: U128 = Contract(INTENTS_CONTRACT_ID.into())
        .call_function(
            "mt_balance_of",
            serde_json::json!({
                "account_id": account_id,
                "token_id": token_id
            }),
        )
        .read_only()
        .fetch_from(&state.network)
        .await
        .map_err(|e| {
            eprintln!(
                "Error fetching Intents balance for {} on {}: {}",
                account_id, token_id, e
            );
            format!("Failed to fetch token balance: {}", e)
        })?
        .data;

    // Use the same metadata path as assets.rs — supports both nep141: and nep245: tokens.
    // The lookup key is "intents.near:<token_id>" which fetch_tokens_with_defuse_extension
    // maps to the Defuse/Ref SDK asset ID internally.
    let lookup_key = format!("intents.near:{}", token_id);
    let metadata_map =
        fetch_tokens_with_defuse_extension(state, std::slice::from_ref(&lookup_key)).await;
    let decimals = metadata_map
        .get(&lookup_key)
        .map(|m| m.decimals)
        .unwrap_or(18);

    Ok(TokenBalanceResponse {
        account_id: account_id.to_string(),
        token_id: token_id.to_string(),
        balance,
        locked_balance: None,
        decimals,
    })
}

/// Main handler for token balance endpoint
pub async fn get_token_balance(
    State(state): State<Arc<AppState>>,
    Query(params): Query<TokenBalanceQuery>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, String)> {
    let account_id = params.account_id.clone();
    let token_id = params.token_id.trim().to_string();

    let cache_key = CacheKey::new("token-balance")
        .with(&account_id)
        .with(&token_id)
        .build();

    let state_clone = state.clone();
    cached_json(&state.cache.short_term, cache_key, async move {
        // Determine if it's NEAR or FT token
        let is_near = token_id == "near" || token_id == "NEAR";

        if is_near {
            fetch_near_balance(&state_clone, account_id.clone()).await
        } else if token_id.starts_with("nep141:") || token_id.starts_with("nep245:") {
            fetch_intents_balance(&state_clone, account_id.clone(), token_id.to_string()).await
        } else {
            // Parse token_id as AccountId
            let token_account_id: AccountId = token_id.parse().map_err(|e| {
                eprintln!("Invalid token ID '{}': {}", token_id, e);
                format!("Invalid token ID: {}", e)
            })?;

            fetch_ft_balance(&state_clone, account_id.clone(), token_account_id).await
        }
        .map(|balance| TokenBalanceStringResponse {
            account_id: account_id.to_string(),
            token_id: token_id.to_string(),
            balance: balance.balance.0.to_string(),
            locked_balance: balance.locked_balance.map(|b| b.0.to_string()),
            decimals: balance.decimals,
        })
    })
    .await
}

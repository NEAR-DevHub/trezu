use axum::{Json, extract::State, http::StatusCode};
use chrono::{Duration, Utc};
use near_api::AccountId;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;
use crate::handlers::intents::confidential::reusable_deposit::ReusableDepositResolver;
use crate::handlers::intents::deposit_tracker::WatchActivation;
use crate::handlers::public_history::confidential_list::is_confidential_dao;
use crate::utils::cache::{CacheKey, CacheTier};
use crate::utils::jsonrpc::{JsonRpcRequest, JsonRpcResponse};

/// Deadline given to the dry 1Click quote that probes a token's bridge
/// minimum; the probe quote is never funded.
const MIN_PROBE_QUOTE_VALIDITY_DAYS: i64 = 14;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositAddressRequest {
    pub account_id: AccountId,
    pub chain: String,
    pub token_id: Option<String>,
    pub amount: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DepositAddressResult {
    pub address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Confidential: 1Click `quote.minAmountIn` (bridge floor). Public: unused/None.
    pub min_amount: Option<String>,
    pub memo: Option<String>,
    /// Confidential: the treasury's reusable 1Click quote address (the
    /// deposit tracker scope). Differs from `address`, which is the funding
    /// address on the chosen chain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_deposit_address: Option<String>,
}

/// Matches near.com confidential deposit slippage (0.1% → 10 bips).
const CONFIDENTIAL_DEPOSIT_SLIPPAGE_TOLERANCE: u32 = 10;

/// near.com credits NEAR deposited on Hyperliquid as `nep141:wrap.near`.
const HYPERCORE_NEAR_ASSET_ID: &str = "1cs_v1:hypercore:hip1:0x20b8c9d2f022ffd2aea4f7962b7b1d8b";
const NEAR_HELD_ASSET_ID: &str = "nep141:wrap.near";

/// Asset a confidential deposit is credited as. The depositor sends `token_id`.
/// NEAR on Hyperliquid is the one route near.com settles into held NEAR.
fn confidential_deposit_destination_asset(token_id: &str) -> &str {
    if token_id == HYPERCORE_NEAR_ASSET_ID {
        NEAR_HELD_ASSET_ID
    } else {
        token_id
    }
}

/// One 1Click confidential deposit quote attempt loop: `FLEX_INPUT` with the
/// `INTENTS` deposit type crediting the DAO's confidential balance. The
/// FE-supplied `amount` is a probe; when 1Click rejects it as below the
/// bridge floor, the quote is retried at the floor from the error (or 10x).
/// Returns the `quote` object. `dry` quotes carry no deposit address.
async fn mint_confidential_deposit_quote(
    state: &Arc<AppState>,
    account_id: &str,
    token_id: &str,
    mut amount: u128,
    deadline: &str,
    dry: bool,
) -> Result<serde_json::Value, (StatusCode, String)> {
    let url = format!("{}/v0/quote", state.env_vars.confidential_api_url);
    if amount == 0 {
        amount = 1;
    }
    let mut last_error = String::new();

    for attempt in 0..3 {
        let quote_body = serde_json::json!({
            "dry": dry,
            "swapType": "FLEX_INPUT",
            "slippageTolerance": CONFIDENTIAL_DEPOSIT_SLIPPAGE_TOLERANCE,
            "originAsset": token_id,
            "depositType": "INTENTS",
            "destinationAsset": confidential_deposit_destination_asset(token_id),
            "amount": amount.to_string(),
            "refundTo": account_id,
            "refundType": "CONFIDENTIAL_INTENTS",
            "recipient": account_id,
            "recipientType": "CONFIDENTIAL_INTENTS",
            "deadline": deadline,
            "quoteWaitingTimeMs": 5000,
        });

        // API key is attached in send_oneclick_request; DAO JWT is not required.
        match super::quote::send_oneclick_request(state, &url, &quote_body, None).await {
            Ok(mut response_body) => {
                return match response_body.get_mut("quote") {
                    Some(quote) => Ok(quote.take()),
                    None => Err((
                        StatusCode::BAD_GATEWAY,
                        "Confidential quote missing quote object".to_string(),
                    )),
                };
            }
            Err((status, msg)) => {
                last_error = msg.clone();
                let is_amount_error = msg.to_lowercase().contains("amount")
                    || msg.to_lowercase().contains("too low")
                    || msg.to_lowercase().contains("minimum");
                if !is_amount_error || attempt == 2 {
                    return Err((status, msg));
                }
                let next_amount = parse_bridge_minimum_hint(&msg)
                    .filter(|n| *n > amount)
                    .unwrap_or_else(|| amount.saturating_mul(10).max(10));
                tracing::info!(
                    "Quote amount {} too low (attempt {}), retrying with {}",
                    amount,
                    attempt + 1,
                    next_amount
                );
                amount = next_amount;
            }
        }
    }

    Err((StatusCode::BAD_GATEWAY, last_error))
}

/// 1Click's bridge floor for the token (`quote.minAmountIn`), the FE minimum.
fn quote_min_amount_in(quote: &serde_json::Value) -> Result<String, (StatusCode, String)> {
    quote
        .get("minAmountIn")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                "Confidential quote did not return minAmountIn".to_string(),
            )
        })
}

/// Confidential treasuries: the DAO's long-lived 1Click deposit address set,
/// selected by chain. No expiry; the address takes any number of deposits.
/// `min_amount` comes from a dry quote probe, which is where 1Click reports
/// the bridge floor.
async fn get_reusable_confidential_deposit_address(
    state: &Arc<AppState>,
    account_id: &near_account_id::AccountIdRef,
    chain: &str,
    token_id: &str,
    amount: u128,
) -> Result<DepositAddressResult, (StatusCode, String)> {
    let resolver = ReusableDepositResolver::new(state);
    let mut set = resolver.resolve(account_id).await?;
    if set.address_for_chain(chain).is_none() {
        // 1Click may have added the chain since the set was cached.
        match resolver.refresh(account_id).await {
            Ok(fresh) => set = fresh,
            Err((status, message)) => tracing::warn!(
                dao_id = account_id.as_str(),
                chain,
                %status,
                "reusable deposit set refresh failed: {message}"
            ),
        }
    }
    let entry = set.address_for_chain(chain).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            format!("No reusable deposit address for network {chain}"),
        )
    })?;
    let probe_deadline = (Utc::now() + Duration::days(MIN_PROBE_QUOTE_VALIDITY_DAYS))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let min_amount = match mint_confidential_deposit_quote(
        state,
        account_id.as_str(),
        token_id,
        amount,
        &probe_deadline,
        true,
    )
    .await
    {
        Ok(quote) => quote_min_amount_in(&quote).ok(),
        Err((status, message)) => {
            tracing::warn!(
                dao_id = account_id.as_str(),
                token_id,
                %status,
                "bridge floor probe failed; serving reusable address without a minimum: {message}"
            );
            None
        }
    };
    Ok(DepositAddressResult {
        address: entry.address.clone(),
        min_amount,
        memo: entry.memo.clone(),
        quote_deposit_address: Some(set.quote_deposit_address.clone()),
    })
}

/// Parse `try at least N` from 1Click bridge-floor errors.
/// Searches and slices the lowercased string so non-ASCII before the marker
/// cannot shift the byte offset relative to the original message.
fn parse_bridge_minimum_hint(msg: &str) -> Option<u128> {
    let lower = msg.to_lowercase();
    let marker = "try at least ";
    let idx = lower.find(marker)?;
    let rest = lower.get(idx + marker.len()..)?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok().filter(|n| *n > 0)
}

/// Fetch deposit address from the bridge RPC for a given account and chain.
async fn fetch_bridge_deposit_address(
    state: &Arc<AppState>,
    account_id: &str,
    chain: &str,
) -> Result<DepositAddressResult, (StatusCode, String)> {
    let cache_key = CacheKey::new("bridge:deposit-address")
        .with(account_id)
        .with(chain)
        .build();

    let account_id = account_id.to_string();
    let chain = chain.to_string();
    let state_clone = state.clone();

    state
        .cache
        .cached(CacheTier::LongTerm, cache_key, async move {
            // Try SIMPLE mode first, fall back to MEMO if it fails
            match fetch_deposit_address(&state_clone, &account_id, &chain, "SIMPLE").await {
                Ok(result) => Ok(result),
                Err(_) => fetch_deposit_address(&state_clone, &account_id, &chain, "MEMO").await,
            }
        })
        .await
}

/// Fetch deposit address for a specific account and chain.
///
/// **Public** treasuries use Bridge/POA `depositAddressFetch(account, chain)` —
/// the address is stable for that treasury+chain (same as near.com).
/// **Confidential** treasuries mint a rotating 1Click wet quote (`tokenId`
/// should be the 1Click `quoteAssetId`, which may be `1cs_v1:…`) and return
/// that quote's Bridge origin-chain deposit address plus `minAmountIn`.
/// The credit is that same id, except NEAR on Hyperliquid, which is credited
/// as `nep141:wrap.near`.
///
/// Guests and non-members may generate addresses — depositing funds into a
/// treasury is not a member-only action. Confidential quotes use the app API
/// key (no DAO JWT).
pub async fn get_deposit_address(
    State(state): State<Arc<AppState>>,
    Json(request): Json<DepositAddressRequest>,
) -> Result<Json<DepositAddressResult>, (StatusCode, String)> {
    let account_id = request.account_id.clone();
    let chain = request.chain.clone();

    let confidential = is_confidential_dao(&state.db_pool, account_id.as_str())
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to check confidential status: {}", e),
            )
        })?;

    if confidential {
        let token_id = request.token_id.ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "tokenId is required for confidential treasuries".to_string(),
            )
        })?;
        let amount: u128 = request
            .amount
            .as_deref()
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);
        let result = get_reusable_confidential_deposit_address(
            &state,
            &account_id,
            &chain,
            &token_id,
            amount,
        )
        .await?;
        if let Some(quote_deposit_address) = result.quote_deposit_address.as_deref() {
            activate_deposit_watch(
                &state,
                WatchActivation {
                    dao_id: account_id.to_string(),
                    chain: chain.clone(),
                    token_id: Some(token_id.clone()),
                },
                Some(quote_deposit_address),
            )
            .await;
        }
        return Ok(Json(result));
    }

    let result = fetch_bridge_deposit_address(&state, account_id.as_str(), &chain)
        .await
        .inspect_err(|(status, msg)| {
            if status.is_server_error() {
                crate::error_event!(
                    crate::error_event::ErrorCode::DepositAddressFailed,
                    account_id = %account_id,
                    chain,
                    status = %status,
                    error = %msg
                );
            }
        })?;
    activate_deposit_watch(
        &state,
        WatchActivation {
            dao_id: account_id.to_string(),
            chain,
            token_id: request.token_id,
        },
        None,
    )
    .await;
    Ok(Json(result))
}

/// Showing an address starts (or renews) deposit tracking. Tracking is a
/// best-effort UX layer: failures are logged and never fail the address
/// request. Accounts that are not monitored are skipped.
async fn activate_deposit_watch(
    state: &AppState,
    activation: WatchActivation,
    confidential_quote: Option<&str>,
) {
    let outcome = match confidential_quote {
        Some(quote_deposit_address) => {
            activation
                .activate_confidential(&state.db_pool, quote_deposit_address)
                .await
        }
        None => activation.activate_public(&state.db_pool).await,
    };
    match outcome {
        Ok(true) => {}
        Ok(false) => tracing::debug!(
            dao_id = %activation.dao_id,
            "deposit watch skipped: account is not monitored"
        ),
        Err(error) => tracing::warn!(
            dao_id = %activation.dao_id,
            chain = %activation.chain,
            %error,
            "deposit watch activation failed"
        ),
    }
}

async fn fetch_deposit_address(
    state: &AppState,
    account_id: &str,
    chain: &str,
    deposit_mode: &str,
) -> Result<DepositAddressResult, String> {
    let rpc_request = JsonRpcRequest::new(
        "depositAddressFetch",
        "deposit_address",
        vec![serde_json::json!({
            "deposit_mode": deposit_mode,
            "account_id": account_id,
            "chain": chain,
        })],
    );

    let response = state
        .http_client
        .post(&state.env_vars.bridge_rpc_url)
        .header("content-type", "application/json")
        .json(&rpc_request)
        .send()
        .await
        .map_err(|e| {
            eprintln!("Error fetching deposit address from bridge: {}", e);
            format!("Failed to fetch deposit address: {}", e)
        })?;

    if !response.status().is_success() {
        return Err(format!("HTTP error! status: {}", response.status()));
    }

    let raw = response.json::<serde_json::Value>().await.map_err(|e| {
        eprintln!("Error parsing bridge response: {}", e);
        "Failed to parse bridge response".to_string()
    })?;

    // Bridge sometimes returns `"error": "Network not supported"` (string) instead
    // of a JSON-RPC `{ code, message }` object.
    if let Some(error) = raw.get("error") {
        if let Some(message) = error.as_str() {
            return Err(message.to_string());
        }
        if let Some(message) = error.get("message").and_then(|m| m.as_str()) {
            return Err(message.to_string());
        }
        return Err(format!("Bridge error: {error}"));
    }

    let data: JsonRpcResponse<DepositAddressResult> = serde_json::from_value(raw).map_err(|e| {
        eprintln!("Error parsing bridge response: {}", e);
        "Failed to parse bridge response".to_string()
    })?;

    data.result
        .ok_or_else(|| "No deposit address found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hypercore_near_id_is_in_the_vendored_catalog() {
        use crate::constants::intents_tokens::get_defuse_tokens_map;

        assert!(
            get_defuse_tokens_map().contains_key(HYPERCORE_NEAR_ASSET_ID),
            "HYPERCORE_NEAR_ASSET_ID drifted from nearcom-tokens.json"
        );
    }

    #[test]
    fn hyperliquid_near_deposit_credits_wrap_near() {
        assert_eq!(
            confidential_deposit_destination_asset(HYPERCORE_NEAR_ASSET_ID),
            NEAR_HELD_ASSET_ID
        );
        assert_eq!(
            confidential_deposit_destination_asset("1cs_v1:near:nep141:zec.omft.near"),
            "1cs_v1:near:nep141:zec.omft.near"
        );
        assert_eq!(
            confidential_deposit_destination_asset(
                "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG"
            ),
            "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG"
        );
    }

    #[test]
    fn parse_bridge_minimum_hint_reads_try_at_least() {
        assert_eq!(
            parse_bridge_minimum_hint("Amount is too low for bridge, try at least 324044069993519"),
            Some(324044069993519)
        );
        assert_eq!(parse_bridge_minimum_hint("tokenIn is not valid"), None);
        assert_eq!(parse_bridge_minimum_hint("try at least 0"), None);
    }
}

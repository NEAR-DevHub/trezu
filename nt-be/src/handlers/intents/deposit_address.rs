use axum::{Json, extract::State, http::StatusCode};
use near_api::AccountId;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;
use crate::handlers::intents::confidential::reusable_deposit::{
    ResolvedDepositAddress, ReusableDepositResolver,
};
use crate::handlers::intents::deposit_tracker::WatchActivation;
use crate::handlers::public_history::confidential_list::is_confidential_dao;
use crate::utils::cache::{CacheKey, CacheTier};
use crate::utils::jsonrpc::{JsonRpcRequest, JsonRpcResponse};

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

impl From<ResolvedDepositAddress> for DepositAddressResult {
    fn from(resolved: ResolvedDepositAddress) -> Self {
        Self {
            address: resolved.address,
            min_amount: resolved.min_amount,
            memo: resolved.memo,
            quote_deposit_address: Some(resolved.quote_deposit_address),
        }
    }
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
        let result = DepositAddressResult::from(
            ReusableDepositResolver::new(&state)
                .deposit_address(&account_id, &chain, &token_id, amount)
                .await?,
        );
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

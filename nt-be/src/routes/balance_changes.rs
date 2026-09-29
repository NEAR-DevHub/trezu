use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use near_api::AccountId;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::types::BigDecimal;
use sqlx::types::chrono::{DateTime, Utc};
use std::sync::Arc;

use crate::handlers::public_history::confidential_list;
use crate::handlers::public_history::public_list;
use crate::handlers::token::TokenMetadata;
use crate::utils::serde::comma_separated;
use crate::{AppState, auth::OptionalAuthUser};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceChangesQuery {
    pub account_id: AccountId,

    // Pagination
    pub limit: Option<i64>,
    pub offset: Option<i64>,

    // Date Filtering
    pub start_time: Option<String>, // ISO 8601 format
    pub end_time: Option<String>,   // ISO 8601 format

    // Token Filtering (Whitelist OR Blacklist)
    #[serde(default, deserialize_with = "comma_separated")]
    pub token_ids: Option<Vec<String>>, // Include ONLY these (whitelist)
    #[serde(default, deserialize_with = "comma_separated")]
    pub exclude_token_ids: Option<Vec<String>>, // Exclude these (blacklist)

    // Transaction Type Filtering (can select multiple)
    #[serde(default, deserialize_with = "comma_separated")]
    pub transaction_types: Option<Vec<String>>, // "incoming", "outgoing", "staking_rewards", "exchange"

    // Amount Filtering (decimal-adjusted, requires single token filter)
    pub min_amount: Option<f64>, // Minimum amount in decimal-adjusted format (e.g., 1.5 NEAR)
    pub max_amount: Option<f64>, // Maximum amount in decimal-adjusted format (e.g., 100 USDC)

    // Search filtering
    pub tx_hash: Option<String>, // Partial match against transaction hashes
    #[serde(default, deserialize_with = "comma_separated")]
    pub from_accounts: Option<Vec<String>>, // "From" account(s) filter
    #[serde(default, deserialize_with = "comma_separated")]
    pub from_accounts_not: Option<Vec<String>>, // Exclude these "From" account(s)
    #[serde(default, deserialize_with = "comma_separated")]
    pub to_accounts: Option<Vec<String>>, // "To" account(s) filter
    #[serde(default, deserialize_with = "comma_separated")]
    pub to_accounts_not: Option<Vec<String>>, // Exclude these "To" account(s)

    pub include_metadata: Option<bool>, // default: false (enrich with token metadata like symbol, name, decimals, icon)
    pub include_prices: Option<bool>, // default: false (fetch historical USD prices for transaction dates from DB; if missing, returns None)
    pub include_chain_metadata: Option<bool>, // default: false (enrich with chain/network metadata for cross-chain tokens)

    #[serde(skip)]
    pub exclude_near_dust: bool, // Filter out tiny NEAR amounts (< 0.01) — not a query param, set internally

    #[serde(skip)]
    pub exclude_swaps_from_direction: bool, // If true, "incoming" and "outgoing" exclude swaps (for UI tabs); if false, include swaps (for exports/API)
}

/// Swap information attached to balance changes
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SwapInfo {
    pub sent_token_id: Option<String>,
    pub sent_amount: Option<BigDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_token_metadata: Option<TokenMetadata>,
    pub received_token_id: String,
    pub received_amount: Option<BigDecimal>,
    pub received_token_metadata: TokenMetadata,
    pub solver_transaction_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_amount_usd: Option<BigDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received_amount_usd: Option<BigDecimal>,
}

/// Enriched balance change with optional metadata and swap info
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedBalanceChange {
    pub id: i64,
    pub account_id: String,
    pub block_height: i64,
    pub block_time: DateTime<Utc>,
    pub token_id: String, // Transformed: "near" for staking
    pub receipt_id: Vec<String>,
    pub transaction_hashes: Vec<String>,
    pub counterparty: Option<String>, // Transformed: pool address for staking
    pub signer_id: Option<String>,
    pub receiver_id: Option<String>,
    pub amount: BigDecimal,
    pub balance_before: BigDecimal,
    pub balance_after: BigDecimal,
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_metadata: Option<TokenMetadata>, // Only present if include_metadata: true
    #[serde(skip_serializing_if = "Option::is_none")]
    pub swap: Option<SwapInfo>, // Only present for swap transactions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usd_value: Option<BigDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<i64>,
    /// 1Click deposit address of the linked quote proposal; presence marks the
    /// row as intents-routed so clients can link the intents explorer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quote_deposit_address: Option<String>,
}

/// The backing store selected for one balance-history request.
///
/// Composite responses must keep this value for their entire request instead
/// of re-classifying the DAO for each component query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BalanceChangesReadSource {
    Confidential,
    PublicGold,
}

pub(crate) async fn resolve_balance_changes_read_source(
    state: &AppState,
    account_id: &str,
) -> Result<BalanceChangesReadSource, sqlx::Error> {
    if confidential_list::is_confidential_dao(&state.db_pool, account_id).await? {
        Ok(BalanceChangesReadSource::Confidential)
    } else {
        Ok(BalanceChangesReadSource::PublicGold)
    }
}

pub(crate) async fn get_balance_changes_from_source(
    state: &Arc<AppState>,
    params: &BalanceChangesQuery,
    source: BalanceChangesReadSource,
) -> Result<Vec<EnrichedBalanceChange>, Box<dyn std::error::Error + Send + Sync>> {
    match source {
        BalanceChangesReadSource::Confidential => {
            confidential_list::fetch_balance_change_legs(state, params).await
        }
        BalanceChangesReadSource::PublicGold => {
            public_list::fetch_balance_change_legs(state, params).await
        }
    }
}

/// Internal function to fetch and enrich balance changes.
/// This is the single source of truth for one-query balance change reads.
pub async fn get_balance_changes_internal(
    state: &Arc<AppState>,
    params: &BalanceChangesQuery,
) -> Result<Vec<EnrichedBalanceChange>, Box<dyn std::error::Error + Send + Sync>> {
    let source = resolve_balance_changes_read_source(state, params.account_id.as_str()).await?;
    get_balance_changes_from_source(state, params, source).await
}

pub async fn get_balance_changes(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Query(mut params): Query<BalanceChangesQuery>,
) -> Result<Json<Vec<EnrichedBalanceChange>>, (StatusCode, Json<Value>)> {
    user.verify_member_if_confidential(&state.db_pool, &params.account_id)
        .await
        .map_err(|(status, message)| (status, Json(serde_json::json!({ "error": message }))))?;

    // Apply default limit for public API if not specified
    if params.limit.is_none() {
        params.limit = Some(100);
    }

    let enriched_changes = get_balance_changes_internal(&state, &params)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch balance changes: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to fetch balance changes",
                    "details": e.to_string()
                })),
            )
        })?;

    Ok(Json(enriched_changes))
}

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use near_api::AccountId;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_with::{DisplayFromStr, serde_as};
use sqlx::PgPool;
use std::sync::Arc;

use crate::AppState;
use crate::constants::external_apis::NEARBLOCKS_API_BASE;
use crate::utils::cache::{CacheKey, CacheTier};
use crate::utils::url::api_url_or_500;

#[derive(Deserialize, Debug)]
struct NearBlocksPage<T> {
    data: Vec<T>,
    #[serde(default)]
    meta: Option<NearBlocksMeta>,
}

#[derive(Deserialize, Debug)]
struct NearBlocksItem<T> {
    data: T,
}

#[derive(Deserialize, Debug)]
struct NearBlocksMeta {
    /// Opaque continuation for the next (older) page; absent on the last one.
    #[serde(default)]
    next_page: Option<String>,
}

/// One row of `v3/accounts/{account}/receipts`. The list carries the method
/// name only; call args live on the transaction's receipt tree.
#[derive(Deserialize, Debug)]
struct NearBlocksReceipt {
    receipt_id: String,
    transaction_hash: String,
    block: NearBlocksBlock,
}

#[serde_as]
#[derive(Deserialize, Debug)]
struct NearBlocksBlock {
    #[serde_as(as = "DisplayFromStr")]
    block_height: u64,
    #[serde_as(as = "DisplayFromStr")]
    block_timestamp: u64,
}

/// Node of `v3/txns/{hash}/receipts`, a recursive receipt tree.
#[derive(Deserialize, Debug)]
struct NearBlocksReceiptNode {
    receipt_id: String,
    #[serde(default)]
    actions: Vec<NearBlocksAction>,
    #[serde(default)]
    receipts: Vec<NearBlocksReceiptNode>,
}

#[derive(Deserialize, Debug)]
struct NearBlocksAction {
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    args: Value,
}

#[derive(Deserialize, Debug)]
struct NearBlocksTxn {
    block: NearBlocksBlock,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProposalTransactionResponse {
    pub transaction_hash: String,
    pub nearblocks_url: String,
    pub block_height: u64,
    pub timestamp: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionQueryParams {
    pub after_date: NaiveDate,
    pub before_date: NaiveDate,
    pub action: String,
}

/// Upper bound on NearBlocks receipt pages walked per method. Every receipt
/// costs one extra call for its args, so a lookup spends at most 53 calls per
/// method (2 list, 50 receipt-tree, 1 transaction), well under the plan's
/// per-minute limit.
const MAX_RECEIPT_PAGES: u32 = 2;

/// GET a NearBlocks v3 URL. `None` means NearBlocks answered with a non-2xx
/// status.
async fn fetch_nearblocks<T: serde::de::DeserializeOwned>(
    http_client: &crate::observability::HttpClient,
    api_key: &str,
    url: url::Url,
) -> Result<Option<T>, (StatusCode, String)> {
    let response = http_client
        .get(url)
        .header("accept", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch from NearBlocks API: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch from external API".to_string(),
            )
        })?;

    if !response.status().is_success() {
        tracing::info!("NearBlocks API returned {}", response.status());
        return Ok(None);
    }

    response.json().await.map(Some).map_err(|e| {
        tracing::error!("Failed to parse NearBlocks response: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to parse API response".to_string(),
        )
    })
}

/// Midnight UTC of `date` in nanoseconds.
fn date_to_nanos(date: NaiveDate) -> u64 {
    date.and_time(NaiveTime::MIN)
        .and_utc()
        .timestamp_nanos_opt()
        .and_then(|nanos| u64::try_from(nanos).ok())
        .unwrap_or(u64::MAX)
}

#[tracing::instrument(level = "debug", skip_all, fields(dao_id = %dao_id, method = method))]
async fn fetch_nearblocks_receipts(
    http_client: &crate::observability::HttpClient,
    api_key: &str,
    dao_id: &AccountId,
    method: &str,
    before_ts: u64,
    cursor: Option<&str>,
) -> Result<NearBlocksPage<NearBlocksReceipt>, (StatusCode, String)> {
    let mut url = api_url_or_500(
        NEARBLOCKS_API_BASE,
        &format!("v3/accounts/{dao_id}/receipts"),
    )?;
    url.query_pairs_mut()
        .append_pair("method", method)
        .append_pair("before_ts", &before_ts.to_string());
    if let Some(cursor) = cursor {
        url.query_pairs_mut().append_pair("next", cursor);
    }

    Ok(fetch_nearblocks(http_client, api_key, url)
        .await?
        .unwrap_or(NearBlocksPage {
            data: vec![],
            meta: None,
        }))
}

/// Walk the receipt pages for one method, newest first, until the proposal's
/// transaction is found, the window's lower bound is passed, the last page is
/// reached, or the page cap is hit.
#[allow(clippy::too_many_arguments)]
async fn find_matching_transaction_paged(
    http_client: &crate::observability::HttpClient,
    api_key: &str,
    dao_id: &AccountId,
    method: &str,
    after_date: NaiveDate,
    before_date: NaiveDate,
    proposal_id: u64,
    action_str: &str,
) -> Result<Option<ProposalTransactionResponse>, (StatusCode, String)> {
    let after_ts = date_to_nanos(after_date);
    // `before_ts` is exclusive; keep the whole `before_date` day in range.
    let before_ts = date_to_nanos(before_date.succ_opt().unwrap_or(before_date));

    let mut cursor: Option<String> = None;
    for page in 1..=MAX_RECEIPT_PAGES {
        let response = fetch_nearblocks_receipts(
            http_client,
            api_key,
            dao_id,
            method,
            before_ts,
            cursor.as_deref(),
        )
        .await?;
        tracing::info!(
            "Found {} {} receipts on page {}",
            response.data.len(),
            method,
            page
        );

        for receipt in &response.data {
            if receipt.block.block_timestamp < after_ts {
                return Ok(None);
            }

            let tree_url = api_url_or_500(
                NEARBLOCKS_API_BASE,
                &format!("v3/txns/{}/receipts", receipt.transaction_hash),
            )?;
            let Some(tree) = fetch_nearblocks::<NearBlocksItem<NearBlocksReceiptNode>>(
                http_client,
                api_key,
                tree_url,
            )
            .await?
            else {
                continue;
            };
            if !receipt_matches(&tree.data, &receipt.receipt_id, proposal_id, action_str) {
                continue;
            }

            let Some(block_height) =
                fetch_transaction_block_height(http_client, api_key, &receipt.transaction_hash)
                    .await?
            else {
                continue;
            };

            return Ok(Some(ProposalTransactionResponse {
                transaction_hash: receipt.transaction_hash.clone(),
                nearblocks_url: format!("https://nearblocks.io/txns/{}", receipt.transaction_hash),
                block_height,
                timestamp: receipt.block.block_timestamp,
            }));
        }

        cursor = response
            .meta
            .and_then(|meta| meta.next_page)
            .filter(|c| !c.is_empty());
        if response.data.is_empty() || cursor.is_none() {
            break;
        }
    }
    Ok(None)
}

/// Height of the block that included the transaction itself (not any of its
/// receipts).
async fn fetch_transaction_block_height(
    http_client: &crate::observability::HttpClient,
    api_key: &str,
    transaction_hash: &str,
) -> Result<Option<u64>, (StatusCode, String)> {
    let url = api_url_or_500(NEARBLOCKS_API_BASE, &format!("v3/txns/{transaction_hash}"))?;
    Ok(
        fetch_nearblocks::<NearBlocksItem<NearBlocksTxn>>(http_client, api_key, url)
            .await?
            .map(|txn| txn.data.block.block_height),
    )
}

/// Execution already recorded in `dao_proposals` by the public-history
/// linker (from the proposal's `on_proposal_callback` receipt).
async fn find_recorded_execution(
    pool: &PgPool,
    http_client: &crate::observability::HttpClient,
    api_key: &str,
    dao_id: &AccountId,
    proposal_id: u64,
) -> Result<Option<ProposalTransactionResponse>, (StatusCode, String)> {
    let recorded = sqlx::query_as::<_, (String, DateTime<Utc>)>(
        r#"
        SELECT proposal_execution_transaction_hash, proposal_executed_at
        FROM dao_proposals
        WHERE dao_id = $1
          AND proposal_id = $2
          AND proposal_execution_transaction_hash IS NOT NULL
          AND proposal_executed_at IS NOT NULL
        "#,
    )
    .bind(dao_id.as_str())
    .bind(i64::try_from(proposal_id).unwrap_or(i64::MAX))
    .fetch_optional(pool)
    .await;

    let (transaction_hash, executed_at) = match recorded {
        Ok(Some(row)) => row,
        Ok(None) => return Ok(None),
        Err(e) => {
            tracing::warn!("Failed to read recorded proposal execution: {}", e);
            return Ok(None);
        }
    };
    let Some(timestamp) = executed_at
        .timestamp_nanos_opt()
        .and_then(|nanos| u64::try_from(nanos).ok())
    else {
        return Ok(None);
    };
    let Some(block_height) =
        fetch_transaction_block_height(http_client, api_key, &transaction_hash).await?
    else {
        return Ok(None);
    };

    Ok(Some(ProposalTransactionResponse {
        nearblocks_url: format!("https://nearblocks.io/txns/{transaction_hash}"),
        transaction_hash,
        block_height,
        timestamp,
    }))
}

/// Find `receipt_id` in the tree and check that it votes on / calls back for
/// this proposal.
fn receipt_matches(
    node: &NearBlocksReceiptNode,
    receipt_id: &str,
    proposal_id: u64,
    action_str: &str,
) -> bool {
    if node.receipt_id != receipt_id {
        return node
            .receipts
            .iter()
            .any(|child| receipt_matches(child, receipt_id, proposal_id, action_str));
    }

    node.actions.iter().any(|action| {
        let args = &action.args["args_json"];
        match action.method.as_deref() {
            Some("on_proposal_callback") => {
                args.get("proposal_id").and_then(|v| v.as_u64()) == Some(proposal_id)
            }
            Some("act_proposal") => {
                args.get("id").and_then(|v| v.as_u64()) == Some(proposal_id)
                    && args.get("action").and_then(|v| v.as_str()) == Some(action_str)
            }
            _ => false,
        }
    })
}

/// Find the execution transaction for a proposal by querying NearBlocks API
pub async fn find_proposal_execution_transaction(
    State(state): State<Arc<AppState>>,
    Path((dao_id, proposal_id)): Path<(AccountId, u64)>,
    Query(params): Query<TransactionQueryParams>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, String)> {
    let response =
        find_proposal_execution_transaction_inner(&state, &dao_id, proposal_id, &params).await?;
    Ok((
        StatusCode::OK,
        Json(serde_json::to_value(response).unwrap_or(Value::Null)),
    ))
}

/// Reusable lookup: returns the structured `ProposalTransactionResponse`.
/// Used by the public `/tx` endpoint and by other handlers that need the
/// execution block for a proposal.
#[tracing::instrument(
    level = "info",
    skip_all,
    fields(dao_id = %dao_id, proposal_id = proposal_id)
)]
pub async fn find_proposal_execution_transaction_inner(
    state: &Arc<AppState>,
    dao_id: &AccountId,
    proposal_id: u64,
    params: &TransactionQueryParams,
) -> Result<ProposalTransactionResponse, (StatusCode, String)> {
    tracing::info!(
        "Searching for proposal {} execution between {} and {}",
        proposal_id,
        params.after_date,
        params.before_date
    );

    let Some(nearblocks_api_key) = state.env_vars.nearblocks_api_key.as_ref() else {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "NearBlocks API is not enabled".to_string(),
        ));
    };

    let cache_key = CacheKey::new("proposal-tx")
        .with(dao_id)
        .with(proposal_id)
        .with(&params.action)
        .build();

    let db_pool = state.db_pool.clone();
    let http_client = state.http_client.clone();
    let api_key = nearblocks_api_key.clone();
    let dao_id_clone = dao_id.clone();
    let action = params.action.clone();
    let after_date = params.after_date;
    let before_date = params.before_date;

    state
        .cache
        .cached(CacheTier::LongTerm, cache_key, async move {
            if action == "VoteApprove" {
                if let Some(response) = find_recorded_execution(
                    &db_pool,
                    &http_client,
                    &api_key,
                    &dao_id_clone,
                    proposal_id,
                )
                .await?
                {
                    tracing::info!(
                        "Found recorded execution transaction: {}",
                        response.transaction_hash
                    );
                    return Ok(response);
                }

                // Try on_proposal_callback first
                if let Some(response) = find_matching_transaction_paged(
                    &http_client,
                    &api_key,
                    &dao_id_clone,
                    "on_proposal_callback",
                    after_date,
                    before_date,
                    proposal_id,
                    &action,
                )
                .await?
                {
                    tracing::info!("Found execution transaction: {}", response.transaction_hash);
                    return Ok(response);
                }
            }

            // Fallback to act_proposal if not found
            if let Some(response) = find_matching_transaction_paged(
                &http_client,
                &api_key,
                &dao_id_clone,
                "act_proposal",
                after_date,
                before_date,
                proposal_id,
                &action,
            )
            .await?
            {
                tracing::info!("Found execution transaction: {}", response.transaction_hash);
                return Ok(response);
            }

            tracing::info!(
                "No execution transaction found for proposal {}",
                proposal_id
            );
            Err((
                StatusCode::NOT_FOUND,
                format!(
                    "No execution transaction found for proposal {}",
                    proposal_id
                ),
            ))
        })
        .await
}

// Receipt search types and endpoint

#[derive(Deserialize, Debug)]
struct NearBlocksReceiptSearchResponse {
    data: Vec<NearBlocksReceiptInfo>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct NearBlocksReceiptInfo {
    pub receipt_id: String,
    pub transaction_hash: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptSearchResult {
    pub receipt_id: String,
    pub originated_from_transaction_hash: String,
}

#[derive(Deserialize)]
pub struct ReceiptSearchQuery {
    pub keyword: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPriceAtTimestampQuery {
    pub token_id: String,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenPriceAtTimestampResponse {
    pub price_usd: Option<f64>,
    pub source: String,
}

/// Search for a receipt by keyword (receipt ID) and return the originating transaction hash
#[tracing::instrument(level = "info", skip_all, fields(step = "receipt_search"))]
pub async fn search_receipt(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ReceiptSearchQuery>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, String)> {
    let Some(nearblocks_api_key) = state.env_vars.nearblocks_api_key.as_ref() else {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "NearBlocks API is not enabled".to_string(),
        ));
    };

    let cache_key = CacheKey::new("receipt-search")
        .with(&params.keyword)
        .build();

    let http_client = state.http_client.clone();
    let api_key = nearblocks_api_key.clone();
    let keyword = params.keyword.clone();

    state
        .cache
        .cached_json(CacheTier::LongTerm, cache_key, async move {
            let mut url = api_url_or_500(NEARBLOCKS_API_BASE, "v3/search/receipts")?;
            url.query_pairs_mut().append_pair("keyword", &keyword);

            let response = http_client
                .get(url)
                .header("accept", "application/json")
                .header("Authorization", format!("Bearer {}", api_key))
                .send()
                .await
                .map_err(|e| {
                    tracing::error!("Failed to fetch from NearBlocks receipt search API: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to fetch from external API".to_string(),
                    )
                })?;

            if !response.status().is_success() {
                tracing::error!("NearBlocks receipt search API error: {}", response.status());
                return Err((
                    StatusCode::from_u16(response.status().as_u16())
                        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                    "Receipt search failed".to_string(),
                ));
            }
            let data = response.json().await;

            let data: NearBlocksReceiptSearchResponse = data.map_err(|e| {
                tracing::error!("Failed to parse NearBlocks receipt search response: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to parse API response".to_string(),
                )
            })?;

            Ok::<_, (StatusCode, String)>(
                data.data
                    .into_iter()
                    .map(|r| ReceiptSearchResult {
                        receipt_id: r.receipt_id,
                        originated_from_transaction_hash: r.transaction_hash,
                    })
                    .collect::<Vec<ReceiptSearchResult>>(),
            )
        })
        .await
}

/// Resolve token price at execution time from the stored minute series
/// (nearest sample at or before the timestamp); null when the token is
/// unknown or the timestamp predates stored samples.
#[tracing::instrument(
    level = "info",
    skip_all,
    fields(step = "price_lookup", asset_contract = tracing::field::Empty)
)]
pub async fn get_token_price_at_timestamp(
    State(state): State<Arc<AppState>>,
    Query(params): Query<TokenPriceAtTimestampQuery>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, String)> {
    tracing::Span::current().record("asset_contract", tracing::field::display(&params.token_id));

    let timestamp = DateTime::parse_from_rfc3339(&params.timestamp)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "Invalid timestamp, expected ISO-8601 timestamp".to_string(),
            )
        })?;

    let cache_key = CacheKey::new("token-price-at-timestamp")
        .with(&params.token_id)
        .with(timestamp.timestamp())
        .build();

    let token_id = params.token_id.clone();
    let state_for_lookup = state.clone();

    state
        .cache
        .cached_json(CacheTier::LongTerm, cache_key, async move {
            match state_for_lookup
                .token_price_service
                .price_at(&token_id, timestamp)
                .await
            {
                Ok(Some(price)) => {
                    use bigdecimal::ToPrimitive;
                    Ok::<_, (StatusCode, String)>(Some(TokenPriceAtTimestampResponse {
                        price_usd: price.to_f64(),
                        source: "token_prices".to_string(),
                    }))
                }
                Ok(None) => Ok::<_, (StatusCode, String)>(None::<TokenPriceAtTimestampResponse>),
                Err(e) => {
                    tracing::warn!(
                        "Failed to resolve receipt token price for {}: {}",
                        token_id,
                        e
                    );
                    Ok::<_, (StatusCode, String)>(None::<TokenPriceAtTimestampResponse>)
                }
            }
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_v3_receipts_page() {
        let page: NearBlocksPage<NearBlocksReceipt> = serde_json::from_value(json!({
            "data": [{
                "actions": [{ "action": "FUNCTION_CALL", "method": "act_proposal" }],
                "block": {
                    "block_hash": "HMj3hWgPx3eyG8XNmwTY46BtYy7SzDAXSzKhzinKtfeM",
                    "block_height": "223958752",
                    "block_timestamp": "1794338199755854976"
                },
                "receipt_id": "7f7k2NtR72toTRJM2UkgGkXYppWoxXgjCFuD5z87FM8m",
                "transaction_hash": "6FGgz5FHn3jokoUuKFUXJPoa6uYWYHZMqpekydDvoN2k"
            }],
            "meta": { "next_page": "eyJpbmRleCI6Mn0=" }
        }))
        .unwrap();

        assert_eq!(page.data[0].block.block_height, 223958752);
        assert_eq!(page.data[0].block.block_timestamp, 1794338199755854976);
        assert_eq!(page.meta.unwrap().next_page.unwrap(), "eyJpbmRleCI6Mn0=");

        let last: NearBlocksPage<NearBlocksReceipt> =
            serde_json::from_value(json!({ "data": [] })).unwrap();
        assert!(last.meta.is_none());
    }

    #[test]
    fn matches_proposal_receipt_in_v3_tree() {
        let tree: NearBlocksItem<NearBlocksReceiptNode> = serde_json::from_value(json!({
            "data": {
                "receipt_id": "root",
                "actions": [{ "action": "DELEGATE_ACTION", "method": null, "args": { "nonce": 1 } }],
                "receipts": [{
                    "receipt_id": "vote",
                    "actions": [{
                        "action": "FUNCTION_CALL",
                        "method": "act_proposal",
                        "args": {
                            "args_json": { "id": 750, "action": "VoteApprove" },
                            "args_base64": null,
                            "method_name": "act_proposal"
                        }
                    }],
                    "receipts": [{
                        "receipt_id": "callback",
                        "actions": [{
                            "action": "FUNCTION_CALL",
                            "method": "on_proposal_callback",
                            "args": { "args_json": { "proposal_id": 750 } }
                        }],
                        "receipts": []
                    }]
                }]
            }
        }))
        .unwrap();

        assert!(receipt_matches(&tree.data, "vote", 750, "VoteApprove"));
        assert!(receipt_matches(&tree.data, "callback", 750, "VoteApprove"));
        assert!(!receipt_matches(&tree.data, "vote", 750, "VoteReject"));
        assert!(!receipt_matches(&tree.data, "vote", 751, "VoteApprove"));
        assert!(!receipt_matches(&tree.data, "root", 750, "VoteApprove"));
        assert!(!receipt_matches(&tree.data, "missing", 750, "VoteApprove"));
    }
}

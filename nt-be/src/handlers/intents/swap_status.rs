use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

use crate::{
    AppState,
    handlers::public_history::{
        confidential_list::is_confidential_dao,
        proposals::quote_refresher::record_settled_quote_status,
    },
    utils::cache::{CacheKey, CacheTier},
};

#[derive(Debug, Deserialize)]
pub struct SwapStatusQuery {
    #[serde(rename = "depositAddress")]
    pub deposit_address: String,
    #[serde(rename = "depositMemo")]
    pub deposit_memo: Option<String>,
    /// Treasury account id. Confidential treasuries read status from bronze;
    /// others fall through to 1Click `/v0/status`.
    #[serde(rename = "daoId")]
    pub dao_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct QuoteByDepositAddressQuery {
    #[serde(rename = "depositAddress")]
    pub deposit_address: String,
    #[serde(rename = "depositMemo")]
    pub deposit_memo: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SwapStatus {
    KnownDepositTx,
    PendingDeposit,
    IncompleteDeposit,
    Processing,
    Success,
    Refunded,
    Failed,
}

impl SwapStatus {
    /// Parse a raw 1Click status string (any case). Unknown values are still
    /// in flight from the treasury's point of view, so they read as
    /// `Processing`.
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_uppercase().as_str() {
            "SUCCESS" => SwapStatus::Success,
            "REFUNDED" => SwapStatus::Refunded,
            "FAILED" => SwapStatus::Failed,
            "PENDING_DEPOSIT" => SwapStatus::PendingDeposit,
            "INCOMPLETE_DEPOSIT" => SwapStatus::IncompleteDeposit,
            "KNOWN_DEPOSIT_TX" => SwapStatus::KnownDepositTx,
            _ => SwapStatus::Processing,
        }
    }

    /// The swap ended without delivering: the request's funds were (or will
    /// be) returned, so an approved request that paid for it shows as failed.
    pub fn is_failed(self) -> bool {
        matches!(self, SwapStatus::Failed | SwapStatus::Refunded)
    }

    /// 1Click will not move the swap past this status.
    pub fn is_terminal(self) -> bool {
        self.is_failed() || self == SwapStatus::Success
    }
}

/// Outcome of a confidential swap from the two places that record it: the
/// latest 1Click history row for the deposit address and the intent row the
/// submit queue owns. A settled 1Click status is the final word. Otherwise an
/// intent the queue retired (`confidential_intents.status = 'failed'`: never
/// handed to 1Click before its deadline, or rejected by it) reads as `Failed`
/// even though 1Click still lists the untouched quote as `PENDING_DEPOSIT`.
/// `None` when nothing is on record yet.
pub fn resolve_confidential_swap_status(
    history_status: Option<&str>,
    intent_failed: bool,
) -> Option<SwapStatus> {
    match history_status.map(SwapStatus::parse) {
        Some(status) if status.is_terminal() => Some(status),
        _ if intent_failed => Some(SwapStatus::Failed),
        history => history,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SimplifiedSwapStatusResponse {
    pub status: SwapStatus,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct QuoteByDepositAddressResponse {
    /// `swapDetails` only: the on-chain deposit 1Click observed. Absent until
    /// the deposit tx is known, and never set on the quote itself.
    #[serde(
        rename = "depositedAmountFormatted",
        skip_serializing_if = "Option::is_none"
    )]
    pub deposited_amount_formatted: Option<String>,
    #[serde(rename = "amountInFormatted")]
    pub amount_in_formatted: Option<String>,
    #[serde(rename = "amountOutFormatted")]
    pub amount_out_formatted: Option<String>,
    #[serde(rename = "amountInUsd")]
    pub amount_in_usd: Option<String>,
    #[serde(rename = "amountOutUsd")]
    pub amount_out_usd: Option<String>,
    #[serde(rename = "amountIn")]
    pub amount_in: Option<String>,
    #[serde(rename = "amountOut")]
    pub amount_out: Option<String>,
    #[serde(rename = "intentHashes")]
    pub intent_hashes: Option<Vec<String>>,
    #[serde(rename = "nearTxHashes")]
    pub near_tx_hashes: Option<Vec<String>>,
    #[serde(rename = "originChainTxHashes")]
    pub origin_chain_tx_hashes: Option<Vec<serde_json::Value>>,
    #[serde(rename = "destinationChainTxHashes")]
    pub destination_chain_tx_hashes: Option<Vec<serde_json::Value>>,
}

pub type QuoteData = QuoteByDepositAddressResponse;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FullSwapStatusResponse {
    #[serde(rename = "correlationId")]
    pub correlation_id: Option<String>,
    pub status: SwapStatus,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "quoteResponse")]
    pub quote_response: Option<QuoteEnvelope>,
    #[serde(rename = "swapDetails")]
    pub swap_details: Option<QuoteData>,
    #[serde(flatten)]
    pub _other: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuoteEnvelope {
    pub quote: Option<QuoteData>,
    #[serde(rename = "quoteRequest")]
    pub quote_request: Option<serde_json::Value>,
    #[serde(flatten)]
    pub _other: serde_json::Value,
}

/// Fetch swap status for a public (non-confidential) treasury from the 1Click
/// `/v0/status` endpoint.
pub async fn fetch_public_swap_status(
    http_client: &Client,
    oneclick_api_url: &str,
    oneclick_jwt_token: Option<&String>,
    deposit_address: &str,
    deposit_memo: Option<&str>,
) -> Result<FullSwapStatusResponse, (StatusCode, String)> {
    let url = format!("{}/v0/status", oneclick_api_url.trim_end_matches('/'));
    let mut request = http_client
        .get(&url)
        .query(&[("depositAddress", deposit_address)])
        .timeout(Duration::from_secs(15));

    if let Some(memo) = deposit_memo {
        request = request.query(&[("depositMemo", memo)]);
    }

    if let Some(jwt_token) = oneclick_jwt_token {
        request = request.header("Authorization", format!("Bearer {}", jwt_token));
    }

    let response = request.send().await.map_err(|e| {
        tracing::error!("Error fetching 1Click status: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to fetch 1Click status: {}", e),
        )
    })?;

    let status_code = response.status();
    if !status_code.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        tracing::error!("1Click API error ({}): {}", status_code, error_text);
        return Err((
            StatusCode::from_u16(status_code.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            format!("1Click API error: {}", error_text),
        ));
    }

    response
        .json::<FullSwapStatusResponse>()
        .await
        .map_err(|e| {
            tracing::error!("Error parsing 1Click status response: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to parse 1Click status response: {}", e),
            )
        })
}

pub fn extract_quote_data(full_response: &FullSwapStatusResponse) -> Option<QuoteData> {
    full_response
        .quote_response
        .as_ref()
        .and_then(|quote_response| quote_response.quote.clone())
}

#[derive(sqlx::FromRow)]
struct ConfidentialSwapStatusRow {
    history_status: Option<String>,
    history_at: Option<chrono::DateTime<chrono::Utc>>,
    intent_failed: bool,
    intent_updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Read confidential swap status from our own store: the latest bronze row
/// for the deposit address and the intent row the submit queue may have
/// retired (see [`resolve_confidential_swap_status`]). `None` means nothing
/// is on record yet.
pub async fn fetch_confidential_swap_status(
    pool: &sqlx::PgPool,
    dao_id: &str,
    deposit_address: &str,
) -> Result<Option<SimplifiedSwapStatusResponse>, (StatusCode, String)> {
    let row = sqlx::query_as::<_, ConfidentialSwapStatusRow>(
        r#"
        SELECT he.status AS history_status,
               he.created_at_external AS history_at,
               COALESCE(ci.status = 'failed', FALSE) AS intent_failed,
               ci.updated_at AS intent_updated_at
        FROM (SELECT 1) AS lookup
        LEFT JOIN LATERAL (
            SELECT status, created_at_external
            FROM bronze_confidential_history_events
            WHERE account_id = $1
              AND deposit_address = $2
            ORDER BY created_at_external DESC
            LIMIT 1
        ) he ON TRUE
        LEFT JOIN LATERAL (
            SELECT status, updated_at
            FROM confidential_intents
            WHERE dao_id = $1
              AND deposit_address = $2
            ORDER BY id DESC
            LIMIT 1
        ) ci ON TRUE
        "#,
    )
    .bind(dao_id)
    .bind(deposit_address)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!("confidential swap status query failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to load confidential swap status: {}", e),
        )
    })?;

    let history = row.history_status.as_deref().map(SwapStatus::parse);
    Ok(
        resolve_confidential_swap_status(row.history_status.as_deref(), row.intent_failed).map(
            |status| {
                // A status taken from 1Click carries 1Click's time; one derived
                // from the retired intent carries the time it was retired.
                let updated_at = if history == Some(status) {
                    row.history_at
                } else {
                    row.intent_updated_at.or(row.history_at)
                };
                SimplifiedSwapStatusResponse {
                    status,
                    updated_at: updated_at.unwrap_or_else(chrono::Utc::now).to_rfc3339(),
                }
            },
        ),
    )
}

pub async fn get_swap_status(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SwapStatusQuery>,
) -> Result<Json<SimplifiedSwapStatusResponse>, (StatusCode, String)> {
    let deposit_address = query.deposit_address;
    let deposit_memo = query.deposit_memo;
    let dao_id = query.dao_id;

    let cache_key = CacheKey::new("swap-status")
        .with(&deposit_address)
        .with(deposit_memo.clone().unwrap_or_default())
        .with(dao_id.clone().unwrap_or_default())
        .build();

    let http_client = state.http_client.clone();
    let oneclick_jwt_token = state.env_vars.oneclick_jwt_token.clone();
    let oneclick_api_url = state.env_vars.oneclick_api_url.clone();
    let db_pool = state.db_pool.clone();

    let result = state
        .cache
        .cached(CacheTier::ShortTerm, cache_key, async move {
            // Resolve the confidential treasury id up front so the two status
            // sources read as equal-level alternatives below (confidential
            // treasuries read from our own store; public ones hit 1Click).
            let confidential_dao_id = match dao_id.as_deref() {
                Some(dao_id)
                    if is_confidential_dao(&db_pool, dao_id).await.map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Failed to check confidential treasury: {}", e),
                        )
                    })? =>
                {
                    Some(dao_id.to_string())
                }
                _ => None,
            };

            if let Some(dao_id) = confidential_dao_id {
                // Not ingested yet → PROCESSING so the UI shows a pending state
                // rather than nothing.
                Ok::<_, (StatusCode, String)>(
                    fetch_confidential_swap_status(&db_pool, &dao_id, &deposit_address)
                        .await?
                        .unwrap_or_else(|| SimplifiedSwapStatusResponse {
                            status: SwapStatus::Processing,
                            updated_at: chrono::Utc::now().to_rfc3339(),
                        }),
                )
            } else {
                let full_response = fetch_public_swap_status(
                    &http_client,
                    &oneclick_api_url,
                    oneclick_jwt_token.as_ref(),
                    &deposit_address,
                    deposit_memo.as_deref(),
                )
                .await?;

                // The quote refresher stops covering a proposal after 30 days;
                // a viewer opening a stale one is the refresh path left, so
                // a settled answer is stored for every later list load.
                if let Some(dao_id) = dao_id.as_deref()
                    && let Err(e) = record_settled_quote_status(
                        &db_pool,
                        dao_id,
                        &deposit_address,
                        &full_response,
                    )
                    .await
                {
                    tracing::warn!(
                        dao_id,
                        deposit_address,
                        "failed to record settled swap status: {}",
                        e
                    );
                }

                Ok::<_, (StatusCode, String)>(SimplifiedSwapStatusResponse {
                    status: full_response.status,
                    updated_at: full_response.updated_at,
                })
            }
        })
        .await?;

    Ok(Json(result))
}

pub async fn get_quote_by_deposit_address(
    State(state): State<Arc<AppState>>,
    Query(query): Query<QuoteByDepositAddressQuery>,
) -> Result<Json<QuoteByDepositAddressResponse>, (StatusCode, String)> {
    let deposit_address = query.deposit_address;
    let deposit_memo = query.deposit_memo;

    let cache_key = CacheKey::new("quote-by-deposit-address")
        .with(&deposit_address)
        .with(deposit_memo.clone().unwrap_or_default())
        .build();

    let http_client = state.http_client.clone();
    let oneclick_jwt_token = state.env_vars.oneclick_jwt_token.clone();
    let oneclick_api_url = state.env_vars.oneclick_api_url.clone();

    let result = state
        .cache
        .cached(CacheTier::ShortTerm, cache_key, async move {
            let full_response = fetch_public_swap_status(
                &http_client,
                &oneclick_api_url,
                oneclick_jwt_token.as_ref(),
                &deposit_address,
                deposit_memo.as_deref(),
            )
            .await?;

            if let Some(quote_data) = extract_quote_data(&full_response) {
                return Ok::<_, (StatusCode, String)>(quote_data);
            }

            Ok::<_, (StatusCode, String)>(QuoteByDepositAddressResponse::default())
        })
        .await?;

    Ok(Json(result))
}

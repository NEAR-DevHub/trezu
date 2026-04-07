//! Confidential shield quote endpoint.
//!
//! Separate from the regular swap quote — requires DAO membership auth,
//! uses the 1Click test API with API key and DAO JWT.

use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

use crate::{AppState, auth::AuthUser};

/// Quote request for confidential shield operations.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConfidentialQuoteRequest {
    pub dao_id: String,
    #[serde(default)]
    pub dry: Option<bool>,
    pub swap_type: Option<String>,
    pub slippage_tolerance: Option<u32>,
    pub origin_asset: String,
    pub destination_asset: String,
    pub amount: String,
    pub deadline: String,
    pub quote_waiting_time_ms: Option<u32>,
}

/// POST /api/intents/confidential-quote
///
/// Requires authentication and DAO membership.
/// Proxies to the 1Click test API with DAO JWT and API key.
pub async fn get_confidential_quote(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(request): Json<ConfidentialQuoteRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    auth_user
        .verify_dao_member(&state.db_pool, &request.dao_id)
        .await
        .map_err(|e| (StatusCode::FORBIDDEN, format!("Not a DAO member: {}", e)))?;

    let access_token = super::authenticate::refresh_dao_jwt(&state, &request.dao_id).await?;

    let url = format!("{}/v0/quote", state.env_vars.confidential_api_url);

    let body = serde_json::json!({
        "dry": request.dry,
        "swapType": request.swap_type,
        "slippageTolerance": request.slippage_tolerance,
        "originAsset": request.origin_asset,
        "depositType": "INTENTS",
        "destinationAsset": request.destination_asset,
        "amount": request.amount,
        "refundTo": request.dao_id,
        "refundType": "CONFIDENTIAL_INTENTS",
        "recipient": request.dao_id,
        "recipientType": "CONFIDENTIAL_INTENTS",
        "deadline": request.deadline,
        "quoteWaitingTimeMs": request.quote_waiting_time_ms,
    });

    let mut req = state
        .http_client
        .post(&url)
        .header("content-type", "application/json")
        .header("Authorization", format!("Bearer {}", access_token));

    if let Some(api_key) = &state.env_vars.oneclick_api_key {
        req = req.header("x-api-key", api_key);
    }

    let response = req.json(&body).send().await.map_err(|e| {
        log::error!("Error calling 1Click confidential quote API: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to get quote: {}", e),
        )
    })?;

    let status = response.status();
    let response_body: Value = response.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to parse quote response: {}", e),
        )
    })?;

    if !status.is_success() {
        let error_message = response_body
            .get("error")
            .or_else(|| response_body.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error from 1Click API");

        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            error_message.to_string(),
        ));
    }

    Ok(Json(response_body))
}

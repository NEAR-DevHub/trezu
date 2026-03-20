use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

use crate::AppState;

use super::authenticate::refresh_dao_jwt;

/// Query parameters for fetching confidential balances.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BalancesQuery {
    /// The DAO account ID to fetch balances for
    pub dao_id: String,
    /// Optional comma-separated list of token IDs to filter
    pub token_ids: Option<String>,
}

/// Fetch confidential balances for a DAO from the 1Click API.
/// Requires a stored JWT token (from a prior authenticate call).
///
/// GET /api/intents/balances?daoId=mydao.sputnik-dao.near
pub async fn get_balances(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BalancesQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    // Get or refresh the JWT for this DAO
    let access_token = refresh_dao_jwt(&state, &query.dao_id).await?;

    let mut url = format!("{}/v0/account/balances", state.env_vars.oneclick_api_url);

    if let Some(token_ids) = &query.token_ids {
        url.push_str(&format!("?tokenIds={}", token_ids));
    }

    let response = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| {
            log::error!("Error fetching confidential balances for {}: {}", query.dao_id, e);
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to fetch balances: {}", e),
            )
        })?;

    let status = response.status();
    let response_body: Value = response.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to parse balances response: {}", e),
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

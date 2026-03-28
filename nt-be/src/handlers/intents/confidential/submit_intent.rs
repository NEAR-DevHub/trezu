use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

use crate::{AppState, auth::AuthUser};

/// Request body for submitting a signed intent to the 1Click API.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubmitIntentRequest {
    /// "swap_transfer"
    pub r#type: String,
    /// The signed intent data (standard-specific: NEP-413, ERC-191, etc.)
    pub signed_data: Value,
    /// The DAO account ID — used for membership verification
    pub dao_id: String,
}

/// Proxy endpoint for 1Click API submit-intent.
/// Submits a signed intent for execution.
///
/// POST /api/confidential-intents/submit-intent
pub async fn submit_intent(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(request): Json<SubmitIntentRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    auth_user
        .verify_dao_member(&state.db_pool, &request.dao_id)
        .await
        .map_err(|e| (StatusCode::FORBIDDEN, format!("Not a DAO member: {}", e)))?;

    let url = format!("{}/v0/submit-intent", state.env_vars.confidential_api_url);

    let body = serde_json::json!({
        "type": request.r#type,
        "signedData": request.signed_data,
    });

    let mut req = state
        .http_client
        .post(&url)
        .header("content-type", "application/json");
    if let Some(api_key) = super::config::oneclick_api_key() {
        req = req.header("x-api-key", api_key);
    }
    let response = req.json(&body).send().await.map_err(|e| {
        log::error!("Error calling 1Click submit-intent API: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to submit intent: {}", e),
        )
    })?;

    let status = response.status();
    let response_body: Value = response.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to parse submit-intent response: {}", e),
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

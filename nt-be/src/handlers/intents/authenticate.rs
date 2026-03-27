use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;

/// Request body for authenticating a DAO with the 1Click confidential intents API.
/// The signed data is a NEP-413 signature over an empty-intents auth payload,
/// produced by v1.signer (MPC chain-signatures) on behalf of the DAO.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticateRequest {
    /// The DAO account ID (e.g., "mydao.sputnik-dao.near")
    pub dao_id: String,
    /// The signed authentication data
    pub signed_data: serde_json::Value,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct AuthenticateResponse {
    access_token: String,
    refresh_token: String,
    /// Access token lifetime in seconds
    expires_in: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticateResult {
    pub success: bool,
    pub dao_id: String,
    pub expires_in: i64,
}

/// Authenticate a DAO with the 1Click confidential intents API.
/// Exchanges a signed auth payload for JWT tokens, stored per-DAO in monitored_accounts.
///
/// POST /api/intents/authenticate
pub async fn authenticate(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AuthenticateRequest>,
) -> Result<Json<AuthenticateResult>, (StatusCode, String)> {
    let url = format!("{}/v0/auth/authenticate", super::constants::CONFIDENTIAL_API_URL);

    let mut req = state
        .http_client
        .post(&url)
        .header("content-type", "application/json");
    if let Some(api_key) = super::constants::oneclick_api_key() {
        req = req.header("x-api-key", api_key);
    }
    let response = req
        .json(&request.signed_data)
        .send()
        .await
        .map_err(|e| {
            log::error!("Error calling 1Click auth API: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to authenticate with 1Click API: {}", e),
            )
        })?;

    let status = response.status();
    let body_text = response.text().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to read auth response: {}", e),
        )
    })?;

    if !status.is_success() {
        log::error!("1Click auth error ({}): {}", status, body_text);
        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            format!("Authentication failed: {}", body_text),
        ));
    }

    let auth_response: AuthenticateResponse =
        serde_json::from_str(&body_text).map_err(|e| {
            log::error!("Failed to parse auth response: {} body: {}", e, body_text);
            (
                StatusCode::BAD_GATEWAY,
                "Failed to parse authentication response".to_string(),
            )
        })?;

    let expires_at =
        chrono::Utc::now() + chrono::Duration::seconds(auth_response.expires_in);

    // Store JWT tokens in monitored_accounts
    sqlx::query!(
        r#"
        UPDATE monitored_accounts
        SET confidential_access_token = $1,
            confidential_refresh_token = $2,
            confidential_token_expires_at = $3
        WHERE account_id = $4
        "#,
        auth_response.access_token,
        auth_response.refresh_token,
        expires_at,
        request.dao_id,
    )
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        log::error!("Failed to store JWT for DAO {}: {}", request.dao_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to store JWT tokens: {}", e),
        )
    })?;

    log::info!(
        "Stored confidential JWT for DAO {} (expires in {}s)",
        request.dao_id,
        auth_response.expires_in
    );

    Ok(Json(AuthenticateResult {
        success: true,
        dao_id: request.dao_id,
        expires_in: auth_response.expires_in,
    }))
}

/// Refresh the JWT access token for a DAO using its stored refresh token.
/// Called internally before making authenticated API calls.
pub async fn refresh_dao_jwt(
    state: &AppState,
    dao_id: &str,
) -> Result<String, (StatusCode, String)> {
    // Load tokens from DB
    let row = sqlx::query!(
        r#"
        SELECT confidential_access_token, confidential_refresh_token, confidential_token_expires_at
        FROM monitored_accounts
        WHERE account_id = $1
        "#,
        dao_id,
    )
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to load JWT for DAO {}: {}", dao_id, e),
        )
    })?;

    let row = row.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            format!("DAO {} not found in monitored_accounts", dao_id),
        )
    })?;

    let access_token = row.confidential_access_token.ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            format!("No confidential JWT stored for DAO {}", dao_id),
        )
    })?;

    let refresh_token = row.confidential_refresh_token.ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            format!("No confidential refresh token for DAO {}", dao_id),
        )
    })?;

    // If access token is still valid (more than 60s remaining), return it
    if let Some(expires_at) = row.confidential_token_expires_at {
        let remaining = expires_at.signed_duration_since(chrono::Utc::now());
        if remaining.num_seconds() > 60 {
            return Ok(access_token);
        }
    }

    // Refresh the token
    let url = format!("{}/v0/auth/refresh", super::constants::CONFIDENTIAL_API_URL);

    let mut req = state
        .http_client
        .post(&url)
        .header("content-type", "application/json");
    if let Some(api_key) = super::constants::oneclick_api_key() {
        req = req.header("x-api-key", api_key);
    }
    let response = req
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|e| {
            log::error!("Error refreshing JWT for DAO {}: {}", dao_id, e);
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to refresh JWT: {}", e),
            )
        })?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::error!(
            "JWT refresh failed for DAO {} ({}): {}",
            dao_id,
            status,
            error_text
        );
        // Clear stale tokens
        let _ = sqlx::query!(
            r#"
            UPDATE monitored_accounts
            SET confidential_access_token = NULL,
                confidential_refresh_token = NULL,
                confidential_token_expires_at = NULL
            WHERE account_id = $1
            "#,
            dao_id,
        )
        .execute(&state.db_pool)
        .await;

        return Err((
            StatusCode::UNAUTHORIZED,
            format!("JWT refresh failed for DAO {}: {}", dao_id, error_text),
        ));
    }

    let auth_response: AuthenticateResponse = response.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to parse refresh response: {}", e),
        )
    })?;

    let new_expires_at =
        chrono::Utc::now() + chrono::Duration::seconds(auth_response.expires_in);

    // Update stored tokens
    sqlx::query!(
        r#"
        UPDATE monitored_accounts
        SET confidential_access_token = $1,
            confidential_refresh_token = $2,
            confidential_token_expires_at = $3
        WHERE account_id = $4
        "#,
        auth_response.access_token,
        auth_response.refresh_token,
        new_expires_at,
        dao_id,
    )
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        log::error!("Failed to update JWT for DAO {}: {}", dao_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update JWT tokens: {}", e),
        )
    })?;

    log::info!("Refreshed confidential JWT for DAO {}", dao_id);
    Ok(auth_response.access_token)
}

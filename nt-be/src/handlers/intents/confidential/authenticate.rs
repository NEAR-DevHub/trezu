use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{AppState, auth::AuthUser};

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
/// POST /api/confidential-intents/authenticate
pub async fn authenticate(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(request): Json<AuthenticateRequest>,
) -> Result<Json<AuthenticateResult>, (StatusCode, String)> {
    // Verify the caller is a member of this DAO
    auth_user
        .verify_dao_member(&state.db_pool, &request.dao_id)
        .await
        .map_err(|e| (StatusCode::FORBIDDEN, format!("Not a DAO member: {}", e)))?;

    // Validate that dao_id matches signer_id in the signed NEP-413 payload
    validate_signer_id(&request)?;

    let url = format!(
        "{}/v0/auth/authenticate",
        state.env_vars.confidential_api_url
    );

    let mut req = state
        .http_client
        .post(&url)
        .header("content-type", "application/json");
    if let Some(api_key) = super::config::oneclick_api_key() {
        req = req.header("x-api-key", api_key);
    }
    let response = req.json(&request.signed_data).send().await.map_err(|e| {
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

    let auth_response: AuthenticateResponse = serde_json::from_str(&body_text).map_err(|e| {
        log::error!("Failed to parse auth response: {} body: {}", e, body_text);
        (
            StatusCode::BAD_GATEWAY,
            "Failed to parse authentication response".to_string(),
        )
    })?;

    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(auth_response.expires_in);

    // Store JWT tokens in monitored_accounts
    let result = sqlx::query!(
        r#"
        UPDATE monitored_accounts
        SET confidential_access_token = $1,
            confidential_token_expires_at = $2
        WHERE account_id = $3
        "#,
        auth_response.access_token,
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

    if result.rows_affected() == 0 {
        log::error!(
            "DAO {} not found in monitored_accounts — JWT not stored",
            request.dao_id
        );
        return Err((
            StatusCode::NOT_FOUND,
            format!("DAO {} is not a monitored account", request.dao_id),
        ));
    }

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
    let url = format!("{}/v0/auth/refresh", state.env_vars.confidential_api_url);

    let mut req = state
        .http_client
        .post(&url)
        .header("content-type", "application/json");
    if let Some(api_key) = super::config::oneclick_api_key() {
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

    let json_value: serde_json::Value = response.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to parse refresh response: {}", e),
        )
    })?;
    println!("json_value: {:?}", json_value);
    let auth_response: AuthenticateResponse = serde_json::from_value(json_value).map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to parse refresh response: {}", e),
        )
    })?;

    let new_expires_at = chrono::Utc::now() + chrono::Duration::seconds(auth_response.expires_in);

    // Update stored tokens
    sqlx::query!(
        r#"
        UPDATE monitored_accounts
        SET confidential_access_token = $1,
            confidential_token_expires_at = $2
        WHERE account_id = $3
        "#,
        auth_response.access_token,
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

/// Validate that the signer_id inside the NEP-413 signed payload matches the
/// requested dao_id. This prevents a caller from authenticating one DAO using
/// a signature produced for a different account.
fn validate_signer_id(request: &AuthenticateRequest) -> Result<(), (StatusCode, String)> {
    // signed_data structure: { signedData: { payload: { message: "<json>" } } }
    let message_str = request
        .signed_data
        .get("signedData")
        .and_then(|sd| sd.get("payload"))
        .and_then(|p| p.get("message"))
        .and_then(|m| m.as_str())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "Missing signedData.payload.message in signed_data".to_string(),
            )
        })?;

    let message: serde_json::Value = serde_json::from_str(message_str).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid JSON in NEP-413 message: {}", e),
        )
    })?;

    let signer_id = message
        .get("signer_id")
        .and_then(|s| s.as_str())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "Missing signer_id in NEP-413 message".to_string(),
            )
        })?;

    if signer_id != request.dao_id {
        return Err((
            StatusCode::FORBIDDEN,
            format!(
                "signer_id '{}' in signed payload does not match dao_id '{}'",
                signer_id, request.dao_id
            ),
        ));
    }

    Ok(())
}

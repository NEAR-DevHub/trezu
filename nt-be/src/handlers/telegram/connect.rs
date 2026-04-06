use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::sync::Arc;
use uuid::Uuid;

use crate::{AppState, auth::AuthUser};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenQuery {
    pub token: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaoIdQuery {
    pub dao_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedTreasury {
    pub dao_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInfoResponse {
    pub chat_id: i64,
    pub chat_title: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub connected_treasuries: Vec<ConnectedTreasury>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectTreasuriesRequest {
    pub token: Uuid,
    pub treasury_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectTreasuriesResponse {
    pub connected: bool,
    pub chat_id: i64,
    pub treasury_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramStatusResponse {
    pub dao_id: String,
    pub connected: bool,
    pub chat_id: Option<i64>,
    pub chat_title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectRequest {
    pub dao_id: String,
}

// ---------------------------------------------------------------------------
// Internal DB row types
// ---------------------------------------------------------------------------

#[derive(FromRow)]
struct TokenChatRow {
    chat_id: i64,
    chat_title: Option<String>,
    expires_at: DateTime<Utc>,
    used_at: Option<DateTime<Utc>>,
}

#[derive(FromRow)]
struct TokenOnlyRow {
    chat_id: i64,
    message_id: Option<i32>,
    expires_at: DateTime<Utc>,
    used_at: Option<DateTime<Utc>>,
}

#[derive(FromRow)]
struct StatusRow {
    chat_id: i64,
    chat_title: Option<String>,
}

// ---------------------------------------------------------------------------
// GET /api/telegram/connect?token=xxx
// ---------------------------------------------------------------------------

pub async fn get_chat_info(
    State(state): State<Arc<AppState>>,
    Query(params): Query<TokenQuery>,
) -> Result<Json<ChatInfoResponse>, (StatusCode, String)> {
    let row = sqlx::query_as::<_, TokenChatRow>(
        r#"
        SELECT t.chat_id, c.chat_title, t.expires_at, t.used_at
        FROM telegram_connect_tokens t
        JOIN telegram_chats c ON c.chat_id = t.chat_id
        WHERE t.token = $1
        "#,
    )
    .bind(params.token)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Token not found".to_string()))?;

    if row.expires_at < Utc::now() || row.used_at.is_some() {
        return Err((
            StatusCode::GONE,
            "Token expired or already used".to_string(),
        ));
    }

    let connected_treasuries = sqlx::query_scalar::<_, String>(
        "SELECT dao_id FROM telegram_treasury_connections WHERE chat_id = $1",
    )
    .bind(row.chat_id)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .into_iter()
    .map(|dao_id| ConnectedTreasury { dao_id })
    .collect();

    Ok(Json(ChatInfoResponse {
        chat_id: row.chat_id,
        chat_title: row.chat_title,
        expires_at: row.expires_at,
        connected_treasuries,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/telegram/connect
// ---------------------------------------------------------------------------

pub async fn connect_treasuries(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(body): Json<ConnectTreasuriesRequest>,
) -> Result<Json<ConnectTreasuriesResponse>, (StatusCode, String)> {
    if body.treasury_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "treasury_ids must not be empty".to_string(),
        ));
    }

    // Re-validate token
    let token_row = sqlx::query_as::<_, TokenOnlyRow>(
        "SELECT chat_id, message_id, expires_at, used_at FROM telegram_connect_tokens WHERE token = $1",
    )
    .bind(body.token)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Token not found".to_string()))?;

    if token_row.expires_at < Utc::now() || token_row.used_at.is_some() {
        return Err((
            StatusCode::GONE,
            "Token expired or already used".to_string(),
        ));
    }

    let chat_id = token_row.chat_id;

    // Look up the user's UUID for connected_by
    let user_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE account_id = $1")
        .bind(&auth_user.account_id)
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Verify policy membership for all requested treasuries
    for dao_id in &body.treasury_ids {
        auth_user
            .verify_dao_member(&state.db_pool, dao_id)
            .await
            .map_err(|_| {
                (
                    StatusCode::FORBIDDEN,
                    format!("Not a policy member of {}", dao_id),
                )
            })?;
    }

    // Run everything in a transaction
    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    for dao_id in &body.treasury_ids {
        sqlx::query(
            r#"
            INSERT INTO telegram_treasury_connections (dao_id, chat_id, connected_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (dao_id) DO UPDATE SET
                chat_id = EXCLUDED.chat_id,
                connected_by = EXCLUDED.connected_by,
                connected_at = now()
            "#,
        )
        .bind(dao_id)
        .bind(chat_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    sqlx::query("UPDATE telegram_connect_tokens SET used_at = now() WHERE token = $1")
        .bind(body.token)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Edit the original connect message with a success status (non-fatal)
    let n = body.treasury_ids.len();
    let msg = format!(
        "✓ {} {} connected by {}",
        n,
        if n == 1 { "treasury" } else { "treasuries" },
        auth_user.account_id
    );
    if let Some(message_id) = token_row.message_id {
        if let Err(e) = state
            .telegram_client
            .edit_message_text(chat_id, message_id, &msg)
            .await
        {
            log::warn!(
                "[telegram] Failed to edit or fallback-send connect message {} in chat {}: {}",
                message_id,
                chat_id,
                e
            );
        }
    } else {
        log::warn!(
            "[telegram] No connect message_id stored for token {}, skipping message edit in chat {}",
            body.token,
            chat_id
        );
        if let Err(send_err) = state
            .telegram_client
            .send_message_to_chat(chat_id, &msg)
            .await
        {
            log::warn!(
                "[telegram] Fallback send failed with missing message_id in chat {}: {}",
                chat_id,
                send_err
            );
        }
    }

    Ok(Json(ConnectTreasuriesResponse {
        connected: true,
        chat_id,
        treasury_ids: body.treasury_ids,
    }))
}

// ---------------------------------------------------------------------------
// GET /api/telegram/status?dao_id=xxx
// ---------------------------------------------------------------------------

pub async fn get_status(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    Query(params): Query<DaoIdQuery>,
) -> Result<Json<TelegramStatusResponse>, (StatusCode, String)> {
    let row = sqlx::query_as::<_, StatusRow>(
        r#"
        SELECT ttc.chat_id, tc.chat_title
        FROM telegram_treasury_connections ttc
        JOIN telegram_chats tc ON tc.chat_id = ttc.chat_id
        WHERE ttc.dao_id = $1
        "#,
    )
    .bind(&params.dao_id)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(match row {
        Some(r) => TelegramStatusResponse {
            dao_id: params.dao_id,
            connected: true,
            chat_id: Some(r.chat_id),
            chat_title: r.chat_title,
        },
        None => TelegramStatusResponse {
            dao_id: params.dao_id,
            connected: false,
            chat_id: None,
            chat_title: None,
        },
    }))
}

// ---------------------------------------------------------------------------
// DELETE /api/telegram/connect
// ---------------------------------------------------------------------------

pub async fn disconnect_treasury(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(body): Json<DisconnectRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    auth_user
        .verify_dao_member(&state.db_pool, &body.dao_id)
        .await
        .map_err(|_| (StatusCode::FORBIDDEN, "Not a policy member".to_string()))?;

    sqlx::query("DELETE FROM telegram_treasury_connections WHERE dao_id = $1")
        .bind(&body.dao_id)
        .execute(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

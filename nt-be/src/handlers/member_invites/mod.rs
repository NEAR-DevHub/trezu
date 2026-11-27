use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use near_api::AccountId;
use serde::{Deserialize, Serialize};
use sqlx::Postgres;
use std::sync::Arc;
use uuid::Uuid;

use crate::utils::url::api_url;
use crate::{
    AppState,
    auth::{AuthUser, OptionalAuthUser},
    handlers::treasury::config::fetch_treasury_config,
};

fn internal_error(context: &str, e: impl std::fmt::Display) -> (StatusCode, String) {
    tracing::error!("{context}: {e}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Internal server error".to_string(),
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInviteResponse {
    pub token: Uuid,
    pub url: String,
}

/// `POST /api/treasury/{dao_id}/member-invites` — create a one-time invite link.
#[tracing::instrument(level = "info", skip_all, fields(dao_id = %dao_id, user = %auth_user.account_id))]
pub async fn create_member_invite(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(dao_id): Path<AccountId>,
) -> Result<Json<CreateInviteResponse>, (StatusCode, String)> {
    auth_user
        .verify_dao_member_for_http(&state.db_pool, &dao_id)
        .await?;

    let created_by = sqlx::query_scalar!(
        "SELECT id FROM users WHERE account_id = $1",
        auth_user.account_id.as_str()
    )
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| internal_error("Failed to look up invite creator", e))?;

    let token = sqlx::query_scalar!(
        r#"
        INSERT INTO member_invite_links (dao_id, created_by)
        VALUES ($1, $2)
        RETURNING token
        "#,
        dao_id.as_str(),
        created_by
    )
    .fetch_one(&state.db_pool)
    .await
    .map_err(|e| internal_error("Failed to create member invite link", e))?;

    let url = api_url(&state.env_vars.frontend_base_url, &format!("join/{token}"))
        .map_err(|e| internal_error("Invalid FRONTEND_BASE_URL", e))?
        .to_string();

    Ok(Json(CreateInviteResponse { token, url }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InviteLinkStatus {
    Valid,
    Used,
    Expired,
    NotFound,
}

impl InviteLinkStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Valid => "valid",
            Self::Used => "used",
            Self::Expired => "expired",
            Self::NotFound => "not_found",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewerJoinStatus {
    None,
    Pending,
    Member,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteLinkInfoResponse {
    pub dao_id: AccountId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub treasury_name: Option<String>,
    pub status: InviteLinkStatus,
    /// Present when the request includes a valid session cookie.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer_status: Option<ViewerJoinStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyMemberJoinStatusResponse {
    pub status: ViewerJoinStatus,
}

async fn resolve_viewer_join_status(
    pool: &sqlx::PgPool,
    dao_id: &AccountId,
    account_id: &str,
) -> Result<ViewerJoinStatus, (StatusCode, String)> {
    let is_member = sqlx::query_scalar!(
        r#"
        SELECT 1 AS ok FROM dao_members
        WHERE dao_id = $1 AND account_id = $2 AND is_policy_member = true
        "#,
        dao_id.as_str(),
        account_id
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| internal_error("Failed to check DAO membership", e))?;

    if is_member.is_some() {
        return Ok(ViewerJoinStatus::Member);
    }

    let has_pending = sqlx::query_scalar!(
        r#"
        SELECT 1 AS ok FROM member_join_requests
        WHERE dao_id = $1 AND account_id = $2 AND status = 'pending'
        "#,
        dao_id.as_str(),
        account_id
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| internal_error("Failed to check pending join request", e))?;

    if has_pending.is_some() {
        return Ok(ViewerJoinStatus::Pending);
    }

    Ok(ViewerJoinStatus::None)
}

struct InviteLinkRow {
    dao_id: String,
    used_at: Option<DateTime<Utc>>,
    expires_at: DateTime<Utc>,
}

fn resolve_invite_status(row: &InviteLinkRow) -> InviteLinkStatus {
    if row.used_at.is_some() {
        InviteLinkStatus::Used
    } else if row.expires_at <= Utc::now() {
        InviteLinkStatus::Expired
    } else {
        InviteLinkStatus::Valid
    }
}

/// `GET /api/member-invites/{token}` — public invite link metadata.
#[tracing::instrument(level = "info", skip_all, fields(user = auth.0.as_ref().map(|u| u.account_id.as_str())))]
pub async fn get_member_invite(
    State(state): State<Arc<AppState>>,
    auth: OptionalAuthUser,
    Path(token): Path<Uuid>,
) -> Result<Json<InviteLinkInfoResponse>, (StatusCode, String)> {
    let row = sqlx::query_as!(
        InviteLinkRow,
        r#"
        SELECT dao_id, used_at, expires_at
        FROM member_invite_links
        WHERE token = $1
        "#,
        token
    )
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| internal_error("Failed to fetch member invite link", e))?;

    let Some(row) = row else {
        return Err((StatusCode::NOT_FOUND, "Invite link not found".to_string()));
    };

    let status = resolve_invite_status(&row);
    let dao_id: AccountId = row
        .dao_id
        .parse()
        .map_err(|e| internal_error("Invalid dao_id on invite link", e))?;

    let treasury_name = if status == InviteLinkStatus::Valid {
        let config = fetch_treasury_config(&state, &dao_id, None).await?;
        config.name
    } else {
        None
    };

    let viewer_status = if let Some(user) = auth.0.as_ref() {
        Some(resolve_viewer_join_status(&state.db_pool, &dao_id, user.account_id.as_str()).await?)
    } else {
        None
    };

    Ok(Json(InviteLinkInfoResponse {
        dao_id,
        treasury_name,
        status,
        viewer_status,
    }))
}

/// `GET /api/treasury/{dao_id}/member-join-requests/me` — requester's own join status.
#[tracing::instrument(level = "info", skip_all, fields(dao_id = %dao_id, user = %auth_user.account_id))]
pub async fn get_my_member_join_status(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(dao_id): Path<AccountId>,
) -> Result<Json<MyMemberJoinStatusResponse>, (StatusCode, String)> {
    let status =
        resolve_viewer_join_status(&state.db_pool, &dao_id, auth_user.account_id.as_str()).await?;
    Ok(Json(MyMemberJoinStatusResponse { status }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinViaInviteRequest {
    pub display_name: Option<String>,
    /// One of [`AGENT_AVATAR_PRESETS`]; sets the joiner's avatar to that
    /// built-in image so AI agents don't show up with the person placeholder.
    pub avatar_preset: Option<String>,
}

/// Built-in avatars an AI agent can pick when it joins through an invite.
/// Each is served by the frontend at `/avatars/agents/<preset>.svg`; keep in
/// sync with `nt-fe/public/avatars/agents` and the agent onboarding prompt.
pub const AGENT_AVATAR_PRESETS: &[&str] =
    &["agent", "chatgpt", "claude", "cursor", "gemini", "near-ai"];

/// Resolve an `avatarPreset` to the frontend URL stored in
/// `user_profiles.avatar_url`. Missing or blank → `None` (avatar untouched);
/// anything outside [`AGENT_AVATAR_PRESETS`] → 400.
fn agent_avatar_url(
    frontend_base_url: &str,
    preset: Option<&str>,
) -> Result<Option<String>, (StatusCode, String)> {
    let Some(preset) = preset.map(str::trim).filter(|p| !p.is_empty()) else {
        return Ok(None);
    };
    if !AGENT_AVATAR_PRESETS.contains(&preset) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "avatarPreset must be one of: {}",
                AGENT_AVATAR_PRESETS.join(", ")
            ),
        ));
    }
    let url = api_url(frontend_base_url, &format!("avatars/agents/{preset}.svg"))
        .map_err(|e| internal_error("Invalid FRONTEND_BASE_URL", e))?;
    Ok(Some(url.to_string()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinViaInviteResponse {
    pub dao_id: AccountId,
    pub request_id: Uuid,
}

/// Save the name and avatar the joiner chose. Fields left out keep whatever
/// the profile already has.
async fn upsert_join_profile(
    pool: &sqlx::PgPool,
    account_id: &str,
    display_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<(), (StatusCode, String)> {
    let display_name = display_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty());
    if display_name.is_none() && avatar_url.is_none() {
        return Ok(());
    }

    sqlx::query(
        r#"
        INSERT INTO user_profiles (account_id, display_name, avatar_url)
        VALUES ($1, $2, $3)
        ON CONFLICT (account_id) DO UPDATE
        SET display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
            avatar_url = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
            updated_at = NOW()
        "#,
    )
    .bind(account_id)
    .bind(display_name)
    .bind(avatar_url)
    .execute(pool)
    .await
    .map_err(|e| internal_error("Failed to upsert user profile", e))?;

    Ok(())
}

/// `POST /api/member-invites/{token}/join` — consume an invite and create a pending join request.
#[tracing::instrument(level = "info", skip_all, fields(user = %auth_user.account_id))]
pub async fn join_via_invite(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(token): Path<Uuid>,
    Json(body): Json<JoinViaInviteRequest>,
) -> Result<Json<JoinViaInviteResponse>, (StatusCode, String)> {
    let avatar_url = agent_avatar_url(
        &state.env_vars.frontend_base_url,
        body.avatar_preset.as_deref(),
    )?;

    // Profile upsert is idempotent and independent of invite consumption.
    upsert_join_profile(
        &state.db_pool,
        auth_user.account_id.as_str(),
        body.display_name,
        avatar_url,
    )
    .await?;

    let mut tx = state
        .db_pool
        .begin()
        .await
        .map_err(|e| internal_error("Failed to start join transaction", e))?;

    // Lock the invite row so concurrent joins for the same token serialize:
    // validate → insert join request → mark used happen atomically.
    let invite = sqlx::query_as!(
        InviteLinkRow,
        r#"
        SELECT dao_id, used_at, expires_at
        FROM member_invite_links
        WHERE token = $1
        FOR UPDATE
        "#,
        token
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| internal_error("Failed to fetch member invite link", e))?;

    let Some(invite) = invite else {
        return Err((StatusCode::NOT_FOUND, "Invite link not found".to_string()));
    };

    let status = resolve_invite_status(&invite);
    if status != InviteLinkStatus::Valid {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Invite link is {}", status.as_str()),
        ));
    }

    let dao_id: AccountId = invite
        .dao_id
        .parse()
        .map_err(|e| internal_error("Invalid dao_id on invite link", e))?;

    let already_member = sqlx::query_scalar!(
        r#"
        SELECT 1 AS ok FROM dao_members
        WHERE dao_id = $1 AND account_id = $2 AND is_policy_member = true
        "#,
        dao_id.as_str(),
        auth_user.account_id.as_str()
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| internal_error("Failed to check DAO membership", e))?;

    if already_member.is_some() {
        return Err((
            StatusCode::CONFLICT,
            "Account is already a treasury member".to_string(),
        ));
    }

    let pending_request = sqlx::query_scalar!(
        r#"
        SELECT 1 AS ok FROM member_join_requests
        WHERE dao_id = $1 AND account_id = $2 AND status = 'pending'
        "#,
        dao_id.as_str(),
        auth_user.account_id.as_str()
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| internal_error("Failed to check pending join request", e))?;

    if pending_request.is_some() {
        return Err((
            StatusCode::CONFLICT,
            "A pending join request already exists for this treasury".to_string(),
        ));
    }

    let request_id =
        create_pending_join_request(&mut tx, &dao_id, auth_user.account_id.as_str(), token).await?;

    mark_invite_used(&mut tx, token, auth_user.account_id.as_str()).await?;

    tx.commit()
        .await
        .map_err(|e| internal_error("Failed to commit join transaction", e))?;

    Ok(Json(JoinViaInviteResponse { dao_id, request_id }))
}

async fn create_pending_join_request(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    dao_id: &AccountId,
    account_id: &str,
    invite_token: Uuid,
) -> Result<Uuid, (StatusCode, String)> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO member_join_requests (dao_id, account_id, invite_token)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
        dao_id.as_str(),
        account_id,
        invite_token
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| {
        if e.as_database_error()
            .map(|db| db.is_unique_violation())
            .unwrap_or(false)
        {
            (
                StatusCode::CONFLICT,
                "Invite link was already used or a pending join request already exists".to_string(),
            )
        } else {
            internal_error("Failed to create join request", e)
        }
    })
}

async fn mark_invite_used(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    token: Uuid,
    account_id: &str,
) -> Result<(), (StatusCode, String)> {
    let updated = sqlx::query!(
        r#"
        UPDATE member_invite_links
        SET used_at = NOW(), used_by_account_id = $2
        WHERE token = $1 AND used_at IS NULL
        "#,
        token,
        account_id
    )
    .execute(&mut **tx)
    .await
    .map_err(|e| internal_error("Failed to mark invite link as used", e))?;

    if updated.rows_affected() == 0 {
        return Err((
            StatusCode::CONFLICT,
            "Invite link was already used".to_string(),
        ));
    }

    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberJoinRequestItem {
    pub id: Uuid,
    pub account_id: AccountId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// `GET /api/treasury/{dao_id}/member-join-requests` — list pending join requests.
#[tracing::instrument(level = "info", skip_all, fields(dao_id = %dao_id, user = %auth_user.account_id))]
pub async fn list_member_join_requests(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(dao_id): Path<AccountId>,
) -> Result<Json<Vec<MemberJoinRequestItem>>, (StatusCode, String)> {
    auth_user
        .verify_dao_member_for_http(&state.db_pool, &dao_id)
        .await?;

    let rows = sqlx::query!(
        r#"
        SELECT mjr.id, mjr.account_id, mjr.created_at, up.display_name
        FROM member_join_requests mjr
        LEFT JOIN user_profiles up ON up.account_id = mjr.account_id
        WHERE mjr.dao_id = $1 AND mjr.status = 'pending'
        ORDER BY mjr.created_at ASC
        "#,
        dao_id.as_str()
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| internal_error("Failed to list member join requests", e))?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(MemberJoinRequestItem {
            id: row.id,
            account_id: row
                .account_id
                .parse()
                .map_err(|e| internal_error("Invalid account_id on join request", e))?,
            display_name: row.display_name.filter(|n| !n.trim().is_empty()),
            created_at: row.created_at,
        });
    }

    Ok(Json(items))
}

/// `DELETE /api/treasury/{dao_id}/member-join-requests/{id}` — cancel a pending join request.
#[tracing::instrument(level = "info", skip_all, fields(dao_id = %dao_id, join_request_id = %id, user = %auth_user.account_id))]
pub async fn cancel_member_join_request(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path((dao_id, id)): Path<(AccountId, Uuid)>,
) -> Result<StatusCode, (StatusCode, String)> {
    auth_user
        .verify_dao_member_for_http(&state.db_pool, &dao_id)
        .await?;

    let updated = sqlx::query!(
        r#"
        UPDATE member_join_requests
        SET status = 'cancelled'
        WHERE id = $1 AND dao_id = $2 AND status = 'pending'
        "#,
        id,
        dao_id.as_str()
    )
    .execute(&state.db_pool)
    .await
    .map_err(|e| internal_error("Failed to cancel member join request", e))?;

    if updated.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "Pending join request not found".to_string(),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveMemberJoinRequestsRequest {
    pub request_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveMemberJoinRequestsResponse {
    pub approved_count: u64,
}

/// `POST /api/treasury/{dao_id}/member-join-requests/approve` — mark join requests approved.
#[tracing::instrument(level = "info", skip_all, fields(dao_id = %dao_id, requests = body.request_ids.len(), user = %auth_user.account_id))]
pub async fn approve_member_join_requests(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Path(dao_id): Path<AccountId>,
    Json(body): Json<ApproveMemberJoinRequestsRequest>,
) -> Result<Json<ApproveMemberJoinRequestsResponse>, (StatusCode, String)> {
    auth_user
        .verify_dao_member_for_http(&state.db_pool, &dao_id)
        .await?;

    if body.request_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "requestIds must not be empty".to_string(),
        ));
    }

    let updated = sqlx::query!(
        r#"
        UPDATE member_join_requests
        SET status = 'approved'
        WHERE dao_id = $1
          AND status = 'pending'
          AND id = ANY($2)
        "#,
        dao_id.as_str(),
        &body.request_ids
    )
    .execute(&state.db_pool)
    .await
    .map_err(|e| internal_error("Failed to approve member join requests", e))?;

    Ok(Json(ApproveMemberJoinRequestsResponse {
        approved_count: updated.rows_affected(),
    }))
}

#[cfg(test)]
mod avatar_preset_tests {
    use super::*;

    const BASE: &str = "https://trezu.app";

    #[test]
    fn agent_avatar_url_resolves_every_preset_to_a_frontend_svg() {
        for preset in AGENT_AVATAR_PRESETS {
            assert_eq!(
                agent_avatar_url(BASE, Some(preset)).unwrap(),
                Some(format!("{BASE}/avatars/agents/{preset}.svg"))
            );
        }
        assert_eq!(
            agent_avatar_url("https://trezu.app/", Some(" claude ")).unwrap(),
            Some("https://trezu.app/avatars/agents/claude.svg".to_string())
        );
    }

    #[test]
    fn agent_avatar_url_leaves_avatar_alone_without_a_preset() {
        assert_eq!(agent_avatar_url(BASE, None).unwrap(), None);
        assert_eq!(agent_avatar_url(BASE, Some("  ")).unwrap(), None);
    }

    #[test]
    fn agent_avatar_url_rejects_anything_outside_the_list() {
        for bad in [
            "Claude",
            "openai",
            "https://evil.example/a.svg",
            "../favicon",
            "claude.svg",
            "data:image/svg+xml,<svg/>",
        ] {
            let (status, message) = agent_avatar_url(BASE, Some(bad)).unwrap_err();
            assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
            assert!(message.contains("avatarPreset must be one of"), "{message}");
        }
    }
}

#[cfg(test)]
mod avatar_preset_integration_tests {
    use crate::{
        routes::create_routes,
        utils::test_utils::{issue_auth_cookie, response_text, test_state},
    };
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use sqlx::PgPool;
    use tower::ServiceExt;
    use uuid::Uuid;

    const DAO_ID: &str = "agents.sputnik-dao.near";
    const AGENT: &str = "my-agent.near";

    async fn seed_invite(pool: &PgPool) -> Uuid {
        sqlx::query(
            "INSERT INTO monitored_accounts (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING",
        )
        .bind(DAO_ID)
        .execute(pool)
        .await
        .expect("seed monitored account");
        let admin_id: Uuid =
            sqlx::query_scalar("INSERT INTO users (account_id) VALUES ('admin.near') RETURNING id")
                .fetch_one(pool)
                .await
                .expect("seed inviting admin");
        sqlx::query_scalar(
            "INSERT INTO member_invite_links (dao_id, created_by) VALUES ($1, $2) RETURNING token",
        )
        .bind(DAO_ID)
        .bind(admin_id)
        .fetch_one(pool)
        .await
        .expect("seed invite link")
    }

    async fn agent_cookie(pool: &PgPool) -> String {
        issue_auth_cookie(pool, &test_state(pool.clone()), AGENT).await
    }

    async fn join(pool: &PgPool, cookie: &str, token: Uuid, body: &str) -> (StatusCode, String) {
        let response = create_routes(test_state(pool.clone()))
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/member-invites/{token}/join"))
                    .header("content-type", "application/json")
                    .header("cookie", cookie)
                    .body(Body::from(body.to_string()))
                    .expect("build join request"),
            )
            .await
            .expect("join request completes");
        let status = response.status();
        (status, response_text(response).await)
    }

    async fn stored_profile(pool: &PgPool) -> Option<(Option<String>, Option<String>)> {
        sqlx::query_as("SELECT display_name, avatar_url FROM user_profiles WHERE account_id = $1")
            .bind(AGENT)
            .fetch_optional(pool)
            .await
            .expect("read profile")
    }

    #[sqlx::test]
    async fn join_with_avatar_preset_stores_the_preset_avatar(pool: PgPool) {
        let token = seed_invite(&pool).await;
        let cookie = agent_cookie(&pool).await;
        let (status, body) = join(
            &pool,
            &cookie,
            token,
            r#"{"displayName": "Claude", "avatarPreset": "claude"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");

        let (name, avatar) = stored_profile(&pool).await.expect("profile row");
        assert_eq!(name.as_deref(), Some("Claude"));
        let avatar = avatar.expect("avatar set");
        assert!(
            avatar.ends_with("/avatars/agents/claude.svg"),
            "unexpected avatar {avatar}"
        );
    }

    #[sqlx::test]
    async fn join_with_unknown_avatar_preset_is_rejected_before_anything_changes(pool: PgPool) {
        let token = seed_invite(&pool).await;
        let cookie = agent_cookie(&pool).await;
        let (status, body) = join(
            &pool,
            &cookie,
            token,
            r#"{"displayName": "Claude", "avatarPreset": "https://evil.example/a.svg"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(body.contains("avatarPreset must be one of"), "{body}");
        assert!(stored_profile(&pool).await.is_none(), "no profile written");

        // The invite is still usable after the rejected attempt.
        let (status, body) = join(&pool, &cookie, token, r#"{"avatarPreset": "agent"}"#).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let (name, avatar) = stored_profile(&pool).await.expect("profile row");
        assert_eq!(name, None);
        assert!(
            avatar
                .expect("avatar set")
                .ends_with("/avatars/agents/agent.svg")
        );
    }
}

use crate::AppState;
use crate::auth::{AuthError, jwt::hash_token, verify_jwt};
use axum::http::StatusCode;
use axum::{extract::FromRequestParts, http::request::Parts};
use axum_extra::extract::CookieJar;
use std::sync::Arc;

/// The name of the auth cookie
pub const AUTH_COOKIE_NAME: &str = "auth_token";

/// Authenticated user extracted from JWT cookie
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub account_id: String,
}

impl AuthUser {
    /// Verify this user is a policy member of the given DAO.
    ///
    /// Returns `AuthError::NotDaoMember` (403) if not found in `dao_members`
    /// with `is_policy_member = true`.
    pub async fn verify_dao_member(
        &self,
        db: &sqlx::PgPool,
        dao_id: &str,
    ) -> Result<(), AuthError> {
        let member = sqlx::query!(
            r#"
            SELECT 1 AS ok FROM dao_members
            WHERE account_id = $1 AND dao_id = $2 AND is_policy_member = true
            "#,
            self.account_id,
            dao_id
        )
        .fetch_optional(db)
        .await
        .map_err(|e| AuthError::DatabaseError(e.to_string()))?;

        member.map(|_| ()).ok_or(AuthError::NotDaoMember)
    }

    pub async fn verify_member_if_confidential(
        &self,
        db: &sqlx::PgPool,
        dao_id: &str,
    ) -> Result<bool, (StatusCode, String)> {
        OptionalAuthUser::verify_member_if_confidential(
            &OptionalAuthUser(Some(self.clone())),
            db,
            dao_id,
        )
        .await
    }
}

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        // Extract the cookie jar
        let jar = CookieJar::from_request_parts(parts, state)
            .await
            .map_err(|_| AuthError::MissingToken)?;

        // Get the auth token from cookie
        let token = jar
            .get(AUTH_COOKIE_NAME)
            .map(|c| c.value().to_string())
            .ok_or(AuthError::MissingToken)?;

        // Verify the JWT signature and expiry
        let claims = verify_jwt(&token, state.env_vars.jwt_secret.as_bytes())?;

        // Check if the session is still valid (not revoked)
        let token_hash = hash_token(&token);
        let session = sqlx::query!(
            r#"
            SELECT id FROM user_sessions 
            WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
            "#,
            token_hash
        )
        .fetch_optional(&state.db_pool)
        .await
        .map_err(|e| AuthError::DatabaseError(e.to_string()))?;

        if session.is_none() {
            return Err(AuthError::RevokedToken);
        }

        Ok(AuthUser {
            account_id: claims.sub,
        })
    }
}

/// Optional auth user - doesn't fail if no token is present
#[derive(Debug, Clone)]
pub struct OptionalAuthUser(pub Option<AuthUser>);

impl OptionalAuthUser {
    /// If the given account is a confidential treasury, verify that the caller
    /// is an authenticated DAO policy member.
    ///
    /// Returns `true` if the account is confidential, `false` otherwise.
    /// Fails with 401/403 when confidential but the caller is missing or not a member.
    pub async fn verify_member_if_confidential(
        &self,
        db: &sqlx::PgPool,
        dao_id: &str,
    ) -> Result<bool, (StatusCode, String)> {
        let row = sqlx::query!(
            r#"
            SELECT
                ma.is_confidential_account,
                dm.account_id AS "member_account_id?"
            FROM monitored_accounts ma
            LEFT JOIN dao_members dm
                ON dm.dao_id = ma.account_id
                AND dm.account_id = $2
                AND dm.is_policy_member = true
            WHERE ma.account_id = $1
            "#,
            dao_id,
            self.0.as_ref().map(|u| u.account_id.as_str()),
        )
        .fetch_optional(db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to check confidential status: {}", e),
            )
        })?;

        let is_confidential = row
            .as_ref()
            .and_then(|r| r.is_confidential_account)
            .unwrap_or(false);

        if !is_confidential {
            return Ok(false);
        }

        if self.0.is_none() {
            return Err((
                StatusCode::UNAUTHORIZED,
                "Authentication required for confidential treasury".to_string(),
            ));
        }

        if row.unwrap().member_account_id.is_none() {
            return Err((StatusCode::FORBIDDEN, "Not a DAO member".to_string()));
        }

        Ok(true)
    }
}

impl FromRequestParts<Arc<AppState>> for OptionalAuthUser {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        match AuthUser::from_request_parts(parts, state).await {
            Ok(user) => Ok(OptionalAuthUser(Some(user))),
            Err(_) => Ok(OptionalAuthUser(None)),
        }
    }
}

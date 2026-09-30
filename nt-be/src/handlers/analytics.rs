use axum::{
    Json,
    extract::State,
    http::{
        HeaderMap, StatusCode,
        header::{AUTHORIZATION, WWW_AUTHENTICATE},
    },
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, Utc};
use hmac::{Hmac, Mac};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::Sha256;
use std::sync::Arc;

use crate::AppState;

/// One row of the `kr_analytics_treasury_monthly` view.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TreasuryMonthlyRow {
    pub account_id: String,
    pub month_start: NaiveDate,
    pub month_end: NaiveDate,
    pub year: i32,
    pub month: i32,
    pub month_label: String,
    pub trezu_started_on: NaiveDate,
    pub age_months: i32,
    pub treasury_type: String,
    pub origin: String,
    pub plan_type: Option<String>,
    pub members: i64,
    pub aum_usd: Option<BigDecimal>,
    pub aum_snapshot_at: Option<DateTime<Utc>>,
    pub inflow_usd: BigDecimal,
    pub outflow_usd: BigDecimal,
    pub netflow_usd: BigDecimal,
    pub swap_volume_usd: BigDecimal,
    pub volume_usd: BigDecimal,
    pub utilization_ratio: Option<BigDecimal>,
    pub payments: i64,
    pub votes: i64,
    pub swaps: i64,
    pub batch_payments: i64,
    pub address_book_size: i64,
    pub exports: i64,
    pub gas_covered_transactions: i64,
    pub derived_swap_fee_revenue_usd: BigDecimal,
    pub last_activity_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct TreasuryMonthlyAnalyticsResponse {
    pub count: usize,
    /// `true` when confidential treasuries' `account_id` has been replaced by
    /// a stable pseudonym. Public treasuries are never masked.
    pub masked: bool,
    pub rows: Vec<TreasuryMonthlyRow>,
}

const BASIC_AUTH_REALM: &str = "Trezu Analytics";

/// Domain separation for the account pseudonym key so it can never collide
/// with any other HMAC derived from the JWT secret.
const ACCOUNT_MASK_LABEL: &[u8] = b"analytics-account-mask";
const ACCOUNT_MASK_HEX_LEN: usize = 8;
/// `treasury_type` value of rows whose `account_id` gets masked for admins.
const CONFIDENTIAL_TREASURY_TYPE: &str = "confidential";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalyticsRole {
    /// Sees every row with confidential treasury ids masked.
    Admin,
    /// Sees every row as stored.
    SuperAdmin,
}

/// Replaces the local part of an account id with a keyed, fixed-length hash
/// so distinct treasuries stay distinguishable (and stable across requests and
/// months) without the real name being recoverable. The suffix after the first
/// `.` is kept: `fresik-business.sputnik-dao.near` → `3f9a2c7b.sputnik-dao.near`.
pub struct AccountIdMasker {
    key: Vec<u8>,
}

impl AccountIdMasker {
    pub fn new(secret: &[u8]) -> Self {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts any key length");
        mac.update(ACCOUNT_MASK_LABEL);
        Self {
            key: mac.finalize().into_bytes().to_vec(),
        }
    }

    pub fn mask(&self, account_id: &str) -> String {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(&self.key).expect("HMAC accepts any key length");
        mac.update(account_id.as_bytes());
        let digest = hex::encode(mac.finalize().into_bytes());
        let local = &digest[..ACCOUNT_MASK_HEX_LEN];
        match account_id.split_once('.') {
            Some((_, suffix)) => format!("{local}.{suffix}"),
            None => local.to_string(),
        }
    }

    /// Masks `account_id` on confidential rows only (public treasuries are
    /// public on chain anyway) and re-sorts so the output order does not hint
    /// at the real ids.
    pub fn mask_rows(&self, rows: &mut [TreasuryMonthlyRow]) {
        for row in rows
            .iter_mut()
            .filter(|row| row.treasury_type == CONFIDENTIAL_TREASURY_TYPE)
        {
            row.account_id = self.mask(&row.account_id);
        }
        rows.sort_by(|a, b| {
            a.month_start
                .cmp(&b.month_start)
                .then_with(|| a.account_id.cmp(&b.account_id))
        });
    }
}

pub struct ApiError {
    status: StatusCode,
    headers: Option<Box<HeaderMap>>,
    body: Json<Value>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (self.status, self.body).into_response();
        if let Some(headers) = self.headers {
            response.headers_mut().extend(*headers);
        }
        response
    }
}

/// Validates the `Authorization` header and resolves the caller's role.
/// Basic-auth credentials in `ANALYTICS_SUPER_USERS` and the static
/// `ANALYTICS_API_KEY` (with or without a `Bearer ` prefix) are super admins;
/// credentials in `ANALYTICS_USERS` are admins. A username present in both
/// lists is a super admin. Fails closed when nothing is configured; 401
/// responses carry a `WWW-Authenticate: Basic` challenge so browsers show
/// their native login prompt.
fn require_analytics_auth(
    headers: &HeaderMap,
    users: &[crate::utils::admin_auth::AdminCredential],
    super_users: &[crate::utils::admin_auth::AdminCredential],
    api_key: Option<&str>,
) -> Result<AnalyticsRole, ApiError> {
    let unauthorized = || {
        let mut response_headers = HeaderMap::new();
        response_headers.insert(
            WWW_AUTHENTICATE,
            format!("Basic realm=\"{BASIC_AUTH_REALM}\"")
                .parse()
                .unwrap(),
        );
        ApiError {
            status: StatusCode::UNAUTHORIZED,
            headers: Some(Box::new(response_headers)),
            body: Json(json!({ "error": "unauthorized" })),
        }
    };

    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(unauthorized)?;

    if let Some(encoded) = authorization.strip_prefix("Basic ") {
        let credentials = STANDARD
            .decode(encoded)
            .ok()
            .and_then(|decoded| String::from_utf8(decoded).ok())
            .ok_or_else(unauthorized)?;
        let (username, password) = credentials.split_once(':').ok_or_else(unauthorized)?;
        // Evaluate both lists so timing does not reveal which one matched.
        let is_super =
            crate::utils::admin_auth::authenticate_admin(super_users, username, password).is_some();
        let is_admin =
            crate::utils::admin_auth::authenticate_admin(users, username, password).is_some();
        return if is_super {
            Ok(AnalyticsRole::SuperAdmin)
        } else if is_admin {
            Ok(AnalyticsRole::Admin)
        } else {
            Err(unauthorized())
        };
    }

    let expected = api_key.ok_or_else(unauthorized)?;
    let received = authorization
        .strip_prefix("Bearer ")
        .unwrap_or(authorization);
    if crate::utils::admin_auth::constant_time_eq(expected, received) {
        Ok(AnalyticsRole::SuperAdmin)
    } else {
        Err(unauthorized())
    }
}

/// GET /internal/api/analytics/treasury-monthly
///
/// Returns every row of the `kr_analytics_treasury_monthly` view. Admins
/// (`ANALYTICS_USERS`) get confidential treasuries' `account_id`
/// pseudonymised; super admins (`ANALYTICS_SUPER_USERS`, `ANALYTICS_API_KEY`)
/// get every row as stored.
pub async fn get_treasury_monthly(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<TreasuryMonthlyAnalyticsResponse>, ApiError> {
    let role = require_analytics_auth(
        &headers,
        &state.env_vars.analytics_users,
        &state.env_vars.analytics_super_users,
        state.env_vars.analytics_api_key.as_deref(),
    )?;

    let mut rows = sqlx::query_as::<_, TreasuryMonthlyRow>(
        r#"
        SELECT *
        FROM kr_analytics_treasury_monthly
        ORDER BY month_start, account_id
        "#,
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to load treasury monthly analytics: {e}");
        ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            headers: None,
            body: Json(json!({ "error": "Failed to load treasury analytics." })),
        }
    })?;

    let masked = role == AnalyticsRole::Admin;
    if masked {
        AccountIdMasker::new(state.env_vars.jwt_secret.as_bytes()).mask_rows(&mut rows);
    }

    Ok(Json(TreasuryMonthlyAnalyticsResponse {
        count: rows.len(),
        masked,
        rows,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::admin_auth::parse_admin_users;

    fn headers_with_authorization(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, value.parse().unwrap());
        headers
    }

    fn basic_header(username: &str, password: &str) -> String {
        format!(
            "Basic {}",
            STANDARD.encode(format!("{username}:{password}"))
        )
    }

    #[test]
    fn basic_admin_credentials_resolve_to_admin() {
        let users = parse_admin_users(Some("viewer:secret"));
        let headers = headers_with_authorization(&basic_header("viewer", "secret"));
        assert_eq!(
            require_analytics_auth(&headers, &users, &[], None).ok(),
            Some(AnalyticsRole::Admin)
        );
    }

    #[test]
    fn basic_super_credentials_resolve_to_super_admin() {
        let super_users = parse_admin_users(Some("lead:secret"));
        let headers = headers_with_authorization(&basic_header("lead", "secret"));
        assert_eq!(
            require_analytics_auth(&headers, &[], &super_users, None).ok(),
            Some(AnalyticsRole::SuperAdmin)
        );
    }

    #[test]
    fn user_in_both_lists_is_super_admin() {
        let users = parse_admin_users(Some("lead:secret"));
        let super_users = parse_admin_users(Some("lead:secret"));
        let headers = headers_with_authorization(&basic_header("lead", "secret"));
        assert_eq!(
            require_analytics_auth(&headers, &users, &super_users, None).ok(),
            Some(AnalyticsRole::SuperAdmin)
        );
    }

    #[test]
    fn rejects_wrong_basic_password() {
        let users = parse_admin_users(Some("viewer:secret"));
        let headers = headers_with_authorization(&basic_header("viewer", "wrong"));
        assert!(require_analytics_auth(&headers, &users, &users, None).is_err());
    }

    #[test]
    fn bearer_api_key_is_super_admin() {
        let headers = headers_with_authorization("Bearer key123");
        assert_eq!(
            require_analytics_auth(&headers, &[], &[], Some("key123")).ok(),
            Some(AnalyticsRole::SuperAdmin)
        );
    }

    #[test]
    fn missing_header_returns_basic_challenge() {
        let error =
            require_analytics_auth(&HeaderMap::new(), &[], &[], Some("key123")).unwrap_err();
        assert_eq!(error.status, StatusCode::UNAUTHORIZED);
        let response_headers = error.headers.unwrap();
        let challenge = response_headers.get(WWW_AUTHENTICATE).unwrap();
        assert_eq!(
            challenge.to_str().unwrap(),
            format!("Basic realm=\"{BASIC_AUTH_REALM}\"")
        );
    }

    #[test]
    fn fails_closed_when_nothing_configured() {
        let headers = headers_with_authorization(&basic_header("viewer", "secret"));
        assert!(require_analytics_auth(&headers, &[], &[], None).is_err());
        let headers = headers_with_authorization("Bearer key123");
        assert!(require_analytics_auth(&headers, &[], &[], None).is_err());
    }

    #[test]
    fn mask_replaces_local_part_and_keeps_suffix() {
        let masker = AccountIdMasker::new(b"secret");
        let masked = masker.mask("fresik-business.sputnik-dao.near");
        let (local, suffix) = masked.split_once('.').unwrap();
        assert_eq!(suffix, "sputnik-dao.near");
        assert_eq!(local.len(), ACCOUNT_MASK_HEX_LEN);
        assert!(local.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(!masked.contains("fresik"));
    }

    #[test]
    fn mask_handles_account_without_dot() {
        let masker = AccountIdMasker::new(b"secret");
        let masked = masker.mask("abc");
        assert_eq!(masked.len(), ACCOUNT_MASK_HEX_LEN);
        assert!(!masked.contains('.'));
    }

    #[test]
    fn mask_is_stable_and_distinct_per_account() {
        let masker = AccountIdMasker::new(b"secret");
        assert_eq!(masker.mask("a.near"), masker.mask("a.near"));
        assert_ne!(masker.mask("a.near"), masker.mask("b.near"));
        assert_ne!(
            masker.mask("fresik-business.sputnik-dao.near"),
            masker.mask("fabric-hostels.sputnik-dao.near")
        );
    }

    #[test]
    fn mask_depends_on_secret() {
        assert_ne!(
            AccountIdMasker::new(b"one").mask("a.near"),
            AccountIdMasker::new(b"two").mask("a.near")
        );
    }

    fn row(account_id: &str, treasury_type: &str, month_start: NaiveDate) -> TreasuryMonthlyRow {
        TreasuryMonthlyRow {
            account_id: account_id.to_string(),
            month_start,
            month_end: month_start,
            year: 2026,
            month: 1,
            month_label: "Jan 2026".to_string(),
            trezu_started_on: month_start,
            age_months: 0,
            treasury_type: treasury_type.to_string(),
            origin: "trezu_created".to_string(),
            plan_type: None,
            members: 0,
            aum_usd: None,
            aum_snapshot_at: None,
            inflow_usd: BigDecimal::from(0),
            outflow_usd: BigDecimal::from(0),
            netflow_usd: BigDecimal::from(0),
            swap_volume_usd: BigDecimal::from(0),
            volume_usd: BigDecimal::from(0),
            utilization_ratio: None,
            payments: 0,
            votes: 0,
            swaps: 0,
            batch_payments: 0,
            address_book_size: 0,
            exports: 0,
            gas_covered_transactions: 0,
            derived_swap_fee_revenue_usd: BigDecimal::from(0),
            last_activity_at: None,
        }
    }

    #[test]
    fn mask_rows_masks_only_confidential_rows_and_sorts() {
        let masker = AccountIdMasker::new(b"secret");
        let jan = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let feb = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap();
        let mut rows = vec![
            row("zeta.sputnik-dao.near", "confidential", feb),
            row("alpha.sputnik-dao.near", "public", jan),
            row("zeta.sputnik-dao.near", "confidential", jan),
        ];
        masker.mask_rows(&mut rows);

        let jan_rows: Vec<&str> = rows
            .iter()
            .filter(|r| r.month_start == jan)
            .map(|r| r.account_id.as_str())
            .collect();
        let masked_zeta = masker.mask("zeta.sputnik-dao.near");
        let mut expected_jan = vec!["alpha.sputnik-dao.near", masked_zeta.as_str()];
        expected_jan.sort();
        assert_eq!(jan_rows, expected_jan);

        assert_eq!(rows[2].month_start, feb);
        assert_eq!(rows[2].account_id, masked_zeta);
        assert_eq!(rows[2].treasury_type, "confidential");
    }
}

//! The landing page's "Request Early Access" form.
//!
//! Public and unauthenticated: the browser posts here rather than to Attio so
//! the API key stays server-side.

use std::num::NonZeroU32;
use std::sync::{Arc, LazyLock};

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter as Governor};
use serde::Deserialize;

use crate::{
    AppState,
    error_event::ErrorCode,
    services::attio::{AttioClient, Attribution, EarlyAccessLead},
    utils::rate_limiter::RateLimiter,
};

/// Someone filling the form in earnest may retype an address and try again;
/// past a handful a minute it is not a person applying for early access.
const PER_CLIENT_PER_MINUTE: u32 = 5;

/// The client key comes out of `X-Forwarded-For`, which the client itself
/// supplies, so the per-client bucket can be walked around by rotating the
/// header. This second, unkeyed bucket is the backstop: whatever the header
/// claims, it bounds what the endpoint can cost us in Attio calls overall.
const OVERALL_PER_MINUTE: u32 = 60;

static PER_CLIENT: LazyLock<DefaultKeyedRateLimiter<String>> = LazyLock::new(|| {
    Governor::keyed(Quota::per_minute(
        NonZeroU32::new(PER_CLIENT_PER_MINUTE).expect("the quota is a non-zero literal"),
    ))
});

static OVERALL: LazyLock<RateLimiter> = LazyLock::new(|| {
    RateLimiter::per_minute("early_access", OVERALL_PER_MINUTE, OVERALL_PER_MINUTE)
});

/// Mirrors the form, where Telegram is the only field a visitor may skip. The
/// required ones still arrive as `Option` so a missing key is reported as
/// "Company is required" rather than as an unreadable body.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarlyAccessRequest {
    pub name: String,
    pub company: String,
    pub email: String,
    pub telegram: Option<String>,
    pub business_type: Option<String>,
    pub referral_source: Option<String>,
    pub consent: bool,
    #[serde(default)]
    pub attribution: Attribution,
}

pub async fn submit_early_access(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<EarlyAccessRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Public, unauthenticated, and every accepted submission spends two Attio
    // calls, so the endpoint is worth throttling before it is worth parsing.
    // Keys stop being tracked once their bucket has refilled.
    PER_CLIENT.retain_recent();
    let throttled = PER_CLIENT.check_key(&client_key(&headers)).is_err() || !OVERALL.try_acquire();
    if throttled {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Too many requests. Please try again in a minute.".to_string(),
        ));
    }

    let lead = validate(payload).map_err(|message| (StatusCode::BAD_REQUEST, message))?;

    // Missing credentials drop every lead, so this fails loudly rather than
    // answering 2xx to a submission that went nowhere: the visitor is told to
    // try again, and the alert says whose problem it is.
    let Some(attio) = AttioClient::from_env(state.http_client.clone(), &state.env_vars) else {
        crate::error_event!(ErrorCode::AttioNotConfigured);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not record your request.".to_string(),
        ));
    };

    attio
        .capture_early_access_lead(&lead)
        .await
        .map_err(|error| {
            crate::error_event!(ErrorCode::AttioLeadSyncFailed, error = %error);
            (
                StatusCode::BAD_GATEWAY,
                "Could not record your request.".to_string(),
            )
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// The first hop of `X-Forwarded-For` is the address our proxy saw the request
/// come from. It is trivially spoofed, which is what [`OVERALL`] is for — it is
/// used here only to keep one abusive source from being everyone's problem.
/// Requests without the header share a single bucket.
fn client_key(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string()
}

/// Trims every field and drops the ones that came through empty, so the
/// difference between "skipped" and "typed spaces" never reaches Attio.
fn validate(payload: EarlyAccessRequest) -> Result<EarlyAccessLead, String> {
    if !payload.consent {
        return Err("Consent to the privacy policy is required".to_string());
    }

    let required = |label: &str, value: String| {
        let value = value.trim().to_string();
        if value.is_empty() {
            Err(format!("{label} is required"))
        } else {
            Ok(value)
        }
    };
    let optional = |value: Option<String>| {
        value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };

    let email = required("Email", payload.email)?;
    // Deliberately shallow: the browser already applied `type="email"`, and a
    // stricter rule here would only reject addresses that are in fact valid.
    if !email.contains('@') {
        return Err("Email is not valid".to_string());
    }

    Ok(EarlyAccessLead {
        name: required("Name", payload.name)?,
        company: required("Company", payload.company)?,
        email,
        telegram: optional(payload.telegram),
        business_type: required(
            "Vertical / type of business",
            payload.business_type.unwrap_or_default(),
        )?,
        referral_source: required(
            "How you heard about NEAR Business",
            payload.referral_source.unwrap_or_default(),
        )?,
        attribution: payload.attribution,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> EarlyAccessRequest {
        EarlyAccessRequest {
            name: " Ada ".to_string(),
            company: "Analytical Engines".to_string(),
            email: "ada@example.com".to_string(),
            telegram: Some("  ".to_string()),
            business_type: Some("Treasury".to_string()),
            referral_source: Some("Word of Mouth".to_string()),
            consent: true,
            attribution: Attribution::default(),
        }
    }

    #[test]
    fn the_client_key_is_the_first_forwarded_hop() {
        let key = |value: &str| {
            let mut headers = HeaderMap::new();
            headers.insert("x-forwarded-for", value.parse().expect("valid header"));
            client_key(&headers)
        };

        assert_eq!(key("203.0.113.7, 70.41.3.18"), "203.0.113.7");
        assert_eq!(key(" 203.0.113.7 "), "203.0.113.7");
        assert_eq!(key(""), "unknown");
        assert_eq!(client_key(&HeaderMap::new()), "unknown");
    }

    #[test]
    fn valid_submissions_are_trimmed() {
        let lead = validate(request()).expect("should be valid");

        assert_eq!(lead.name, "Ada");
        assert_eq!(lead.telegram, None);
    }

    #[test]
    fn consent_and_the_required_fields_are_enforced() {
        for (label, mutate) in [
            (
                "consent",
                (|r: &mut EarlyAccessRequest| r.consent = false) as fn(&mut _),
            ),
            ("name", |r| r.name = "   ".to_string()),
            ("company", |r| r.company = String::new()),
            ("email", |r| r.email = "ada.example.com".to_string()),
            ("business type", |r| r.business_type = None),
            ("referral source", |r| r.referral_source = None),
        ] {
            let mut payload = request();
            mutate(&mut payload);
            assert!(validate(payload).is_err(), "{label} should be rejected");
        }
    }
}

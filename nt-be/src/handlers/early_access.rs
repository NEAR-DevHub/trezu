//! The landing page's "Request Early Access" form.
//!
//! Public and unauthenticated: the browser posts here rather than to Attio so
//! the API key stays server-side.

use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;

use crate::{
    AppState,
    error_event::ErrorCode,
    services::attio::{AttioClient, Attribution, EarlyAccessLead},
};

/// Mirrors the form. Only name, company, email and consent are required — the
/// rest of the fields are optional in the UI too.
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
    Json(payload): Json<EarlyAccessRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
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
        business_type: optional(payload.business_type),
        referral_source: optional(payload.referral_source),
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
            business_type: None,
            referral_source: None,
            consent: true,
            attribution: Attribution::default(),
        }
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
        ] {
            let mut payload = request();
            mutate(&mut payload);
            assert!(validate(payload).is_err(), "{label} should be rejected");
        }
    }
}

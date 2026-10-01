//! Attio CRM sync for the landing page's early-access form.
//!
//! Everything that talks to Attio lives in this module: the handler hands over
//! a validated [`EarlyAccessLead`] and gets back success or failure, so the
//! webhook URL — itself the credential — is read in exactly one place and never
//! crosses into a response.
//!
//! Capturing a lead is one call to an Attio workflow webhook. The workflow
//! upserts the person (matched on their email so a second submission updates
//! rather than duplicates) and adds them to the early-access list.

use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use reqwest::StatusCode;
use serde::Serialize;

use crate::utils::env::EnvVars;

/// Retry schedule for calls that could still succeed: three retries, 3.5s of
/// sleeps plus however long the round trips themselves take, all of it with a
/// browser request held open. The route's timeout is what actually bounds that.
const RETRY_BACKOFF: [Duration; 3] = [
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
];

/// A completed early-access form. Validated by the handler before it gets here.
///
/// Serializes straight into the webhook payload. The field names are what the
/// Attio workflow reads, so renaming one here breaks the CRM sync.
#[derive(Debug, Clone, Serialize)]
pub struct EarlyAccessLead {
    pub name: String,
    pub email: String,
    /// The only answer the form lets a visitor skip. Left off the payload
    /// rather than blanked, so it cannot overwrite a value a previous
    /// submission filled in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telegram: Option<String>,
    pub company_name: String,
    pub business_type: String,
    pub referral_source: String,
    pub marketing_opt_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub landing_page: Option<String>,
}

#[derive(Serialize)]
struct WebhookPayload<'a> {
    #[serde(flatten)]
    lead: &'a EarlyAccessLead,
    submitted_at: String,
}

#[derive(Debug)]
pub enum AttioError {
    Transport(reqwest::Error),
    Status { status: StatusCode, body: String },
}

impl AttioError {
    /// Transport failures, 429s and 5xxs may well come out differently next
    /// time; every other status means the request itself is wrong and
    /// resending it cannot help.
    fn is_retryable(&self) -> bool {
        match self {
            Self::Transport(_) => true,
            Self::Status { status, .. } => {
                *status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
            }
        }
    }
}

impl std::fmt::Display for AttioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(error) => write!(f, "transport error: {error}"),
            Self::Status { status, body } => write!(f, "HTTP {status}: {body}"),
        }
    }
}

impl std::error::Error for AttioError {}

#[derive(Clone)]
pub struct AttioClient {
    http: reqwest::Client,
    webhook_url: String,
}

impl AttioClient {
    /// `None` until `ATTIO_EARLY_ACCESS_WEBHOOK_URL` is configured. Callers
    /// treat `None` as a failure, not as a reason to skip.
    pub fn from_env(http: reqwest::Client, env: &EnvVars) -> Option<Self> {
        let webhook_url = env.attio_early_access_webhook_url.clone()?;
        Some(Self { http, webhook_url })
    }

    /// Retries what could still succeed. A delivery that landed but whose
    /// response we never saw runs the workflow twice — a much cheaper mistake
    /// than a dropped lead.
    pub async fn capture_early_access_lead(
        &self,
        lead: &EarlyAccessLead,
    ) -> Result<(), AttioError> {
        let body = WebhookPayload {
            lead,
            submitted_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        };
        let mut attempt = 0;

        loop {
            let error = match self.send_once(&body).await {
                Ok(()) => return Ok(()),
                Err(error) if error.is_retryable() => error,
                Err(error) => return Err(error),
            };

            let Some(delay) = RETRY_BACKOFF.get(attempt) else {
                return Err(error);
            };
            tracing::warn!(attempt, "Attio webhook failed, retrying: {error}");
            tokio::time::sleep(*delay).await;
            attempt += 1;
        }
    }

    async fn send_once(&self, body: &WebhookPayload<'_>) -> Result<(), AttioError> {
        let response = self
            .http
            .post(&self.webhook_url)
            .json(body)
            .send()
            .await
            .map_err(AttioError::Transport)?;

        if !response.status().is_success() {
            return Err(AttioError::Status {
                status: response.status(),
                body: response.text().await.unwrap_or_default(),
            });
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    const WEBHOOK_PATH: &str = "/w/workspace/workflow";

    fn lead() -> EarlyAccessLead {
        EarlyAccessLead {
            name: "Ada Lovelace".to_string(),
            email: "ada@example.com".to_string(),
            telegram: None,
            company_name: "Analytical Engines".to_string(),
            business_type: "Treasury".to_string(),
            referral_source: "Word of Mouth".to_string(),
            marketing_opt_in: true,
            landing_page: Some("/business".to_string()),
        }
    }

    fn client(server: &MockServer) -> AttioClient {
        AttioClient {
            http: reqwest::Client::new(),
            webhook_url: format!("{}{WEBHOOK_PATH}", server.uri()),
        }
    }

    #[tokio::test]
    async fn capture_posts_the_lead_to_the_webhook() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path(WEBHOOK_PATH))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;

        client(&server)
            .capture_early_access_lead(&lead())
            .await
            .expect("capture should succeed");

        let requests = server.received_requests().await.expect("recording is on");
        let mut body: serde_json::Value = requests[0].body_json().expect("JSON body");
        let submitted_at = body
            .as_object_mut()
            .and_then(|body| body.remove("submitted_at"))
            .expect("submitted_at is stamped");

        assert!(submitted_at.as_str().is_some_and(|at| at.ends_with('Z')));
        // A skipped telegram is omitted rather than sent as null.
        assert_eq!(
            body,
            serde_json::json!({
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "company_name": "Analytical Engines",
                "business_type": "Treasury",
                "referral_source": "Word of Mouth",
                "marketing_opt_in": true,
                "landing_page": "/business",
            })
        );
    }

    #[tokio::test]
    async fn a_server_error_is_retried() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(503))
            .up_to_n_times(1)
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;

        client(&server)
            .capture_early_access_lead(&lead())
            .await
            .expect("the second attempt should succeed");
    }

    #[tokio::test]
    async fn a_rejected_payload_fails_without_retrying() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(400).set_body_string("bad request"))
            .expect(1)
            .mount(&server)
            .await;

        let error = client(&server)
            .capture_early_access_lead(&lead())
            .await
            .expect_err("a 400 should surface");

        assert!(matches!(
            error,
            AttioError::Status { status, .. } if status == StatusCode::BAD_REQUEST
        ));
    }
}

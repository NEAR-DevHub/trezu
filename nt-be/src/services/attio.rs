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

use chrono::Utc;
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::utils::env::EnvVars;

/// Attio people-object attribute slugs written by this form.
///
/// Each one must already exist in the workspace with a matching type: Attio
/// rejects the entire write when a slug is unknown, and rejects a select value
/// that is not character-for-character one of that attribute's options. Which
/// is why `business_type` and `referral_source` are text rather than select —
/// the form's "Other" lets a visitor answer either one in their own words.
mod slug {
    pub const NAME: &str = "name";
    pub const EMAIL_ADDRESSES: &str = "email_addresses";
    pub const COMPANY: &str = "company_name";
    pub const TELEGRAM: &str = "telegram";
    pub const BUSINESS_TYPE: &str = "business_type";
    pub const REFERRAL_SOURCE: &str = "referral_source";
    pub const MARKETING_OPT_IN: &str = "marketing_opt_in";
    pub const LEAD_SOURCE: &str = "lead_source";
    pub const SUBMITTED_AT: &str = "submitted_at";
    pub const UTM_SOURCE: &str = "utm_source";
    pub const UTM_MEDIUM: &str = "utm_medium";
    pub const UTM_CAMPAIGN: &str = "utm_campaign";
    pub const UTM_TERM: &str = "utm_term";
    pub const UTM_CONTENT: &str = "utm_content";
    pub const REFERRER: &str = "referrer";
    pub const LANDING_PAGE: &str = "landing_page";
}

/// Fixed attribution stamped on every record this form creates, so leads from
/// the landing page stay separable from every other way people reach Attio.
const LEAD_SOURCE: &str = "Near Business early access form";

/// Retry schedule for calls that could still succeed: three retries, 3.5s of
/// sleeps plus however long the round trips themselves take, all of it with a
/// browser request held open. The route's timeout is what actually bounds that.
const RETRY_BACKOFF: [Duration; 3] = [
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
];

/// A completed early-access form. Validated by the handler before it gets here.
#[derive(Debug, Clone)]
pub struct EarlyAccessLead {
    pub name: String,
    pub company: String,
    pub email: String,
    /// The only answer the form lets a visitor skip.
    pub telegram: Option<String>,
    pub business_type: String,
    pub referral_source: String,
    pub marketing_opt_in: bool,
    pub attribution: Attribution,
}

/// Campaign tags read from the landing page's URL, captured when the page
/// loads rather than when the form is submitted.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribution {
    pub utm_source: Option<String>,
    pub utm_medium: Option<String>,
    pub utm_campaign: Option<String>,
    pub utm_term: Option<String>,
    pub utm_content: Option<String>,
    pub referrer: Option<String>,
    pub landing_page: Option<String>,
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
        let body = json!({ "data": { "values": person_values(lead) } });
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

    async fn send_once(&self, body: &Value) -> Result<(), AttioError> {
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

fn person_values(lead: &EarlyAccessLead) -> Value {
    let mut values = Map::new();
    values.insert(slug::NAME.to_owned(), json!([split_name(&lead.name)]));
    values.insert(slug::EMAIL_ADDRESSES.to_owned(), json!([lead.email]));
    values.insert(slug::COMPANY.to_owned(), json!(lead.company));
    values.insert(slug::BUSINESS_TYPE.to_owned(), json!(lead.business_type));
    values.insert(
        slug::REFERRAL_SOURCE.to_owned(),
        json!(lead.referral_source),
    );
    values.insert(
        slug::MARKETING_OPT_IN.to_owned(),
        json!(lead.marketing_opt_in),
    );
    values.insert(slug::LEAD_SOURCE.to_owned(), json!(LEAD_SOURCE));
    values.insert(
        slug::SUBMITTED_AT.to_owned(),
        json!(Utc::now().to_rfc3339()),
    );

    let attribution = &lead.attribution;
    let optional = [
        (slug::TELEGRAM, &lead.telegram),
        (slug::UTM_SOURCE, &attribution.utm_source),
        (slug::UTM_MEDIUM, &attribution.utm_medium),
        (slug::UTM_CAMPAIGN, &attribution.utm_campaign),
        (slug::UTM_TERM, &attribution.utm_term),
        (slug::UTM_CONTENT, &attribution.utm_content),
        (slug::REFERRER, &attribution.referrer),
        (slug::LANDING_PAGE, &attribution.landing_page),
    ];

    // An answer the visitor skipped is left off the payload entirely: sending
    // "" would overwrite a value a previous submission had filled in.
    for (slug, value) in optional {
        if let Some(value) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            values.insert(slug.to_owned(), json!(value));
        }
    }

    Value::Object(values)
}

/// Attio's personal-name attribute wants the parts separately. The form asks
/// for one line, so the first space is the split — everything after it is the
/// last name, which keeps multi-part surnames intact. A single word leaves the
/// surname empty: guessing one would write a name into the CRM that nobody
/// gave us, and `full_name` already carries what the visitor actually typed.
fn split_name(name: &str) -> Value {
    let name = name.trim();
    let (first, last) = name.split_once(' ').unwrap_or((name, ""));
    json!({
        "first_name": first,
        "last_name": last.trim(),
        "full_name": name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_partial_json, method, path},
    };

    const WEBHOOK_PATH: &str = "/w/workspace/workflow";

    fn lead() -> EarlyAccessLead {
        EarlyAccessLead {
            name: "  Ada Van Lovelace ".to_string(),
            company: "Analytical Engines".to_string(),
            email: "ada@example.com".to_string(),
            telegram: Some("   ".to_string()),
            business_type: "Treasury".to_string(),
            referral_source: "Word of Mouth".to_string(),
            marketing_opt_in: true,
            attribution: Attribution {
                utm_source: Some("x".to_string()),
                ..Default::default()
            },
        }
    }

    fn client(server: &MockServer) -> AttioClient {
        AttioClient {
            http: reqwest::Client::new(),
            webhook_url: format!("{}{WEBHOOK_PATH}", server.uri()),
        }
    }

    #[test]
    fn skipped_answers_are_omitted_rather_than_blanked() {
        let values = person_values(&lead());

        assert_eq!(values[slug::NAME][0]["first_name"], "Ada");
        assert_eq!(values[slug::NAME][0]["last_name"], "Van Lovelace");
        assert_eq!(values[slug::NAME][0]["full_name"], "Ada Van Lovelace");
        assert_eq!(values[slug::EMAIL_ADDRESSES][0], "ada@example.com");
        assert_eq!(values[slug::BUSINESS_TYPE], "Treasury");
        assert_eq!(values[slug::REFERRAL_SOURCE], "Word of Mouth");
        assert_eq!(values[slug::MARKETING_OPT_IN], true);
        assert_eq!(values[slug::UTM_SOURCE], "x");
        // Whitespace-only and absent optionals are both left out.
        assert!(values.get(slug::TELEGRAM).is_none());
        assert!(values.get(slug::REFERRER).is_none());
    }

    #[test]
    fn a_one_word_name_leaves_the_surname_empty() {
        let name = split_name("Prince");

        assert_eq!(name["first_name"], "Prince");
        assert_eq!(name["last_name"], "");
        assert_eq!(name["full_name"], "Prince");
    }

    #[tokio::test]
    async fn capture_posts_the_person_upsert_payload_to_the_webhook() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path(WEBHOOK_PATH))
            .and(body_partial_json(json!({
                "data": { "values": {
                    "email_addresses": ["ada@example.com"],
                    "company_name": "Analytical Engines",
                }}
            })))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;

        client(&server)
            .capture_early_access_lead(&lead())
            .await
            .expect("capture should succeed");
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

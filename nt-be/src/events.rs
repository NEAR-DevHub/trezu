use chrono::{DateTime, Utc};
use serde::Serialize;

pub const EVENT_BUS_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEvent {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub account_id: String,
    pub emitted_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl AppEvent {
    pub const TREASURY_PROJECTION_UPDATED: &'static str = "treasury_projection_updated";
    pub const RELAY_SUBMISSION_UPDATED: &'static str = "relay_submission_updated";

    pub fn treasury_projection_updated(account_id: String) -> Self {
        Self {
            event_type: Self::TREASURY_PROJECTION_UPDATED,
            account_id,
            emitted_at: Utc::now(),
            data: None,
        }
    }

    /// A relay submission changed state; `data` is its `RelaySubmissionStatus`.
    pub fn relay_submission_updated(account_id: String, data: serde_json::Value) -> Self {
        Self {
            event_type: Self::RELAY_SUBMISSION_UPDATED,
            account_id,
            emitted_at: Utc::now(),
            data: Some(data),
        }
    }
}

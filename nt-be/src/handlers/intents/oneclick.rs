//! One transport for every 1Click-style call. The public 1Click API and the
//! confidential API share the shape: the app key on every request, a bearer
//! JWT when the caller holds one, JSON in and out, and an upstream failure
//! surfaced with its own status and its message, redacted.

use std::sync::Arc;

use reqwest::{RequestBuilder, StatusCode, Url};
use serde_json::Value;

use crate::AppState;
use crate::observability::sanitize_sensitive_text;

pub struct OneClickClient<'a> {
    state: &'a Arc<AppState>,
}

impl<'a> OneClickClient<'a> {
    pub fn new(state: &'a Arc<AppState>) -> Self {
        Self { state }
    }

    pub async fn get(&self, url: Url, jwt: Option<&str>) -> Result<Value, (StatusCode, String)> {
        let request = self.state.http_client.get(url.clone());
        self.send(request, &url, jwt).await
    }

    pub async fn post(
        &self,
        url: Url,
        body: &Value,
        jwt: Option<&str>,
    ) -> Result<Value, (StatusCode, String)> {
        let request = self
            .state
            .http_client
            .post(url.clone())
            .header("content-type", "application/json")
            .json(body);
        self.send(request, &url, jwt).await
    }

    /// The status decides before the body is parsed, so a non-JSON error
    /// page (a proxy's 502, say) reports its status, not a parse failure.
    async fn send(
        &self,
        mut request: RequestBuilder,
        url: &Url,
        jwt: Option<&str>,
    ) -> Result<Value, (StatusCode, String)> {
        if let Some(jwt) = jwt {
            request = request.header("Authorization", format!("Bearer {jwt}"));
        }
        if let Some(api_key) = &self.state.env_vars.oneclick_api_key {
            request = request.header("x-api-key", api_key);
        }
        let response = request.send().await.map_err(|e| {
            tracing::error!("1Click request to {} failed: {}", url.path(), e);
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to call 1Click API: {e}"),
            )
        })?;
        let status = response.status();
        let text = response.text().await.map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to read 1Click response: {e}"),
            )
        })?;
        let body = serde_json::from_str::<Value>(&text);
        if !status.is_success() {
            let message = body
                .as_ref()
                .ok()
                .and_then(|body| body.get("message").or_else(|| body.get("error")))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    let text = text.trim();
                    if text.is_empty() {
                        "Unknown error from 1Click API".to_string()
                    } else {
                        text.chars().take(200).collect()
                    }
                });
            return Err((
                StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
                sanitize_sensitive_text(&message),
            ));
        }
        body.map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to parse 1Click response: {e}"),
            )
        })
    }
}

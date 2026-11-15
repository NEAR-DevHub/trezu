//! Instrumentation for every outbound HTTP call made through the shared client.
//!
//! [`AppState::http_client`](crate::AppState) is wrapped with
//! [`OutboundTracing`], so each call to 1Click, the POA bridge, NearBlocks,
//! DeFiLlama, CoinGecko and the other APIs:
//! - runs inside an `http.client` span (method, host, path, status). Sentry
//!   shows it as a child span when the transaction is sampled;
//! - adds a Sentry `http` breadcrumb when it succeeds;
//! - logs a 4xx/5xx or transport failure with the upstream status, latency and
//!   a sanitized snippet of the response body. That log line is also a
//!   breadcrumb on the request's Sentry event.
//!
//! So when a handler turns an upstream 403 into its own 500, the Sentry event
//! shows which upstream refused and what it said.

use std::time::{Duration, Instant};

use axum::http::{Extensions, Response as HttpResponse};
use reqwest::{Request, Response, ResponseBuilderExt as _, Url};
use reqwest_middleware::{ClientWithMiddleware, Middleware, Next};
use tracing::{Instrument as _, Level};

use super::sanitize_sensitive_text;

/// The shared outbound HTTP client: `reqwest` with tracing middleware. Same
/// request-building API as `reqwest::Client`.
pub type HttpClient = ClientWithMiddleware;

/// Wrap a plain `reqwest::Client` with outbound instrumentation.
pub fn traced_http_client(client: reqwest::Client) -> HttpClient {
    reqwest_middleware::ClientBuilder::new(client)
        .with(OutboundTracing)
        .build()
}

/// See the module docs.
pub struct OutboundTracing;

#[async_trait::async_trait]
impl Middleware for OutboundTracing {
    async fn handle(
        &self,
        request: Request,
        extensions: &mut Extensions,
        next: Next<'_>,
    ) -> reqwest_middleware::Result<Response> {
        let method = request.method().clone();
        let url = loggable_url(request.url());
        let span = tracing::info_span!(
            "http.client",
            otel.kind = "client",
            http.method = %method,
            http.url = %url,
            http.status_code = tracing::field::Empty,
        );

        let started = Instant::now();
        let result = next.run(request, extensions).instrument(span.clone()).await;
        let elapsed = started.elapsed();

        match result {
            Ok(response) if response.status().is_success() => {
                span.record("http.status_code", response.status().as_u16());
                add_http_breadcrumb(&method, &url, response.status().as_u16(), elapsed);
                Ok(response)
            }
            Ok(response) => {
                span.record("http.status_code", response.status().as_u16());
                log_error_response(&method, &url, response, elapsed).await
            }
            Err(error) => {
                tracing::warn!(
                    http.method = %method,
                    http.url = %url,
                    elapsed_ms = elapsed.as_millis() as u64,
                    error = %error,
                    "outbound {method} {url} failed after {}ms: {error}",
                    elapsed.as_millis()
                );
                Err(error)
            }
        }
    }
}

/// Log a non-2xx response with its body, then rebuild an equal response for
/// the caller (reading the body consumes it).
async fn log_error_response(
    method: &reqwest::Method,
    url: &str,
    response: Response,
    elapsed: Duration,
) -> reqwest_middleware::Result<Response> {
    let status = response.status();
    let version = response.version();
    let headers = response.headers().clone();
    let response_url = response.url().clone();
    let bytes = response.bytes().await?;
    let body = sanitize_sensitive_text(&String::from_utf8_lossy(&bytes));

    // A 4xx is often expected by the caller (an unknown token is a 404), so it
    // is INFO. A 5xx is the upstream failing, so it is WARN. Both are
    // breadcrumbs, and neither is a Sentry event by itself: the caller decides
    // whether this is an error.
    macro_rules! log_at {
        ($level:expr) => {
            tracing::event!(
                $level,
                http.method = %method,
                http.url = %url,
                http.status_code = status.as_u16(),
                elapsed_ms = elapsed.as_millis() as u64,
                response_body = %body,
                "outbound {method} {url} -> {status} in {}ms: {body}",
                elapsed.as_millis()
            )
        };
    }
    if status.is_server_error() {
        log_at!(Level::WARN);
    } else {
        log_at!(Level::INFO);
    }

    let mut rebuilt = HttpResponse::builder()
        .status(status)
        .version(version)
        .url(response_url);
    if let Some(rebuilt_headers) = rebuilt.headers_mut() {
        *rebuilt_headers = headers;
    }
    let rebuilt = rebuilt
        .body(bytes)
        .map_err(|e| reqwest_middleware::Error::Middleware(e.into()))?;
    Ok(Response::from(rebuilt))
}

fn add_http_breadcrumb(method: &reqwest::Method, url: &str, status: u16, elapsed: Duration) {
    sentry::add_breadcrumb(sentry::Breadcrumb {
        ty: "http".into(),
        category: Some("http".into()),
        data: [
            ("method".to_owned(), method.as_str().into()),
            ("url".to_owned(), url.into()),
            ("status_code".to_owned(), status.into()),
            (
                "duration_ms".to_owned(),
                (elapsed.as_millis() as u64).into(),
            ),
        ]
        .into_iter()
        .collect(),
        ..Default::default()
    });
}

/// `scheme://host[:port]/path`. Query strings and userinfo are dropped because
/// they can carry API keys.
fn loggable_url(url: &Url) -> String {
    let mut out = format!(
        "{}://{}",
        url.scheme(),
        url.host_str().unwrap_or("<no-host>")
    );
    if let Some(port) = url.port() {
        out.push_str(&format!(":{port}"));
    }
    out.push_str(url.path());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn loggable_url_drops_query_and_credentials() {
        let url =
            Url::parse("https://user:pw@api.example.com:8443/v1/tokens?apiKey=secret").unwrap();
        assert_eq!(loggable_url(&url), "https://api.example.com:8443/v1/tokens");
    }

    /// The middleware reads error bodies in order to log them. Callers must
    /// still see the same status, headers and body, because they build their
    /// own error messages from them.
    #[tokio::test]
    async fn error_responses_reach_the_caller_intact() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/rpc"))
            .respond_with(
                ResponseTemplate::new(403)
                    .insert_header("x-upstream", "bridge")
                    .set_body_string(r#"{"error":"forbidden"}"#),
            )
            .mount(&server)
            .await;

        let client = traced_http_client(reqwest::Client::new());
        let response = client
            .post(format!("{}/rpc?key=secret", server.uri()))
            .json(&serde_json::json!({}))
            .send()
            .await
            .expect("a 403 is a response, not a transport error");

        assert_eq!(response.status(), reqwest::StatusCode::FORBIDDEN);
        assert_eq!(response.headers()["x-upstream"], "bridge");
        assert_eq!(response.url().path(), "/rpc");
        assert_eq!(response.text().await.unwrap(), r#"{"error":"forbidden"}"#);
    }
}

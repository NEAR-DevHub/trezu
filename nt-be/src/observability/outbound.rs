//! Instrumentation for every outbound HTTP call made through the shared client.
//!
//! [`AppState::http_client`](crate::AppState) is wrapped with
//! [`OutboundTracing`], so each call to 1Click, the POA bridge, NearBlocks,
//! DeFiLlama, CoinGecko and the other APIs:
//! - runs inside an `http.client` span (method, host, path, status). Sentry
//!   shows it as a child span when the transaction is sampled;
//! - adds a Sentry `http` breadcrumb (method, URL, status, latency). A failed
//!   call's breadcrumb also carries the error kind, a sanitized body snippet
//!   and the upstream's diagnostic headers (`server`, `cf-ray`, request ids,
//!   rate-limit headers). Breadcrumbs are added directly, so `RUST_LOG` does
//!   not filter them;
//! - logs a 4xx/5xx or transport failure with the same details;
//! - records the failure for the enclosing HTTP request (see
//!   [`track_upstream_failures`]). The request's 5xx report then names the
//!   upstream in its tags.
//!
//! So when a handler turns an upstream 403 into its own 500, the Sentry event
//! shows which upstream refused, what it said, and whose edge refused it.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fmt;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::http::{Extensions, HeaderMap, Response as HttpResponse};
use reqwest::{Method, Request, Response, ResponseBuilderExt as _, Url};
use reqwest_middleware::{ClientWithMiddleware, Middleware, Next};
use serde_json::Value;
use tracing::{Instrument as _, Level};

use super::sanitize_sensitive_text;

/// Target of this module's failure logs. The Sentry tracing layer ignores it,
/// because the same details already go to Sentry as `http` breadcrumbs.
pub(super) const LOG_TARGET: &str = "nt_be::observability::outbound";

/// The shared outbound HTTP client: `reqwest` with tracing middleware. Same
/// request-building API as `reqwest::Client`.
pub type HttpClient = ClientWithMiddleware;

/// Wrap a plain `reqwest::Client` with outbound instrumentation.
pub fn traced_http_client(client: reqwest::Client) -> HttpClient {
    reqwest_middleware::ClientBuilder::new(client)
        .with(OutboundTracing)
        .build()
}

/// A failed outbound call: a non-2xx response or a transport error.
#[derive(Clone, Debug)]
pub struct UpstreamFailure {
    pub method: String,
    /// `scheme://host[:port]/path`, without query or credentials.
    pub url: String,
    pub host: String,
    /// `None` when no response arrived (see `error_kind`).
    pub status: Option<u16>,
    /// `timeout`, `connect`, `body`, `decode`, `request`, `redirect`,
    /// `middleware` or `other`. Set for transport errors only.
    pub error_kind: Option<&'static str>,
    pub error: Option<String>,
    pub elapsed_ms: u64,
    /// Sanitized and truncated.
    pub response_body: Option<String>,
    /// Allow-listed diagnostic headers only (see [`diagnostic_headers`]).
    pub response_headers: BTreeMap<String, String>,
    /// Where in our code the call was made.
    pub call_site: CallSite,
}

/// The stack at the moment an outbound call failed. In async Rust it still
/// holds the chain of `async fn`s polling the call (handler → helpers → the
/// function that sent the request), which is what "where is this URL called
/// from" needs.
///
/// Captured unresolved, which is cheap. Symbols are resolved only when
/// [`CallSite::call_path`] is called, i.e. when the request ends in a 5xx.
#[derive(Clone)]
pub struct CallSite(Arc<Mutex<backtrace::Backtrace>>);

impl CallSite {
    fn capture() -> Self {
        Self(Arc::new(Mutex::new(backtrace::Backtrace::new_unresolved())))
    }

    /// Our own frames, innermost first, as `function (src/file.rs:line)`.
    /// Framework/runtime frames, this module and closure suffixes are dropped,
    /// and repeated frames are collapsed. Release builds can inline small
    /// functions away, so the path may skip a step.
    pub fn call_path(&self) -> Vec<String> {
        let mut backtrace = match self.0.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        backtrace.resolve();

        let mut path: Vec<String> = Vec::new();
        let mut last_function = String::new();
        for symbol in backtrace.frames().iter().flat_map(|frame| frame.symbols()) {
            let Some(name) = symbol.name().map(|name| format!("{name:#}")) else {
                continue;
            };
            let function = strip_closure_suffixes(&name);
            if !function.starts_with("nt_be::") || is_instrumentation_frame(function) {
                continue;
            }
            let location = match (symbol.filename(), symbol.lineno()) {
                (Some(file), Some(line)) => {
                    let file = file.to_string_lossy();
                    let file = file.find("/src/").map_or(&*file, |at| &file[at + 1..]);
                    format!(" ({file}:{line})")
                }
                _ => String::new(),
            };
            if function != last_function {
                path.push(format!("{function}{location}"));
                last_function = function.to_owned();
            }
        }
        path
    }
}

/// `a::b::{closure#0}::{closure#0}` (or legacy `{{closure}}`) -> `a::b`:
/// an `async fn` body is a closure frame of the function itself.
fn strip_closure_suffixes(mut name: &str) -> &str {
    while let Some(at) = name.rfind("::{") {
        if !name.ends_with('}') {
            break;
        }
        name = &name[..at];
    }
    name
}

fn is_instrumentation_frame(function: &str) -> bool {
    function.starts_with("nt_be::observability::outbound::")
        || function.starts_with("nt_be::observability::server_errors::report_server_errors")
}

impl fmt::Debug for CallSite {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CallSite(..)")
    }
}

tokio::task_local! {
    static LAST_UPSTREAM_FAILURE: RefCell<Option<UpstreamFailure>>;
}

/// Run `future` and return its output with the last outbound call that failed
/// inside it. Calls made from tasks it spawns are not seen.
pub async fn track_upstream_failures<F: Future>(future: F) -> (F::Output, Option<UpstreamFailure>) {
    LAST_UPSTREAM_FAILURE
        .scope(RefCell::new(None), async move {
            let output = future.await;
            let failure = LAST_UPSTREAM_FAILURE.with(|last| last.borrow_mut().take());
            (output, failure)
        })
        .await
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
        let host = request.url().host_str().unwrap_or("<no-host>").to_owned();
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
        let failure = |status, error_kind, error| UpstreamFailure {
            method: method.to_string(),
            url: url.clone(),
            host: host.clone(),
            status,
            error_kind,
            error,
            elapsed_ms: elapsed.as_millis() as u64,
            response_body: None,
            response_headers: BTreeMap::new(),
            call_site: CallSite::capture(),
        };

        match result {
            Ok(response) if response.status().is_success() => {
                span.record("http.status_code", response.status().as_u16());
                add_success_breadcrumb(&method, &url, response.status().as_u16(), elapsed);
                Ok(response)
            }
            Ok(response) => {
                let status = response.status();
                span.record("http.status_code", status.as_u16());
                let (response, body) = read_body(response).await?;
                let failure = UpstreamFailure {
                    response_body: Some(body),
                    response_headers: diagnostic_headers(response.headers()),
                    ..failure(Some(status.as_u16()), None, None)
                };
                report_failure(failure);
                Ok(response)
            }
            Err(error) => {
                report_failure(failure(
                    None,
                    Some(transport_error_kind(&error)),
                    Some(sanitize_sensitive_text(&error.to_string())),
                ));
                Err(error)
            }
        }
    }
}

/// Read a response body for logging and rebuild an equal response for the
/// caller (reading the body consumes it).
async fn read_body(response: Response) -> reqwest_middleware::Result<(Response, String)> {
    let status = response.status();
    let version = response.version();
    let headers = response.headers().clone();
    let response_url = response.url().clone();
    let bytes = response.bytes().await?;
    let body = sanitize_sensitive_text(&String::from_utf8_lossy(&bytes));

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
    Ok((Response::from(rebuilt), body))
}

/// Log, breadcrumb and remember one failed call.
///
/// A 4xx is often expected by the caller (an unknown token is a 404), so it is
/// INFO. A 5xx or a transport error is the upstream failing, so it is WARN.
/// Neither is a Sentry event by itself: the caller decides whether this is an
/// error, and the request's 5xx report picks it up from the task-local.
fn report_failure(failure: UpstreamFailure) {
    let is_upstream_fault = failure.status.is_none_or(|status| status >= 500);
    let outcome = match (failure.status, &failure.error) {
        (Some(status), _) => status.to_string(),
        (None, Some(error)) => format!("{} error: {error}", failure.error_kind.unwrap_or("other")),
        (None, None) => "failed".to_owned(),
    };
    let headers =
        (!failure.response_headers.is_empty()).then(|| format!("{:?}", failure.response_headers));
    macro_rules! log_at {
        ($level:expr) => {
            tracing::event!(
                target: LOG_TARGET,
                $level,
                http.method = %failure.method,
                http.url = %failure.url,
                http.status_code = failure.status,
                error_kind = failure.error_kind,
                elapsed_ms = failure.elapsed_ms,
                response_body = failure.response_body.as_deref(),
                response_headers = headers.as_deref(),
                "outbound {} {} -> {} in {}ms{}",
                failure.method,
                failure.url,
                outcome,
                failure.elapsed_ms,
                failure
                    .response_body
                    .as_deref()
                    .map(|body| format!(": {body}"))
                    .unwrap_or_default()
            )
        };
    }
    if is_upstream_fault {
        log_at!(Level::WARN);
    } else {
        log_at!(Level::INFO);
    }

    let mut data = breadcrumb_data(&failure.method, &failure.url, failure.elapsed_ms);
    if let Some(status) = failure.status {
        data.insert("status_code".to_owned(), status.into());
    }
    if let Some(kind) = failure.error_kind {
        data.insert("error_kind".to_owned(), kind.into());
    }
    if let Some(error) = &failure.error {
        data.insert("error".to_owned(), error.as_str().into());
    }
    if let Some(body) = &failure.response_body {
        data.insert("response_body".to_owned(), body.as_str().into());
    }
    for (name, value) in &failure.response_headers {
        data.insert(format!("response_header.{name}"), value.as_str().into());
    }
    sentry::add_breadcrumb(sentry::Breadcrumb {
        ty: "http".into(),
        category: Some("http".into()),
        level: if is_upstream_fault {
            sentry::Level::Error
        } else {
            sentry::Level::Warning
        },
        data,
        ..Default::default()
    });

    let _ = LAST_UPSTREAM_FAILURE.try_with(|last| *last.borrow_mut() = Some(failure));
}

fn add_success_breadcrumb(method: &Method, url: &str, status: u16, elapsed: Duration) {
    let mut data = breadcrumb_data(method.as_str(), url, elapsed.as_millis() as u64);
    data.insert("status_code".to_owned(), status.into());
    sentry::add_breadcrumb(sentry::Breadcrumb {
        ty: "http".into(),
        category: Some("http".into()),
        data,
        ..Default::default()
    });
}

fn breadcrumb_data(method: &str, url: &str, elapsed_ms: u64) -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("method".to_owned(), method.into()),
        ("url".to_owned(), url.into()),
        ("duration_ms".to_owned(), elapsed_ms.into()),
    ])
}

fn transport_error_kind(error: &reqwest_middleware::Error) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else if error.is_body() {
        "body"
    } else if error.is_decode() {
        "decode"
    } else if error.is_redirect() {
        "redirect"
    } else if error.is_request() {
        "request"
    } else if error.is_middleware() {
        "middleware"
    } else {
        "other"
    }
}

/// Response headers that help explain a failure, and are safe to record.
/// `server`, `via`, `cf-ray` and `cf-mitigated` tell a CDN/WAF block from an
/// application error. Request ids let the provider find the call. Rate-limit
/// headers explain 429s and soft blocks. Anything else, cookies above all, is
/// dropped.
fn diagnostic_headers(headers: &HeaderMap) -> BTreeMap<String, String> {
    const EXACT: &[&str] = &[
        "server",
        "via",
        "content-type",
        "retry-after",
        "www-authenticate",
        "cf-ray",
        "cf-mitigated",
        "cf-cache-status",
        "x-request-id",
        "x-correlation-id",
        "x-trace-id",
        "request-id",
        "x-amzn-requestid",
        "x-amzn-errortype",
        "x-amz-cf-id",
        "x-cache",
    ];
    const PREFIXES: &[&str] = &["x-ratelimit-", "ratelimit-", "x-rate-limit-"];
    headers
        .iter()
        .filter(|(name, _)| {
            let name = name.as_str();
            EXACT.contains(&name) || PREFIXES.iter().any(|prefix| name.starts_with(prefix))
        })
        .filter_map(|(name, value)| {
            let value = value.to_str().ok()?;
            Some((name.as_str().to_owned(), sanitize_sensitive_text(value)))
        })
        .collect()
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

    /// A transport failure has no status; it must be classified so a timeout
    /// or refused connection reads as such on the 5xx event.
    #[tokio::test]
    async fn transport_failures_are_classified() {
        // Bind then drop a listener so the port is known to refuse connections.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let client = traced_http_client(reqwest::Client::new());

        let (result, failure) =
            track_upstream_failures(client.get(format!("http://127.0.0.1:{port}/x")).send()).await;

        assert!(result.is_err());
        let failure = failure.expect("the failed call must be recorded");
        assert_eq!(failure.status, None);
        assert_eq!(failure.error_kind, Some("connect"));
        assert_eq!(failure.url, format!("http://127.0.0.1:{port}/x"));
        assert!(failure.error.is_some());
    }

    #[test]
    fn closure_suffixes_are_stripped() {
        assert_eq!(
            strip_closure_suffixes("nt_be::a::f::{closure#0}::{closure#1}"),
            "nt_be::a::f"
        );
        assert_eq!(
            strip_closure_suffixes("nt_be::a::f::{{closure}}"),
            "nt_be::a::f"
        );
        assert_eq!(strip_closure_suffixes("nt_be::a::f"), "nt_be::a::f");
    }

    #[test]
    fn diagnostic_headers_keep_only_the_allow_list() {
        let mut headers = HeaderMap::new();
        for (name, value) in [
            ("server", "cloudflare"),
            ("cf-ray", "abc-FRA"),
            ("x-ratelimit-remaining", "0"),
            ("set-cookie", "session=secret"),
            ("authorization", "Bearer secret"),
            ("x-custom", "noise"),
        ] {
            headers.insert(
                axum::http::HeaderName::from_static(name),
                value.parse().unwrap(),
            );
        }
        assert_eq!(
            diagnostic_headers(&headers),
            BTreeMap::from([
                ("cf-ray".to_owned(), "abc-FRA".to_owned()),
                ("server".to_owned(), "cloudflare".to_owned()),
                ("x-ratelimit-remaining".to_owned(), "0".to_owned()),
            ])
        );
    }
}

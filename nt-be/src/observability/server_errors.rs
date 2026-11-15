//! Turn every 5xx response into a self-describing Sentry event.
//!
//! Most handlers answer a failure with `(StatusCode, String)` and never log the
//! error, so the only trace of a 500 used to be tower-http's
//! `DefaultOnFailure` event, titled just "response failed". It said nothing
//! about the route or the cause. This middleware reads the error body that is
//! already on its way to the client (e.g. `HTTP error! status: 403 Forbidden`)
//! and logs it at ERROR with the matched route. The sentry-tracing layer then
//! captures that as the event. The last outbound call that failed during the
//! request (see [`super::outbound`]) is attached as `upstream_*` tags and
//! fields, and every outbound call is a breadcrumb. The event is tagged
//! `alert_priority=p0` so Sentry alert rules page on it.

use axum::{
    body::{Body, HttpBody},
    extract::{MatchedPath, Request},
    middleware::Next,
    response::Response,
};

use std::time::Instant;

use super::{sanitize_sensitive_text, track_upstream_failures};
use crate::error_event::Priority;

/// Every 5xx pages: the user saw a failure we did not handle gracefully.
/// Sentry alert rules route on the `alert_priority` tag (docs/RUNBOOKS.md).
const SERVER_ERROR_PRIORITY: Priority = Priority::P0;

/// Error bodies are short strings or the small `ApiError` JSON envelope. Bigger
/// or streaming bodies are left untouched rather than buffered.
const MAX_CAPTURED_BODY_BYTES: usize = 16 * 1024;

/// Route label for requests no route matched (the apalis-board fallback).
/// Using the raw path instead would make one Sentry issue per URL.
const UNMATCHED_ROUTE: &str = "<fallback>";

/// Axum middleware: log 5xx responses at ERROR with the route and error body.
///
/// Mount it with `Router::layer` (so [`MatchedPath`] is set), inside the
/// per-request Sentry hub and the `http_request` span, so the event gets the
/// request's tags, breadcrumbs and `request_id`.
pub async fn report_server_errors(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_owned());
    let path = request.uri().path().to_owned();

    let started = Instant::now();
    let (response, upstream) = track_upstream_failures(next.run(request)).await;
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let status = response.status();
    if !status.is_server_error() {
        return response;
    }

    let (parts, body) = response.into_parts();
    let (error_body, body) = capture_body(body).await;
    let route = route.as_deref().unwrap_or(UNMATCHED_ROUTE);
    let upstream = upstream.as_ref();
    let upstream_headers = upstream
        .filter(|failure| !failure.response_headers.is_empty())
        .map(|failure| format!("{:?}", failure.response_headers));
    let upstream_call_path = upstream
        .map(|failure| failure.call_site.call_path())
        .filter(|path| !path.is_empty())
        .map(|path| path.join("\n"));

    // The message carries the cause so the Sentry issue title is useful on its
    // own. `apply_stable_fingerprint` groups by method/route/status (the tags),
    // so a dynamic body does not split one failure into many issues.
    //
    // `upstream_*` describe the last outbound call that failed while serving
    // this request. That is usually, but not provably, the cause. As tags they
    // allow searches like "500s where upstream_host is the bridge". `None`
    // fields are omitted from the event.
    tracing::error!(
        tags.alert_priority = SERVER_ERROR_PRIORITY.as_str(),
        tags.http_method = %method,
        tags.http_route = route,
        tags.http_status = status.as_u16(),
        tags.upstream_host = upstream.map(|failure| failure.host.as_str()),
        tags.upstream_status = upstream.and_then(|failure| failure.status),
        tags.upstream_error_kind = upstream.and_then(|failure| failure.error_kind),
        http.path = %path,
        elapsed_ms,
        error_body = %error_body,
        upstream.request = upstream.map(|failure| format!("{} {}", failure.method, failure.url)),
        upstream.elapsed_ms = upstream.map(|failure| failure.elapsed_ms),
        upstream.error = upstream.and_then(|failure| failure.error.as_deref()),
        upstream.response_body = upstream.and_then(|failure| failure.response_body.as_deref()),
        upstream.response_headers = upstream_headers.as_deref(),
        upstream.call_path = upstream_call_path.as_deref(),
        "{method} {route} -> {status}: {error_body}"
    );

    Response::from_parts(parts, body)
}

/// Read a small, fully-known body so it can be logged, and hand back an
/// identical body for the client.
async fn capture_body(body: Body) -> (String, Body) {
    let fits = body
        .size_hint()
        .exact()
        .is_some_and(|len| len <= MAX_CAPTURED_BODY_BYTES as u64);
    if !fits {
        return (
            format!("[body not captured: streaming or over {MAX_CAPTURED_BODY_BYTES} bytes]"),
            body,
        );
    }

    match axum::body::to_bytes(body, MAX_CAPTURED_BODY_BYTES).await {
        Ok(bytes) if bytes.is_empty() => ("[empty body]".to_owned(), Body::empty()),
        Ok(bytes) => (
            sanitize_sensitive_text(&String::from_utf8_lossy(&bytes)),
            Body::from(bytes),
        ),
        Err(e) => (format!("[failed to read body: {e}]"), Body::empty()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, http::StatusCode, routing::get};
    use std::sync::{Arc, Mutex};
    use tower::ServiceExt as _;
    use tracing_subscriber::prelude::*;

    #[derive(Debug, Clone)]
    struct Captured {
        level: tracing::Level,
        message: String,
        fields: Vec<(String, String)>,
    }

    /// Records every event with its fields. ERROR events are the ones the
    /// sentry-tracing bridge would send to Sentry.
    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<Captured>>>);

    struct FieldVisitor<'a>(&'a mut Captured);
    impl tracing::field::Visit for FieldVisitor<'_> {
        fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
            let value = format!("{value:?}");
            if field.name() == "message" {
                self.0.message = value;
            } else {
                self.0.fields.push((field.name().to_owned(), value));
            }
        }
        fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
            self.0
                .fields
                .push((field.name().to_owned(), value.to_owned()));
        }
    }

    impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Capture {
        fn on_event(
            &self,
            event: &tracing::Event<'_>,
            _: tracing_subscriber::layer::Context<'_, S>,
        ) {
            let mut captured = Captured {
                level: *event.metadata().level(),
                message: String::new(),
                fields: Vec::new(),
            };
            event.record(&mut FieldVisitor(&mut captured));
            self.0.lock().unwrap().push(captured);
        }
    }

    impl Captured {
        fn field(&self, name: &str) -> Option<&str> {
            self.fields
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str())
        }
    }

    async fn call(app: &Router, uri: &str) -> (StatusCode, String) {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    /// The bug this guards against: a production 500 reached Sentry as a bare
    /// "response failed" with no route and no cause. A 5xx must now produce one
    /// ERROR event naming the route and carrying the error body. The client
    /// must still get the same body, and 2xx/4xx must not alert.
    #[tokio::test]
    async fn server_errors_are_reported_with_route_and_body() {
        let events = Capture::default();
        let _guard =
            tracing::subscriber::set_default(tracing_subscriber::registry().with(events.clone()));

        async fn ok() -> &'static str {
            "ok"
        }
        async fn bad() -> (StatusCode, String) {
            (StatusCode::BAD_REQUEST, "bad input".to_owned())
        }
        async fn upstream_forbidden() -> (StatusCode, String) {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "HTTP error! status: 403 Forbidden".to_owned(),
            )
        }
        let app = Router::new()
            .route("/ok", get(ok))
            .route("/bad", get(bad))
            .route("/tokens/{id}", get(upstream_forbidden))
            .layer(axum::middleware::from_fn(report_server_errors));

        assert_eq!(call(&app, "/ok").await, (StatusCode::OK, "ok".to_owned()));
        assert_eq!(
            call(&app, "/bad").await,
            (StatusCode::BAD_REQUEST, "bad input".to_owned())
        );
        assert_eq!(
            call(&app, "/tokens/abc").await,
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "HTTP error! status: 403 Forbidden".to_owned()
            ),
            "the client must receive the original error body unchanged"
        );

        let errors: Vec<_> = events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event.level == tracing::Level::ERROR)
            .cloned()
            .collect();
        assert_eq!(errors.len(), 1, "only the 5xx should alert: {errors:?}");
        let event = &errors[0];
        assert_eq!(
            event.message,
            "GET /tokens/{id} -> 500 Internal Server Error: HTTP error! status: 403 Forbidden"
        );
        assert_eq!(event.field("tags.http_route"), Some("/tokens/{id}"));
        assert_eq!(event.field("tags.http_status"), Some("500"));
        assert_eq!(event.field("tags.alert_priority"), Some("p0"));
        assert_eq!(event.field("http.path"), Some("/tokens/abc"));
    }

    /// The 5xx event must name the upstream call that failed during the
    /// request: host and status as tags, plus its body and diagnostic
    /// headers. Cookies and other non-diagnostic headers must not leak.
    #[tokio::test]
    async fn server_errors_carry_the_failed_upstream_call() {
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let upstream = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(403)
                    .insert_header("server", "cloudflare")
                    .insert_header("cf-ray", "8c1f2a3b4c5d6e7f-FRA")
                    .insert_header("set-cookie", "session=secret")
                    .set_body_string("error code: 1020"),
            )
            .mount(&upstream)
            .await;

        let events = Capture::default();
        let _guard =
            tracing::subscriber::set_default(tracing_subscriber::registry().with(events.clone()));

        let client = super::super::traced_http_client(reqwest::Client::new());
        let url = format!("{}/rpc?apiKey=secret", upstream.uri());
        let app = Router::new()
            .route(
                "/swap-tokens",
                get(move || {
                    let client = client.clone();
                    let url = url.clone();
                    async move {
                        let status = fetch_bridge_status(&client, &url).await;
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("HTTP error! status: {status}"),
                        )
                    }
                }),
            )
            .layer(axum::middleware::from_fn(report_server_errors));

        let (status, _) = call(&app, "/swap-tokens").await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);

        let errors: Vec<_> = events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event.level == tracing::Level::ERROR)
            .cloned()
            .collect();
        assert_eq!(errors.len(), 1, "{errors:?}");
        let event = &errors[0];
        assert_eq!(event.field("tags.upstream_host"), Some("127.0.0.1"));
        assert_eq!(event.field("tags.upstream_status"), Some("403"));
        assert_eq!(event.field("tags.upstream_error_kind"), None);
        let request = event.field("upstream.request").expect("upstream.request");
        assert!(
            request.starts_with("POST http://127.0.0.1:") && request.ends_with("/rpc"),
            "query string must be dropped: {request}"
        );
        assert_eq!(
            event.field("upstream.response_body"),
            Some("error code: 1020")
        );
        let headers = event
            .field("upstream.response_headers")
            .expect("upstream.response_headers");
        assert!(headers.contains("cloudflare") && headers.contains("8c1f2a3b4c5d6e7f-FRA"));
        assert!(
            !headers.contains("session"),
            "cookies must not be recorded: {headers}"
        );
        assert!(event.field("elapsed_ms").is_some());

        // Innermost first: the helper that sent the request, then the handler
        // that called it, and nothing from the middleware or test harness.
        // Locations are asserted because release builds may not name frames.
        let call_path: Vec<_> = event
            .field("upstream.call_path")
            .expect("upstream.call_path")
            .lines()
            .map(str::to_owned)
            .collect();
        assert_eq!(call_path.len(), 2, "{call_path:#?}");
        assert!(
            call_path[0].ends_with(&format!(
                "src/observability/server_errors.rs:{}",
                SEND_LINE.load(std::sync::atomic::Ordering::Relaxed)
            )) || call_path[0].contains(&format!(
                "src/observability/server_errors.rs:{})",
                SEND_LINE.load(std::sync::atomic::Ordering::Relaxed)
            )),
            "{call_path:#?}"
        );
        assert!(
            call_path[1].contains("src/observability/server_errors.rs:"),
            "{call_path:#?}"
        );
    }

    static SEND_LINE: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

    /// Stands in for e.g. `fetch_supported_tokens_data`: the place in our code
    /// that calls the upstream, which the call path must name.
    async fn fetch_bridge_status(
        client: &crate::observability::HttpClient,
        url: &str,
    ) -> StatusCode {
        #[rustfmt::skip]
        let (response, line) = (client.post(url).send().await, line!());
        SEND_LINE.store(line, std::sync::atomic::Ordering::Relaxed);
        response.unwrap().status()
    }
}

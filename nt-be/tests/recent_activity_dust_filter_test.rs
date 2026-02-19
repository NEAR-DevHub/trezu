//! Integration test: recent activity API filters out NEAR dust (< 0.01 NEAR)
//!
//! Verifies that tiny NEAR balance changes (gas/storage noise) are excluded from
//! the recent activity endpoint but still present in the raw balance-changes API.

mod common;

use common::TestServer;
use serial_test::serial;

/// Ensure the test account has Pro plan for full history access
async fn ensure_pro_plan(pool: &sqlx::PgPool) {
    sqlx::query(
        "INSERT INTO monitored_accounts (account_id, enabled, plan_type, export_credits, batch_payment_credits, gas_covered_transactions, created_at, updated_at)
         VALUES ('webassemblymusic-treasury.sputnik-dao.near', true, 'pro', 10, 100, 2000, NOW(), NOW())
         ON CONFLICT (account_id) DO UPDATE SET
            plan_type = 'pro',
            export_credits = 10,
            batch_payment_credits = 100,
            gas_covered_transactions = 2000",
    )
    .execute(pool)
    .await
    .expect("Failed to ensure Pro plan for test account");
}

/// Load test data (reuses webassemblymusic-treasury data from balance_history_apis_test)
async fn load_test_data() {
    common::load_test_env();

    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("Failed to connect to test database");

    // Check if data is already loaded
    let existing_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM balance_changes
         WHERE account_id = 'webassemblymusic-treasury.sputnik-dao.near'",
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to check existing data");

    if existing_count > 0 {
        ensure_pro_plan(&pool).await;
        pool.close().await;
        return;
    }

    println!("Loading webassemblymusic-treasury test data...");

    sqlx::query("DELETE FROM balance_changes WHERE account_id = 'webassemblymusic-treasury.sputnik-dao.near'")
        .execute(&pool)
        .await
        .expect("Failed to clear balance_changes test data");

    sqlx::query("DELETE FROM counterparties WHERE account_id IN ('arizcredits.near') OR account_id LIKE 'intents.near:%'")
        .execute(&pool)
        .await
        .expect("Failed to clear counterparties test data");

    let counterparties_sql =
        std::fs::read_to_string("tests/test_data/webassemblymusic_counterparties.sql")
            .expect("Failed to read counterparties SQL file");

    for line in counterparties_sql.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("--")
            || trimmed.to_uppercase().starts_with("SET ")
            || trimmed.to_uppercase().starts_with("SELECT ")
            || trimmed.starts_with("\\restrict")
            || trimmed.starts_with("\\unrestrict")
        {
            continue;
        }
        if let Err(e) = sqlx::query(line).execute(&pool).await {
            panic!(
                "Failed to execute SQL: {}\nError: {}",
                &line[..100.min(line.len())],
                e
            );
        }
    }

    let balance_changes_sql =
        std::fs::read_to_string("tests/test_data/webassemblymusic_balance_changes.sql")
            .expect("Failed to read balance changes SQL file");

    for statement in balance_changes_sql.lines() {
        let trimmed = statement.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("--")
            || trimmed.to_uppercase().starts_with("SET ")
            || trimmed.to_uppercase().starts_with("SELECT ")
            || trimmed.starts_with("\\restrict")
            || trimmed.starts_with("\\unrestrict")
        {
            continue;
        }
        sqlx::query(statement)
            .execute(&pool)
            .await
            .expect("Failed to load balance change");
    }

    ensure_pro_plan(&pool).await;
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn test_recent_activity_filters_near_dust() {
    load_test_data().await;

    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    // Fetch recent activity (should filter out NEAR dust < 0.01)
    let response = client
        .get(server.url("/api/recent-activity"))
        .query(&[
            ("accountId", "webassemblymusic-treasury.sputnik-dao.near"),
            ("limit", "100"),
        ])
        .send()
        .await
        .expect("Failed to send recent-activity request");

    assert_eq!(response.status(), 200, "Recent activity should return 200");

    let body: serde_json::Value = response.json().await.expect("Failed to parse JSON");
    let data = body["data"].as_array().expect("data should be an array");

    // Verify no NEAR dust in recent activity
    let near_dust_items: Vec<&serde_json::Value> = data
        .iter()
        .filter(|item| {
            let token_id = item["tokenId"].as_str().unwrap_or("");
            let amount = item["amount"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(1.0); // Default to non-dust
            token_id == "near" && amount.abs() < 0.01
        })
        .collect();

    assert!(
        near_dust_items.is_empty(),
        "Recent activity should not contain NEAR dust (< 0.01 NEAR), but found {} items: {:?}",
        near_dust_items.len(),
        near_dust_items
            .iter()
            .map(|item| format!(
                "amount={}, counterparty={}",
                item["amount"].as_str().unwrap_or("?"),
                item["counterparty"].as_str().unwrap_or("?")
            ))
            .collect::<Vec<_>>()
    );

    // Verify that non-dust NEAR records ARE still present
    let near_items: Vec<&serde_json::Value> = data
        .iter()
        .filter(|item| item["tokenId"].as_str().unwrap_or("") == "near")
        .collect();

    assert!(
        !near_items.is_empty(),
        "Recent activity should still contain non-dust NEAR records"
    );

    println!(
        "✓ Recent activity: {} items total, {} NEAR items (all >= 0.01 NEAR), 0 dust items",
        data.len(),
        near_items.len()
    );

    // Now verify the raw balance-changes API still includes dust
    let bc_response = client
        .get(server.url("/api/balance-changes"))
        .query(&[
            ("accountId", "webassemblymusic-treasury.sputnik-dao.near"),
            ("tokenIds", "near"),
            ("limit", "1000"),
        ])
        .send()
        .await
        .expect("Failed to send balance-changes request");

    assert_eq!(bc_response.status(), 200);

    let bc_items: Vec<serde_json::Value> = bc_response.json().await.expect("Failed to parse JSON");

    let bc_dust: Vec<&serde_json::Value> = bc_items
        .iter()
        .filter(|item| {
            let amount = item["amount"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(1.0);
            amount.abs() < 0.01 && amount.abs() > 0.0 // Exclude exact 0 (snapshots)
        })
        .collect();

    assert!(
        !bc_dust.is_empty(),
        "Balance-changes API should still include NEAR dust records for accounting"
    );

    println!(
        "✓ Balance-changes API: {} NEAR items total, {} are dust (correctly preserved)",
        bc_items.len(),
        bc_dust.len()
    );
}

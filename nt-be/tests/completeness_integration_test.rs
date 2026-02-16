//! Integration test for the balance history completeness API
//!
//! Tests GET /api/balance-history/completeness using real testing-astradao.sputnik-dao.near data
//! downloaded from api.trezu.app via the /api/balance-changes endpoint.

mod common;

use common::TestServer;
use serial_test::serial;

const ACCOUNT_ID: &str = "testing-astradao.sputnik-dao.near";

/// Load testing-astradao balance changes from SQL dump into the test database
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
    let existing_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM balance_changes WHERE account_id = $1")
            .bind(ACCOUNT_ID)
            .fetch_one(&pool)
            .await
            .expect("Failed to check existing data");

    if existing_count > 0 {
        println!(
            "Test data already loaded ({} records for {})",
            existing_count, ACCOUNT_ID
        );
        pool.close().await;
        return;
    }

    println!("Loading testing-astradao test data...");

    // Read and execute SQL dump
    let sql = std::fs::read_to_string("tests/test_data/testing_astradao_balance_changes.sql")
        .expect("Failed to read testing_astradao_balance_changes.sql");

    for line in sql.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("--") {
            continue;
        }

        if let Err(e) = sqlx::query(trimmed).execute(&pool).await {
            panic!(
                "Failed to execute SQL: {}\nError: {}",
                &trimmed[..100.min(trimmed.len())],
                e
            );
        }
    }

    // Add monitored account entry
    sqlx::query(
        "INSERT INTO monitored_accounts (account_id, last_synced_at, created_at)
         VALUES ($1, NOW(), NOW())
         ON CONFLICT (account_id) DO UPDATE SET last_synced_at = NOW()",
    )
    .bind(ACCOUNT_ID)
    .execute(&pool)
    .await
    .expect("Failed to add monitored account");

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM balance_changes WHERE account_id = $1")
            .bind(ACCOUNT_ID)
            .fetch_one(&pool)
            .await
            .expect("Failed to count records");

    println!("Loaded {} balance change records for {}", count, ACCOUNT_ID);

    pool.close().await;
}

#[tokio::test]
#[serial]
async fn test_completeness_api() {
    load_test_data().await;

    let server = TestServer::start().await;
    let client = reqwest::Client::new();

    // Call the completeness endpoint with a wide time range covering all test data
    let url = server.url(&format!(
        "/api/balance-history/completeness?accountId={}&from=2020-01-01T00:00:00Z&to=2026-12-31T23:59:59Z",
        ACCOUNT_ID
    ));
    let response = client
        .get(&url)
        .send()
        .await
        .expect("Failed to call completeness API");

    assert_eq!(response.status(), 200, "Completeness API should return 200");

    let body: serde_json::Value = response
        .json()
        .await
        .expect("Failed to parse JSON response");

    // Verify top-level structure
    assert_eq!(body["accountId"], ACCOUNT_ID);
    assert!(body["from"].is_string(), "from should be present");
    assert!(body["to"].is_string(), "to should be present");

    let tokens = body["tokens"]
        .as_array()
        .expect("tokens should be an array");

    // We expect all token types from the test data
    assert!(
        tokens.len() >= 13,
        "Expected at least 13 tokens, got {}",
        tokens.len()
    );

    println!("Completeness response tokens:");
    for t in tokens {
        println!(
            "  {} - hasGaps: {}, gapCount: {}",
            t["tokenId"], t["hasGaps"], t["gapCount"]
        );
    }

    // ---- Consistency checks ----
    for t in tokens {
        let has_gaps = t["hasGaps"].as_bool().unwrap();
        let gap_count = t["gapCount"].as_u64().unwrap();
        let gaps = t["gaps"].as_array().unwrap();

        // has_gaps should be consistent with gap_count
        assert_eq!(
            has_gaps,
            gap_count > 0,
            "hasGaps should match gapCount > 0 for token {}",
            t["tokenId"]
        );

        // gaps array length should match gap_count
        assert_eq!(
            gaps.len() as u64,
            gap_count,
            "gaps array length should match gapCount for token {}",
            t["tokenId"]
        );

        // Each gap should have the expected fields
        for gap in gaps {
            assert!(gap["startBlock"].is_number(), "gap should have startBlock");
            assert!(gap["endBlock"].is_number(), "gap should have endBlock");
            assert!(
                gap["startBlockTime"].is_string(),
                "gap should have startBlockTime"
            );
            assert!(
                gap["endBlockTime"].is_string(),
                "gap should have endBlockTime"
            );
            assert!(
                gap["balanceAfterPrevious"].is_string(),
                "gap should have balanceAfterPrevious"
            );
            assert!(
                gap["balanceBeforeNext"].is_string(),
                "gap should have balanceBeforeNext"
            );
        }
    }
}

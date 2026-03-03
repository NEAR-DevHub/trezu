/// End-to-end integration test for the Goldsky enrichment pipeline.
///
/// Tests the full flow:
///   1. Load Goldsky fixture data into indexed_dao_outcomes
///   2. Run enrichment + maintenance cycles to process all outcomes
///   3. Verify results via the HTTP API layer (Axum router)
///   4. Assert API response matches reference data exactly
///
/// Uses real archival RPC for balance queries. Takes ~25 seconds with
/// a minimal fixture set (3 outcomes, 1 USDC deposit + 1 sponsor call pair).
///
/// ```bash
/// cargo test --test goldsky_e2e_test -- --nocapture
/// ```
mod common;

use axum::body::Body;
use axum::http::Request;
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt;

/// Balance change record — fields we compare against reference.
/// Only includes fields that should match; `id` and `createdAt` are excluded.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BalanceChangeRecord {
    block_height: i64,
    token_id: String,
    amount: String,
    balance_before: String,
    balance_after: String,
    counterparty: Option<String>,
    signer_id: Option<String>,
    receiver_id: Option<String>,
    action_kind: Option<String>,
    method_name: Option<String>,
    transaction_hashes: Vec<String>,
}

/// Load Goldsky fixture data into indexed_dao_outcomes.
async fn load_neon_fixtures(pool: &PgPool) {
    let fixture_sql = include_str!("test_data/goldsky_trezu_demo_fixtures.sql");
    for stmt in fixture_sql.split(';').filter(|s| !s.trim().is_empty()) {
        let trimmed = stmt.trim();
        if trimmed.starts_with("--") && !trimmed.contains("INSERT") {
            continue;
        }
        sqlx::query(trimmed)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("Failed to execute fixture SQL: {e}\nStatement: {trimmed}"));
    }
}

/// Query the API-filtered count (records that pass all WHERE clauses).
async fn api_filtered_count(pool: &PgPool, account_id: &str) -> i64 {
    let result: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM balance_changes WHERE account_id = $1 \
         AND counterparty != 'SNAPSHOT' \
         AND counterparty != 'STAKING_SNAPSHOT' \
         AND counterparty != 'NOT_REGISTERED' \
         AND (amount != 0 OR balance_before != balance_after) \
         AND (action_kind IS NULL OR action_kind != 'CreateAccount') \
         AND counterparty != 'sponsor.trezu.near'",
    )
    .bind(account_id)
    .fetch_one(pool)
    .await
    .unwrap();
    result.0
}

#[sqlx::test]
async fn test_goldsky_enrichment_trezu_demo(pool: PgPool) {
    common::load_test_env();
    let _ = env_logger::try_init();

    let account_id = "trezu-demo.sputnik-dao.near";
    let network = common::create_archival_network();
    println!(
        "RPC endpoint: {} (bearer set: {})",
        network.rpc_endpoints[0].url,
        network.rpc_endpoints[0].bearer_header.is_some()
    );
    let env_vars = nt_be::utils::env::EnvVars::default();
    let http_client = reqwest::Client::new();

    // -----------------------------------------------------------------------
    // 1. Load fixture data + register account
    // -----------------------------------------------------------------------
    load_neon_fixtures(&pool).await;

    let fixture_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM indexed_dao_outcomes")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(fixture_count.0, 3, "Expected 3 fixture rows loaded");
    println!(
        "Loaded {} fixture rows into indexed_dao_outcomes",
        fixture_count.0
    );

    sqlx::query(
        "INSERT INTO monitored_accounts (account_id, enabled, dirty_at)
         VALUES ($1, true, NOW())",
    )
    .bind(account_id)
    .execute(&pool)
    .await
    .unwrap();

    // -----------------------------------------------------------------------
    // 2. Run enrichment cycles until all outcomes are processed
    // -----------------------------------------------------------------------
    let mut total_processed = 0usize;
    loop {
        let processed =
            nt_be::handlers::balance_changes::goldsky_enrichment::run_enrichment_cycle(
                &pool, &pool, &network,
            )
            .await
            .unwrap();
        total_processed += processed;
        if processed < 100 {
            break;
        }
    }
    println!("Enrichment processed {total_processed} outcomes total");

    let after_enrichment: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM balance_changes WHERE account_id = $1",
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let enrichment_api = api_filtered_count(&pool, account_id).await;
    println!(
        "After enrichment: {} DB records, {} API-visible",
        after_enrichment.0, enrichment_api,
    );

    // -----------------------------------------------------------------------
    // 3. Run one maintenance cycle for NEAR gas-fee gap filling
    // -----------------------------------------------------------------------
    let max_block: (i64,) = sqlx::query_as(
        "SELECT COALESCE(MAX(trigger_block_height), 0) FROM indexed_dao_outcomes",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query("UPDATE monitored_accounts SET dirty_at = NOW() WHERE account_id = $1")
        .bind(account_id)
        .execute(&pool)
        .await
        .unwrap();

    println!("\n--- Running maintenance cycle ---");
    nt_be::handlers::balance_changes::account_monitor::run_maintenance_cycle(
        &pool,
        &network,
        max_block.0,
        None,
        Some((&http_client, &env_vars.fastnear_api_key)),
        env_vars.intents_explorer_api_key.as_deref(),
        &env_vars.intents_explorer_api_url,
    )
    .await
    .unwrap();

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM balance_changes WHERE account_id = $1",
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let filtered = api_filtered_count(&pool, account_id).await;
    println!("After maintenance 1: DB total: {}, API-visible: {}", total.0, filtered);

    // -----------------------------------------------------------------------
    // 3b. Run second maintenance cycle to verify creation_block floor optimization
    //     This should make significantly fewer RPC calls since the account
    //     creation block is now known (discovered in cycle 1).
    // -----------------------------------------------------------------------
    sqlx::query("UPDATE monitored_accounts SET dirty_at = NOW() WHERE account_id = $1")
        .bind(account_id)
        .execute(&pool)
        .await
        .unwrap();

    println!("\n--- Running maintenance cycle 2 (should be faster with creation block floor) ---");
    nt_be::handlers::balance_changes::account_monitor::run_maintenance_cycle(
        &pool,
        &network,
        max_block.0,
        None,
        Some((&http_client, &env_vars.fastnear_api_key)),
        env_vars.intents_explorer_api_key.as_deref(),
        &env_vars.intents_explorer_api_url,
    )
    .await
    .unwrap();

    let total2: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM balance_changes WHERE account_id = $1",
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let filtered2 = api_filtered_count(&pool, account_id).await;
    println!("After maintenance 2: DB total: {}, API-visible: {}", total2.0, filtered2);

    // -----------------------------------------------------------------------
    // 4. Verify results via the HTTP API layer
    // -----------------------------------------------------------------------
    let reference: Vec<BalanceChangeRecord> =
        serde_json::from_str(include_str!("test_data/goldsky_trezu_demo_reference.json"))
            .expect("Failed to parse reference JSON");
    let expected_count = reference.len() as i64;

    let state = Arc::new(common::build_test_state(pool));
    let app = nt_be::routes::create_routes(state);

    let request = Request::builder()
        .uri(format!(
            "/api/balance-changes?accountId={account_id}&limit=100"
        ))
        .body(Body::empty())
        .unwrap();

    let response = ServiceExt::<Request<Body>>::oneshot(app, request)
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        200,
        "API returned non-200: {}",
        response.status()
    );

    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let local_records: Vec<BalanceChangeRecord> =
        serde_json::from_slice(&body).expect("Failed to parse API response JSON");
    println!(
        "API returned {} balance_changes records (expected {})",
        local_records.len(),
        expected_count
    );

    // -----------------------------------------------------------------------
    // 5. Hard assertions against reference
    // -----------------------------------------------------------------------
    if local_records.len() != expected_count as usize {
        println!("\nLocal records ({}):", local_records.len());
        for r in &local_records {
            println!(
                "  block={} token={} amount={} counterparty={:?} method={:?}",
                r.block_height,
                &r.token_id[..r.token_id.len().min(30)],
                r.amount,
                r.counterparty,
                r.method_name,
            );
        }
        println!("\nReference records ({expected_count}):");
        for r in &reference {
            println!(
                "  block={} token={} amount={} counterparty={:?} method={:?}",
                r.block_height,
                &r.token_id[..r.token_id.len().min(30)],
                r.amount,
                r.counterparty,
                r.method_name,
            );
        }
    }
    assert_eq!(
        local_records.len(),
        expected_count as usize,
        "Expected {expected_count} balance changes, got {}",
        local_records.len()
    );

    // Sort both by (blockHeight ASC, tokenId ASC) for deterministic comparison
    let mut ref_sorted: Vec<&BalanceChangeRecord> = reference.iter().collect();
    ref_sorted.sort_by(|a, b| {
        a.block_height
            .cmp(&b.block_height)
            .then(a.token_id.cmp(&b.token_id))
    });

    let mut local_sorted: Vec<&BalanceChangeRecord> = local_records.iter().collect();
    local_sorted.sort_by(|a, b| {
        a.block_height
            .cmp(&b.block_height)
            .then(a.token_id.cmp(&b.token_id))
    });

    let mut mismatches = 0;

    for (i, (expected, actual)) in ref_sorted.iter().zip(local_sorted.iter()).enumerate() {
        let key = format!(
            "block={} token={}",
            expected.block_height,
            &expected.token_id[..expected.token_id.len().min(20)]
        );

        assert_eq!(
            expected.block_height, actual.block_height,
            "Record {i}: blockHeight mismatch"
        );
        assert_eq!(
            expected.token_id, actual.token_id,
            "Record {i}: tokenId mismatch"
        );

        let mut record_ok = true;

        if expected.amount != actual.amount {
            println!(
                "  MISMATCH [{key}] amount: expected={} actual={}",
                expected.amount, actual.amount
            );
            record_ok = false;
        }
        if expected.balance_before != actual.balance_before {
            println!(
                "  MISMATCH [{key}] balanceBefore: expected={} actual={}",
                expected.balance_before, actual.balance_before
            );
            record_ok = false;
        }
        if expected.balance_after != actual.balance_after {
            println!(
                "  MISMATCH [{key}] balanceAfter: expected={} actual={}",
                expected.balance_after, actual.balance_after
            );
            record_ok = false;
        }
        if expected.counterparty != actual.counterparty {
            println!(
                "  MISMATCH [{key}] counterparty: expected={:?} actual={:?}",
                expected.counterparty, actual.counterparty
            );
            record_ok = false;
        }
        if expected.action_kind != actual.action_kind {
            println!(
                "  MISMATCH [{key}] actionKind: expected={:?} actual={:?}",
                expected.action_kind, actual.action_kind
            );
            record_ok = false;
        }
        if expected.method_name != actual.method_name {
            println!(
                "  MISMATCH [{key}] methodName: expected={:?} actual={:?}",
                expected.method_name, actual.method_name
            );
            record_ok = false;
        }
        if expected.signer_id != actual.signer_id {
            println!(
                "  MISMATCH [{key}] signerId: expected={:?} actual={:?}",
                expected.signer_id, actual.signer_id
            );
            record_ok = false;
        }
        if expected.receiver_id != actual.receiver_id {
            println!(
                "  MISMATCH [{key}] receiverId: expected={:?} actual={:?}",
                expected.receiver_id, actual.receiver_id
            );
            record_ok = false;
        }

        let mut expected_hashes = expected.transaction_hashes.clone();
        expected_hashes.sort();
        let mut actual_hashes = actual.transaction_hashes.clone();
        actual_hashes.sort();
        if expected_hashes != actual_hashes {
            println!(
                "  MISMATCH [{key}] transactionHashes: expected={:?} actual={:?}",
                expected_hashes, actual_hashes
            );
            record_ok = false;
        }

        if !record_ok {
            mismatches += 1;
        }
    }

    println!(
        "\n--- Result: {mismatches} mismatches out of {expected_count} records ---\n"
    );

    assert_eq!(
        mismatches, 0,
        "{mismatches} records did not match reference. See output above for details."
    );

    println!("All {expected_count} records match reference!");
}

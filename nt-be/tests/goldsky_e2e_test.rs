/// End-to-end integration tests for the Goldsky enrichment pipeline.
///
/// Two test scenarios:
///   1. trezu-demo (51 outcomes) — original test, sponsor call pairs only
///   2. lesik_o (14 outcomes) — tests executor_id filter capturing add_proposal/act_proposal
///
/// Uses real archival RPC for balance queries.
///
/// ```bash
/// cargo test --test goldsky_e2e_test -- --nocapture
/// cargo test --test goldsky_e2e_test test_goldsky_executor_id_lesik_o -- --nocapture
/// ```
mod common;

use axum::body::Body;
use axum::http::Request;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;
use tower::ServiceExt;

/// Balance change record — fields we inspect in the API response.
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

/// Load fixture SQL into indexed_dao_outcomes.
async fn load_fixtures(pool: &PgPool, fixture_sql: &str) {
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

    let total_start = Instant::now();

    // -----------------------------------------------------------------------
    // 1. Load fixture data + register account
    // -----------------------------------------------------------------------
    load_fixtures(
        &pool,
        include_str!("test_data/goldsky_trezu_demo_fixtures.sql"),
    )
    .await;

    let fixture_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM indexed_dao_outcomes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fixture_count.0, 51, "Expected 51 fixture rows loaded");
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
    let enrichment_start = Instant::now();
    let mut total_processed = 0usize;
    loop {
        let processed = nt_be::handlers::balance_changes::goldsky_enrichment::run_enrichment_cycle(
            &pool, &pool, &network,
        )
        .await
        .unwrap();
        total_processed += processed;
        if processed < 100 {
            break;
        }
    }
    let enrichment_elapsed = enrichment_start.elapsed();
    println!(
        "Enrichment: processed {} outcomes in {:.2}s",
        total_processed,
        enrichment_elapsed.as_secs_f64()
    );

    let after_enrichment: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM balance_changes WHERE account_id = $1")
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
    // 3. Run maintenance cycle for NEAR gas-fee gap filling
    // -----------------------------------------------------------------------
    let max_block: (i64,) =
        sqlx::query_as("SELECT COALESCE(MAX(trigger_block_height), 0) FROM indexed_dao_outcomes")
            .fetch_one(&pool)
            .await
            .unwrap();

    sqlx::query("UPDATE monitored_accounts SET dirty_at = NOW() WHERE account_id = $1")
        .bind(account_id)
        .execute(&pool)
        .await
        .unwrap();

    let maintenance_start = Instant::now();
    println!("\n--- Running maintenance cycle 1 ---");
    nt_be::handlers::balance_changes::account_monitor::run_maintenance_cycle(
        &pool,
        &network,
        max_block.0,
        None,
        Some((&http_client, &env_vars.fastnear_api_key)),
        env_vars.intents_explorer_api_key.as_deref(),
        &env_vars.intents_explorer_api_url,
        None,
    )
    .await
    .unwrap();
    let maintenance1_elapsed = maintenance_start.elapsed();

    let total: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM balance_changes WHERE account_id = $1")
            .bind(account_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let filtered = api_filtered_count(&pool, account_id).await;
    println!(
        "After maintenance 1: DB total: {}, API-visible: {} ({:.2}s)",
        total.0,
        filtered,
        maintenance1_elapsed.as_secs_f64()
    );

    // -----------------------------------------------------------------------
    // 3b. Second maintenance cycle (should be faster with creation block floor)
    // -----------------------------------------------------------------------
    sqlx::query("UPDATE monitored_accounts SET dirty_at = NOW() WHERE account_id = $1")
        .bind(account_id)
        .execute(&pool)
        .await
        .unwrap();

    let maintenance2_start = Instant::now();
    println!("\n--- Running maintenance cycle 2 (creation block floor active) ---");
    nt_be::handlers::balance_changes::account_monitor::run_maintenance_cycle(
        &pool,
        &network,
        max_block.0,
        None,
        Some((&http_client, &env_vars.fastnear_api_key)),
        env_vars.intents_explorer_api_key.as_deref(),
        &env_vars.intents_explorer_api_url,
        None,
    )
    .await
    .unwrap();
    let maintenance2_elapsed = maintenance2_start.elapsed();

    let total2: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM balance_changes WHERE account_id = $1")
            .bind(account_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let filtered2 = api_filtered_count(&pool, account_id).await;
    println!(
        "After maintenance 2: DB total: {}, API-visible: {} ({:.2}s)",
        total2.0,
        filtered2,
        maintenance2_elapsed.as_secs_f64()
    );

    // -----------------------------------------------------------------------
    // 4. Query the HTTP API and dump results
    // -----------------------------------------------------------------------
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
    let records: Vec<BalanceChangeRecord> =
        serde_json::from_slice(&body).expect("Failed to parse API response JSON");

    let total_elapsed = total_start.elapsed();

    // -----------------------------------------------------------------------
    // 5. Print summary
    // -----------------------------------------------------------------------
    println!("\n========== RESULTS ==========");
    println!("Fixtures:        {} outcomes", fixture_count.0);
    println!(
        "Enrichment:      {} processed in {:.2}s",
        total_processed,
        enrichment_elapsed.as_secs_f64()
    );
    println!(
        "Maintenance 1:   {:.2}s",
        maintenance1_elapsed.as_secs_f64()
    );
    println!(
        "Maintenance 2:   {:.2}s",
        maintenance2_elapsed.as_secs_f64()
    );
    println!("API records:     {}", records.len());
    println!("Total time:      {:.2}s", total_elapsed.as_secs_f64());
    println!("=============================\n");

    println!("API-visible balance changes ({} records):", records.len());
    for r in &records {
        let token_short = if r.token_id.len() > 30 {
            &r.token_id[..30]
        } else {
            &r.token_id
        };
        println!(
            "  block={} token={:<30} amount={:<15} counterparty={:<30} method={:?}",
            r.block_height,
            token_short,
            r.amount,
            r.counterparty.as_deref().unwrap_or("-"),
            r.method_name,
        );
    }

    // Sanity: should have at least the original USDC deposit
    assert!(
        records.len() >= 1,
        "Expected at least 1 API-visible balance change"
    );
    println!("\nTest passed with {} API-visible records.", records.len());
}

/// Tests the executor_id pipeline filter with lesik_o.sputnik-dao.near.
///
/// This account has 14 outcomes including:
/// - 4 sponsor call pairs (receiver_id match)
/// - 4 executor_id matches (add_proposal/act_proposal execution outcomes)
///
/// The executor_id outcomes should be processed by enrichment directly,
/// creating balance change records at the correct blocks without needing
/// gap filling for those transactions.
#[sqlx::test]
async fn test_goldsky_executor_id_lesik_o(pool: PgPool) {
    common::load_test_env();
    let _ = env_logger::try_init();

    let account_id = "lesik_o.sputnik-dao.near";
    let network = common::create_archival_network();
    let env_vars = nt_be::utils::env::EnvVars::default();
    let http_client = reqwest::Client::new();

    let total_start = Instant::now();

    // -----------------------------------------------------------------------
    // 1. Load fixture data + register account
    // -----------------------------------------------------------------------
    load_fixtures(
        &pool,
        include_str!("test_data/goldsky_lesik_o_fixtures.sql"),
    )
    .await;

    let fixture_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM indexed_dao_outcomes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fixture_count.0, 14, "Expected 14 fixture rows loaded");
    println!(
        "Loaded {} fixture rows into indexed_dao_outcomes",
        fixture_count.0
    );

    // Count executor_id matched outcomes (the new ones from the pipeline update)
    let executor_matches: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM indexed_dao_outcomes \
         WHERE executor_id LIKE '%.sputnik-dao.near' \
         AND receiver_id NOT LIKE '%.sputnik-dao.near'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    println!(
        "  executor_id matched outcomes (add_proposal/act_proposal): {}",
        executor_matches.0
    );
    assert_eq!(
        executor_matches.0, 6,
        "Expected 6 executor_id matched outcomes (add_proposal/act_proposal cross-contract receipts)"
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
    // 2. Run enrichment
    // -----------------------------------------------------------------------
    let enrichment_start = Instant::now();
    let mut total_processed = 0usize;
    loop {
        let processed = nt_be::handlers::balance_changes::goldsky_enrichment::run_enrichment_cycle(
            &pool, &pool, &network,
        )
        .await
        .unwrap();
        total_processed += processed;
        if processed < 100 {
            break;
        }
    }
    let enrichment_elapsed = enrichment_start.elapsed();
    println!(
        "Enrichment: processed {} outcomes in {:.2}s",
        total_processed,
        enrichment_elapsed.as_secs_f64()
    );

    // Check which blocks got enrichment records
    let enrichment_blocks: Vec<(i64,)> = sqlx::query_as(
        "SELECT DISTINCT block_height FROM balance_changes \
         WHERE account_id = $1 AND token_id = 'near' \
         ORDER BY block_height",
    )
    .bind(account_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let block_list: Vec<i64> = enrichment_blocks.iter().map(|r| r.0).collect();
    println!(
        "Enrichment created NEAR records at blocks: {:?}",
        block_list
    );

    // Path B creates records at 4 sponsor call pair blocks
    // Path C creates records at 4 executor_id outcome blocks (add_proposal/act_proposal)
    assert!(
        block_list.len() >= 8,
        "Expected at least 8 enrichment NEAR blocks (4 sponsor + 4 executor_id), got {}",
        block_list.len()
    );

    let after_enrichment = api_filtered_count(&pool, account_id).await;
    println!("After enrichment: {} API-visible records", after_enrichment);

    // -----------------------------------------------------------------------
    // 3. Run maintenance cycle
    // -----------------------------------------------------------------------
    let max_block: (i64,) =
        sqlx::query_as("SELECT COALESCE(MAX(trigger_block_height), 0) FROM indexed_dao_outcomes")
            .fetch_one(&pool)
            .await
            .unwrap();

    sqlx::query("UPDATE monitored_accounts SET dirty_at = NOW() WHERE account_id = $1")
        .bind(account_id)
        .execute(&pool)
        .await
        .unwrap();

    let maintenance_start = Instant::now();
    println!("\n--- Running maintenance cycle ---");
    nt_be::handlers::balance_changes::account_monitor::run_maintenance_cycle(
        &pool,
        &network,
        max_block.0,
        None,
        Some((&http_client, &env_vars.fastnear_api_key)),
        env_vars.intents_explorer_api_key.as_deref(),
        &env_vars.intents_explorer_api_url,
        None,
    )
    .await
    .unwrap();
    let maintenance_elapsed = maintenance_start.elapsed();

    let after_maintenance = api_filtered_count(&pool, account_id).await;
    println!(
        "After maintenance: {} API-visible records ({:.2}s)",
        after_maintenance,
        maintenance_elapsed.as_secs_f64()
    );

    // -----------------------------------------------------------------------
    // 4. Query the HTTP API
    // -----------------------------------------------------------------------
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
    assert_eq!(response.status(), 200);

    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let records: Vec<BalanceChangeRecord> =
        serde_json::from_slice(&body).expect("Failed to parse API response JSON");

    let total_elapsed = total_start.elapsed();

    // -----------------------------------------------------------------------
    // 5. Print summary
    // -----------------------------------------------------------------------
    println!("\n========== RESULTS ==========");
    println!(
        "Fixtures:        {} outcomes (6 executor_id matched)",
        fixture_count.0
    );
    println!(
        "Enrichment:      {} processed in {:.2}s",
        total_processed,
        enrichment_elapsed.as_secs_f64()
    );
    println!("Maintenance:     {:.2}s", maintenance_elapsed.as_secs_f64());
    println!("API records:     {}", records.len());
    println!("Total time:      {:.2}s", total_elapsed.as_secs_f64());
    println!("=============================\n");

    println!("API-visible balance changes ({} records):", records.len());
    for r in &records {
        let token_short = if r.token_id.len() > 30 {
            &r.token_id[..30]
        } else {
            &r.token_id
        };
        println!(
            "  block={} token={:<30} amount={:<15} counterparty={:<30} method={:?}",
            r.block_height,
            token_short,
            r.amount,
            r.counterparty.as_deref().unwrap_or("-"),
            r.method_name,
        );
    }

    assert!(
        records.len() >= 1,
        "Expected at least 1 API-visible balance change"
    );
    println!("\nTest passed with {} API-visible records.", records.len());
}

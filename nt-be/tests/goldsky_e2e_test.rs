/// End-to-end integration test for the Goldsky enrichment pipeline.
///
/// Tests enrichment for webassemblymusic-treasury.sputnik-dao.near using 10 Neon
/// outcomes with hard expectations verified against production (api.trezu.app).
///
/// Uses `experimental_tx_status` to resolve receipt blocks and real archival RPC
/// for balance queries.
///
/// ```bash
/// cargo test --test goldsky_e2e_test -- --nocapture
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

/// Tests enrichment for webassemblymusic-treasury.sputnik-dao.near.
///
/// Uses 10 Neon outcomes from 2026-03-04 and verifies that the pipeline produces
/// the same balance change records as production (api.trezu.app).
///
/// Neon outcomes (10 total):
///   188101232: petersalomonsen.near → DAO (add_proposal with 0.432 NEAR deposit, 2 outcomes)
///   188102281: sponsor call pair — add_proposal relay (2 outcomes)
///   188102291: executor_id outcome (act_proposal → petersalomonsen.near, Path C, 1 outcome)
///   188102389: sponsor call pair — add_proposal relay (2 outcomes)
///   188102395: executor_id outcomes + intents mt_burn log (Path C + Path A, 3 outcomes)
///
/// Expected balance changes (from api.trezu.app production):
///   188101233: NEAR  +0.4320                    (Transfer from petersalomonsen.near)
///   188102293: NEAR  +0.0968868677547962        (FunctionCall, cross-contract Path C)
///   188102397: NEAR  -0.000734839823481300000001 (FunctionCall, intents swap gas)
///   188102398: intents USDC -10                  (FunctionCall, intents swap)
///   188102401: NEAR  -0.0999452422423777         (intents.near settlement)
#[sqlx::test]
async fn test_goldsky_webassemblymusic(pool: PgPool) {
    common::load_test_env();
    let _ = env_logger::try_init();

    let account_id = "webassemblymusic-treasury.sputnik-dao.near";
    let network = common::create_archival_network();

    let total_start = Instant::now();

    // -----------------------------------------------------------------------
    // 1. Load fixture data + register account
    // -----------------------------------------------------------------------
    load_fixtures(
        &pool,
        include_str!("test_data/goldsky_webassemblymusic_fixtures.sql"),
    )
    .await;

    let fixture_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM indexed_dao_outcomes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fixture_count.0, 10, "Expected 10 fixture rows loaded");
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

    let after_enrichment = api_filtered_count(&pool, account_id).await;
    println!("After enrichment: {} API-visible records", after_enrichment);

    // -----------------------------------------------------------------------
    // 3. Query the HTTP API (enrichment-only, no maintenance)
    // -----------------------------------------------------------------------
    let state = Arc::new(common::build_test_state(pool.clone()));
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
    // 4. Print summary
    // -----------------------------------------------------------------------
    println!("\n========== RESULTS ==========");
    println!("Fixtures:        {} outcomes", fixture_count.0);
    println!(
        "Enrichment:      {} processed in {:.2}s",
        total_processed,
        enrichment_elapsed.as_secs_f64()
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
            "  block={} token={:<30} amount={:<25} counterparty={:<30} action={:?} tx={:?}",
            r.block_height,
            token_short,
            r.amount,
            r.counterparty.as_deref().unwrap_or("-"),
            r.action_kind,
            r.transaction_hashes,
        );
    }

    // -----------------------------------------------------------------------
    // 5. Hard expectations — must match production (api.trezu.app)
    //
    // Enrichment alone should find records 1-4 via experimental_tx_status
    // receipt block resolution + Path A/B/C event parsing.
    // -----------------------------------------------------------------------
    let find = |block: i64, token: &str| -> Option<&BalanceChangeRecord> {
        records
            .iter()
            .find(|r| r.block_height == block && r.token_id == token)
    };

    // Also dump all DB records (including non-API-visible) for debugging
    let all_db: Vec<(i64, String, String, String)> = sqlx::query_as(
        "SELECT block_height, token_id, amount::TEXT, counterparty \
         FROM balance_changes WHERE account_id = $1 \
         ORDER BY block_height ASC",
    )
    .bind(account_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    println!("\nAll DB records ({}):", all_db.len());
    for (block, token, amount, cp) in &all_db {
        let token_short = if token.len() > 40 {
            &token[..40]
        } else {
            token.as_str()
        };
        println!(
            "  block={} token={:<40} amount={:<25} cp={}",
            block, token_short, amount, cp
        );
    }

    // --- Record 1: block 188101233, NEAR +0.432 (Transfer from petersalomonsen.near) ---
    // Path B: receiver_id = DAO, signer = petersalomonsen.near, trigger block 188101232
    // tx_status resolves receipt block to 188101233 (cross-shard +1 block).
    let r1 = find(188_101_233, "near")
        .expect("Missing: block 188101233 NEAR (petersalomonsen.near Transfer deposit)");
    assert_eq!(r1.counterparty.as_deref(), Some("petersalomonsen.near"));
    assert!(
        r1.amount.starts_with("0.432"),
        "Expected amount ~0.432, got {}",
        r1.amount
    );
    println!("\nRecord 1 OK: block=188101233 NEAR +{}", r1.amount);

    // --- Record 2: block 188102293, NEAR +0.0969 (FunctionCall, Path C) ---
    // Path C: executor_id = DAO, receiver_id = petersalomonsen.near, trigger block 188102291
    // tx_status resolves receipt block to 188102293.
    let r2 = find(188_102_293, "near")
        .expect("Missing: block 188102293 NEAR (act_proposal Path C cross-contract)");
    assert_eq!(r2.counterparty.as_deref(), Some("petersalomonsen.near"));
    assert!(
        r2.amount.starts_with("0.09"),
        "Expected amount ~0.0969, got {}",
        r2.amount
    );
    println!("Record 2 OK: block=188102293 NEAR +{}", r2.amount);

    // --- Record 3: block 188102397, NEAR -0.000735 (intents swap gas) ---
    // Path C: executor_id = DAO, receiver_id = petersalomonsen.near, trigger block 188102395
    // tx_status resolves receipt block to 188102397.
    let r3 =
        find(188_102_397, "near").expect("Missing: block 188102397 NEAR (intents swap gas cost)");
    assert!(
        r3.amount.starts_with("-0.000"),
        "Expected small negative amount, got {}",
        r3.amount
    );
    println!("Record 3 OK: block=188102397 NEAR {}", r3.amount);

    // --- Record 4: block 188102398, intents USDC -10 ---
    // Path A: mt_burn log event from intents.near mentioning DAO as owner_id
    // tx_status resolves receipt block to 188102398.
    let intents_usdc =
        "intents.near:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
    let r4 = find(188_102_398, intents_usdc)
        .expect("Missing: block 188102398 intents USDC (intents swap)");
    assert_eq!(r4.amount, "-10", "Expected -10 USDC, got {}", r4.amount);
    println!("Record 4 OK: block=188102398 intents USDC {}", r4.amount);

    // --- Record 5: block 188102401, NEAR -0.0999 (intents.near settlement) ---
    // This is a NEAR balance change from the intents swap settlement. No Goldsky
    // outcome for this — enrichment cannot find it without maintenance.
    // For now, only check it if present (maintenance would fill this gap).
    if let Some(r5) = find(188_102_401, "near") {
        assert!(
            r5.amount.starts_with("-0.09"),
            "Expected amount ~-0.0999, got {}",
            r5.amount
        );
        assert_eq!(r5.counterparty.as_deref(), Some("intents.near"));
        println!("Record 5 OK: block=188102401 NEAR {}", r5.amount);
    } else {
        println!("Record 5 SKIPPED: block=188102401 NEAR (intents settlement — needs maintenance)");
    }

    println!("\nExpected production records verified (enrichment-only).");
}

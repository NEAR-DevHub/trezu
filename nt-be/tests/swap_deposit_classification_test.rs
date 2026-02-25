//! Integration test for swap deposit classification pipeline
//!
//! Uses the real USDC→SOL swap from trezu-demo.sputnik-dao.near:
//!   - Deposit: block 187016354, -10 USDC via on_proposal_callback
//!   - Fulfillment: block 187016381, +0.125207473 SOL (intents.near:nep141:sol.omft.near)
//!
//! Tests three scenarios:
//! 1. Intents API has the swap → detect_swaps_from_api links both legs, proposal classifier is no-op
//! 2. Intents API empty → proposal classifier creates deposit row from RPC/proposal
//! 3. Intents API links fulfillment only → proposal classifier updates existing row with deposit

mod common;

use nt_be::handlers::balance_changes::swap_detector::{
    classify_proposal_swap_deposits, detect_swaps_from_api, store_detected_swaps,
};
use sqlx::PgPool;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

const ACCOUNT_ID: &str = "trezu-demo.sputnik-dao.near";
const USDC_TOKEN: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const INTENTS_SOL_TOKEN: &str = "intents.near:nep141:sol.omft.near";
const DEPOSIT_BLOCK: i64 = 187016354;
const FULFILLMENT_BLOCK: i64 = 187016381;
const DEPOSIT_TX: &str = "5sMqhZhV1Bxx4EZij4zX5f93Xx9jt17LHZZ7tCcvqTSB";
const DEPOSIT_RECEIPT: &str = "2xQ8XqpWLxLkPeyEuyFnQD9yM1So1NMJW9fvKjJQf52v";
const FULFILLMENT_TX: &str = "8hmvQmSAMGWVTDP5nwpRo3SQwdWDiP1HMmAvg2C4MUDn";

/// Insert the test balance_changes and monitored_accounts records
async fn setup_test_data(pool: &PgPool) -> sqlx::Result<(i64, i64)> {
    // Insert monitored account
    sqlx::query!(
        r#"
        INSERT INTO monitored_accounts (account_id, enabled)
        VALUES ($1, true)
        ON CONFLICT (account_id) DO UPDATE SET enabled = true
        "#,
        ACCOUNT_ID
    )
    .execute(pool)
    .await?;

    // Clean up any existing test data
    sqlx::query!(
        "DELETE FROM detected_swaps WHERE account_id = $1",
        ACCOUNT_ID
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        "DELETE FROM balance_changes WHERE account_id = $1 AND block_height IN ($2, $3)",
        ACCOUNT_ID,
        DEPOSIT_BLOCK,
        FULFILLMENT_BLOCK,
    )
    .execute(pool)
    .await?;

    // Insert deposit balance_change (USDC, -10, on_proposal_callback)
    sqlx::query!(
        r#"
        INSERT INTO balance_changes
        (account_id, token_id, block_height, block_timestamp, block_time, amount,
         balance_before, balance_after, transaction_hashes, receipt_id,
         counterparty, signer_id, receiver_id, actions, raw_data,
         action_kind, method_name)
        VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (account_id, block_height, token_id) DO NOTHING
        "#,
        ACCOUNT_ID,
        USDC_TOKEN,
        DEPOSIT_BLOCK,
        1740447876421i64, // approximate block_timestamp
        sqlx::types::BigDecimal::from(-10),
        sqlx::types::BigDecimal::from(60),
        sqlx::types::BigDecimal::from(50),
        &vec![DEPOSIT_TX.to_string()] as &[String],
        &vec![DEPOSIT_RECEIPT.to_string()] as &[String],
        ACCOUNT_ID,
        ACCOUNT_ID,
        ACCOUNT_ID,
        serde_json::json!({}),
        serde_json::json!({}),
        "FunctionCall",
        "on_proposal_callback",
    )
    .execute(pool)
    .await?;

    // Insert fulfillment balance_change (intents SOL, +0.125207473)
    sqlx::query!(
        r#"
        INSERT INTO balance_changes
        (account_id, token_id, block_height, block_timestamp, block_time, amount,
         balance_before, balance_after, transaction_hashes, receipt_id,
         counterparty, actions, raw_data)
        VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (account_id, block_height, token_id) DO NOTHING
        "#,
        ACCOUNT_ID,
        INTENTS_SOL_TOKEN,
        FULFILLMENT_BLOCK,
        1740447892120i64,
        sqlx::types::BigDecimal::try_from(0.125207473f64).unwrap(),
        sqlx::types::BigDecimal::from(0),
        sqlx::types::BigDecimal::try_from(0.125207473f64).unwrap(),
        &vec![FULFILLMENT_TX.to_string()] as &[String],
        &Vec::<String>::new() as &[String],
        "UNKNOWN",
        serde_json::json!({}),
        serde_json::json!({}),
    )
    .execute(pool)
    .await?;

    // Get the inserted IDs
    let deposit_id: (i64,) = sqlx::query_as(
        "SELECT id FROM balance_changes WHERE account_id = $1 AND block_height = $2 AND token_id = $3",
    )
    .bind(ACCOUNT_ID)
    .bind(DEPOSIT_BLOCK)
    .bind(USDC_TOKEN)
    .fetch_one(pool)
    .await?;

    let fulfillment_id: (i64,) = sqlx::query_as(
        "SELECT id FROM balance_changes WHERE account_id = $1 AND block_height = $2 AND token_id = $3",
    )
    .bind(ACCOUNT_ID)
    .bind(FULFILLMENT_BLOCK)
    .bind(INTENTS_SOL_TOKEN)
    .fetch_one(pool)
    .await?;

    Ok((deposit_id.0, fulfillment_id.0))
}

/// Build the mock Intents Explorer API JSON response for the USDC→SOL swap
fn intents_api_response_with_both_hashes() -> serde_json::Value {
    serde_json::json!([{
        "originAsset": format!("nep141:{}", USDC_TOKEN),
        "destinationAsset": "solana:So11111111111111111111111111111111111111112",
        "recipient": ACCOUNT_ID,
        "status": "SUCCESS",
        "amountInFormatted": "10",
        "amountOutFormatted": "0.125207473",
        "nearTxHashes": [DEPOSIT_TX, FULFILLMENT_TX]
    }])
}

/// Build mock response with only the fulfillment tx hash (no deposit hash)
fn intents_api_response_fulfillment_only() -> serde_json::Value {
    serde_json::json!([{
        "originAsset": format!("nep141:{}", USDC_TOKEN),
        "destinationAsset": "solana:So11111111111111111111111111111111111111112",
        "recipient": ACCOUNT_ID,
        "status": "SUCCESS",
        "amountInFormatted": "10",
        "amountOutFormatted": "0.125207473",
        "nearTxHashes": [FULFILLMENT_TX]
    }])
}

/// Start a wiremock server that returns the given response for /transactions
async fn start_mock_intents_server(response: &serde_json::Value) -> MockServer {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/transactions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .mount(&mock_server)
        .await;
    mock_server
}

/// Scenario 1: Intents API has the swap → both legs linked, proposal classifier is no-op
#[sqlx::test]
async fn test_swap_detection_with_intents_api(pool: PgPool) -> sqlx::Result<()> {
    common::load_test_env();
    let network = common::create_archival_network();

    let (deposit_id, fulfillment_id) = setup_test_data(&pool).await?;
    println!(
        "deposit_id={}, fulfillment_id={}",
        deposit_id, fulfillment_id
    );

    // Set up wiremock with full response (both tx hashes)
    let mock_server = start_mock_intents_server(&intents_api_response_with_both_hashes()).await;

    // Step 1: detect_swaps_from_api should find the swap and link both legs
    let swaps = detect_swaps_from_api(&pool, ACCOUNT_ID, Some("test_key"), &mock_server.uri())
        .await
        .map_err(|e| sqlx::Error::Io(std::io::Error::other(e.to_string())))?;

    println!("Detected {} swap(s)", swaps.len());
    assert_eq!(swaps.len(), 1, "Should detect exactly 1 swap");
    assert_eq!(
        swaps[0].fulfillment_balance_change_id, fulfillment_id,
        "Should link to correct fulfillment"
    );
    assert_eq!(
        swaps[0].deposit_balance_change_id,
        Some(deposit_id),
        "Should link deposit via tx hash fallback"
    );

    // Step 2: Store the swaps
    let stored = store_detected_swaps(&pool, &swaps)
        .await
        .map_err(|e| sqlx::Error::Io(std::io::Error::other(e.to_string())))?;
    assert_eq!(stored, 1, "Should store 1 swap");

    // Step 3: classify_proposal_swap_deposits should be a no-op (deposit already linked)
    let classified = classify_proposal_swap_deposits(&pool, &network, ACCOUNT_ID)
        .await
        .map_err(|e| sqlx::Error::Io(std::io::Error::other(e.to_string())))?;
    assert_eq!(classified, 0, "Should not classify any (already linked)");

    // Step 4: Verify only 1 row in detected_swaps
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM detected_swaps WHERE account_id = $1")
        .bind(ACCOUNT_ID)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        count.0, 1,
        "Should have exactly 1 detected_swaps row (no duplicates)"
    );

    println!("\n✓ test_swap_detection_with_intents_api passed!");
    Ok(())
}

/// Scenario 2: Intents API empty → proposal classifier creates deposit row from RPC
#[sqlx::test]
async fn test_swap_detection_without_intents_api(pool: PgPool) -> sqlx::Result<()> {
    common::load_test_env();
    let network = common::create_archival_network();

    let (deposit_id, _fulfillment_id) = setup_test_data(&pool).await?;
    println!("deposit_id={}", deposit_id);

    // Set up wiremock returning empty array
    let mock_server = start_mock_intents_server(&serde_json::json!([])).await;

    // Step 1: detect_swaps_from_api returns nothing
    let swaps = detect_swaps_from_api(&pool, ACCOUNT_ID, Some("test_key"), &mock_server.uri())
        .await
        .map_err(|e| sqlx::Error::Io(std::io::Error::other(e.to_string())))?;

    assert!(swaps.is_empty(), "Should detect no swaps from empty API");

    // Step 2: classify_proposal_swap_deposits should create a record from the proposal
    let classified = classify_proposal_swap_deposits(&pool, &network, ACCOUNT_ID)
        .await
        .map_err(|e| sqlx::Error::Io(std::io::Error::other(e.to_string())))?;
    println!("  classified={}", classified);
    assert_eq!(classified, 1, "Should classify 1 deposit from proposal");

    // Step 3: Verify the created row
    let rows = sqlx::query!(
        r#"
        SELECT deposit_balance_change_id, received_token_id, solver_transaction_hash,
               sent_token_id, sent_amount::TEXT as "sent_amount"
        FROM detected_swaps
        WHERE account_id = $1
        "#,
        ACCOUNT_ID
    )
    .fetch_all(&pool)
    .await?;

    println!("  detected_swaps rows: {}", rows.len());
    for r in &rows {
        println!(
            "    solver_tx={} deposit_bc_id={:?} received_token={} sent_token={:?}",
            r.solver_transaction_hash,
            r.deposit_balance_change_id,
            r.received_token_id,
            r.sent_token_id
        );
    }

    let row = &rows[0];

    assert_eq!(
        row.deposit_balance_change_id,
        Some(deposit_id),
        "Should have deposit_balance_change_id set"
    );
    assert!(
        row.solver_transaction_hash.starts_with("proposal-deposit-"),
        "Should use proposal-deposit prefix: {}",
        row.solver_transaction_hash
    );
    // received_token_id comes from the proposal's Token Out Address field,
    // normalized with "intents.near:" prefix so the frontend can resolve metadata
    assert!(
        row.received_token_id.starts_with("intents.near:nep141:"),
        "Should have intents.near: prefixed received_token_id, got: {}",
        row.received_token_id
    );
    println!(
        "  received_token_id = '{}', solver_tx = '{}'",
        row.received_token_id, row.solver_transaction_hash
    );

    println!("\n✓ test_swap_detection_without_intents_api passed!");
    Ok(())
}

/// Scenario 3: Intents API creates row without deposit → proposal classifier links it
#[sqlx::test]
async fn test_intents_api_then_proposal_classification_links(pool: PgPool) -> sqlx::Result<()> {
    common::load_test_env();
    let network = common::create_archival_network();

    let (deposit_id, fulfillment_id) = setup_test_data(&pool).await?;
    println!(
        "deposit_id={}, fulfillment_id={}",
        deposit_id, fulfillment_id
    );

    // Set up wiremock with only fulfillment tx hash (no deposit hash)
    // This simulates the intents API not providing the deposit tx hash
    let mock_server = start_mock_intents_server(&intents_api_response_fulfillment_only()).await;

    // Step 1: detect_swaps_from_api creates row without deposit link
    let swaps = detect_swaps_from_api(&pool, ACCOUNT_ID, Some("test_key"), &mock_server.uri())
        .await
        .map_err(|e| sqlx::Error::Io(std::io::Error::other(e.to_string())))?;

    assert_eq!(swaps.len(), 1, "Should detect 1 swap");
    assert_eq!(
        swaps[0].deposit_balance_change_id, None,
        "Deposit should NOT be linked (no deposit tx hash in API)"
    );

    // Step 2: Store the swap
    store_detected_swaps(&pool, &swaps)
        .await
        .map_err(|e| sqlx::Error::Io(std::io::Error::other(e.to_string())))?;

    // Verify deposit_balance_change_id is NULL
    let row_before = sqlx::query!(
        "SELECT deposit_balance_change_id FROM detected_swaps WHERE account_id = $1",
        ACCOUNT_ID
    )
    .fetch_one(&pool)
    .await?;
    assert!(
        row_before.deposit_balance_change_id.is_none(),
        "deposit_balance_change_id should be NULL before classification"
    );

    // Step 3: classify_proposal_swap_deposits should UPDATE the existing row
    let classified = classify_proposal_swap_deposits(&pool, &network, ACCOUNT_ID)
        .await
        .map_err(|e| sqlx::Error::Io(std::io::Error::other(e.to_string())))?;
    assert_eq!(
        classified, 1,
        "Should classify 1 deposit (linked to existing intents row)"
    );

    // Step 4: Verify still only 1 row (no duplicate)
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM detected_swaps WHERE account_id = $1")
        .bind(ACCOUNT_ID)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        count.0, 1,
        "Should have exactly 1 row (updated, not duplicated)"
    );

    // Step 5: Verify deposit is now linked
    let row_after = sqlx::query!(
        "SELECT deposit_balance_change_id, received_token_id FROM detected_swaps WHERE account_id = $1",
        ACCOUNT_ID
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        row_after.deposit_balance_change_id,
        Some(deposit_id),
        "deposit_balance_change_id should now be set"
    );
    // received_token_id should still be the intents token (not overwritten)
    assert_eq!(
        row_after.received_token_id, INTENTS_SOL_TOKEN,
        "received_token_id should remain the intents SOL token"
    );

    println!("\n✓ test_intents_api_then_proposal_classification_links passed!");
    Ok(())
}

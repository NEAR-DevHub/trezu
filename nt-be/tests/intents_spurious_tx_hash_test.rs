mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use nt_be::handlers::balance_changes::account_monitor::run_maintenance_cycle;
use nt_be::handlers::balance_changes::gap_filler::resolve_missing_tx_hashes;
use nt_be::routes::create_routes;
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt;

/// Regression test: intents token balance changes should not include unrelated transaction hashes.
///
/// ## Bug (#209)
///
/// When inserting a balance change for an `intents.near:*` token, the gap filler falls back to
/// querying ALL `account_changes` on the `intents.near` contract at the block height. Because
/// `intents.near` is a very busy contract, this picks up transaction hashes from completely
/// unrelated swaps that happened to execute in the same block.
///
/// ## Scenario (block 185177656)
///
/// At block 185177656, two unrelated transactions modified `intents.near` state:
///
/// 1. `GMNc4frysxebrScso3pqp4mrsEQ746avXsDLh5rYS1Dj`
///    - NEAR/SWEAT/USDT swap for solver-priv-liq.near → hideon.near
///    - Has nothing to do with testing-astradao or USDC
///
/// 2. `7od1Cvz8Y6eUFqJQhNSLNYswn14ZhRjxgvwaNV8Kjrwk`
///    - USDC→USDT swap settling to testing-astradao.sputnik-dao.near
///    - This is the actual relevant transaction
///
/// The bug causes BOTH hashes to be stored in the balance change record's `transaction_hashes`.
///
/// ## Test approach
///
/// Uses the maintenance cycle flow (same code path as production):
/// 1. Register account via API (sets dirty_at)
/// 2. Run `run_maintenance_cycle` which discovers intents tokens and fills gaps
/// 3. Verify the balance change at block 185177656 only contains the relevant tx hash
/// 4. Clear tx hashes (simulating the migration) and call `resolve_missing_tx_hashes` directly
/// 5. Verify re-resolved hashes still only contain the relevant tx hash (not the spurious one)
///
/// ## Expected behavior
///
/// Only `7od1Cvz8Y6eUFqJQhNSLNYswn14ZhRjxgvwaNV8Kjrwk` should appear in `transaction_hashes`
/// since `GMNc4frysxebrScso3pqp4mrsEQ746avXsDLh5rYS1Dj` is completely unrelated.
#[sqlx::test]
async fn test_intents_token_should_not_include_unrelated_tx_hashes(
    pool: PgPool,
) -> sqlx::Result<()> {
    let account_id = "testing-astradao.sputnik-dao.near";
    let intents_usdc_token =
        "intents.near:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
    let target_block: i64 = 185_177_656;

    // The tx hash from the actual USDC→USDT swap for this account
    let relevant_tx = "7od1Cvz8Y6eUFqJQhNSLNYswn14ZhRjxgvwaNV8Kjrwk";
    // The tx hash from an unrelated NEAR/SWEAT/USDT swap for hideon.near
    let unrelated_tx = "GMNc4frysxebrScso3pqp4mrsEQ746avXsDLh5rYS1Dj";

    let state = Arc::new(common::build_test_state(pool.clone()));

    println!("\n=== Regression Test: Spurious Transaction Hashes on Intents Tokens ===\n");
    println!("Account:  {}", account_id);
    println!("Token:    {}", intents_usdc_token);
    println!("Block:    {}", target_block);
    println!("Relevant: {}", relevant_tx);
    println!("Spurious: {}\n", unrelated_tx);

    // Ensure no pre-existing records for this account/token/block
    let pre_existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM balance_changes WHERE account_id = $1 AND token_id = $2 AND block_height = $3",
    )
    .bind(account_id)
    .bind(intents_usdc_token)
    .bind(target_block)
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        pre_existing, 0,
        "Database should not contain the target record before maintenance cycle runs"
    );

    // Register the account via the API (POST /api/monitored-accounts) — sets dirty_at = NOW()
    let app = create_routes(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/monitored-accounts")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "accountId": account_id }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "API should accept the account"
    );
    println!("Account registered and marked dirty");

    // Verify the account is dirty
    let dirty_at: (Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>,) =
        sqlx::query_as("SELECT dirty_at FROM monitored_accounts WHERE account_id = $1")
            .bind(account_id)
            .fetch_one(&pool)
            .await?;
    assert!(
        dirty_at.0.is_some(),
        "Account should be marked dirty after API registration"
    );

    // Run maintenance cycle at a fixed block to keep the test deterministic.
    // Block 185_200_000 keeps the target block (185_177_656) within the 600k lookback window.
    let fixed_up_to_block = 185_200_000;

    println!(
        "Running maintenance cycle at block {}...",
        fixed_up_to_block
    );

    run_maintenance_cycle(&state, fixed_up_to_block)
        .await
        .expect("Maintenance cycle should succeed");

    println!("Maintenance cycle completed");

    // Verify the intents USDC token was discovered and the target block was filled
    let record = sqlx::query!(
        r#"
        SELECT
            block_height,
            transaction_hashes,
            counterparty,
            amount::TEXT as "amount!",
            balance_before::TEXT as "balance_before!",
            balance_after::TEXT as "balance_after!"
        FROM balance_changes
        WHERE account_id = $1 AND token_id = $2 AND block_height = $3
        "#,
        account_id,
        intents_usdc_token,
        target_block
    )
    .fetch_optional(&pool)
    .await?
    .expect(
        "Maintenance cycle should have discovered intents USDC token and filled block 185177656",
    );

    println!(
        "Balance:  {} -> {}",
        record.balance_before, record.balance_after
    );
    println!("Amount:   {}", record.amount);
    println!("Counterparty: {}", record.counterparty);
    println!(
        "Transaction hashes ({}): {:?}",
        record.transaction_hashes.len(),
        record.transaction_hashes
    );

    // The relevant transaction should be present
    assert!(
        record.transaction_hashes.contains(&relevant_tx.to_string()),
        "Should contain the relevant tx hash {} but got: {:?}",
        relevant_tx,
        record.transaction_hashes
    );

    // The unrelated transaction should NOT be present
    assert!(
        !record
            .transaction_hashes
            .contains(&unrelated_tx.to_string()),
        "Should NOT contain the unrelated tx hash {} (NEAR/SWEAT/USDT swap for hideon.near) but got: {:?}",
        unrelated_tx,
        record.transaction_hashes
    );

    // There should be exactly one transaction hash
    assert_eq!(
        record.transaction_hashes.len(),
        1,
        "Should have exactly 1 transaction hash, not {} — extra hashes are from unrelated intents.near state changes in the same block",
        record.transaction_hashes.len()
    );

    // === Part 2: Verify resolve_missing_tx_hashes doesn't re-introduce spurious hashes ===
    //
    // This reproduces the production scenario where the migration clears multi-hash records
    // and then resolve_missing_tx_hashes re-resolves them. Before the fix, this would
    // re-populate with the same spurious data.

    println!("\n--- Part 2: resolve_missing_tx_hashes regression ---");

    // Simulate the migration: clear tx hashes so the record has empty transaction_hashes
    sqlx::query!(
        "UPDATE balance_changes SET transaction_hashes = '{}' WHERE account_id = $1 AND token_id = $2 AND block_height = $3",
        account_id,
        intents_usdc_token,
        target_block,
    )
    .execute(&pool)
    .await?;

    // Verify the hashes are actually cleared
    let cleared: Vec<String> = sqlx::query_scalar(
        "SELECT unnest(transaction_hashes) FROM balance_changes WHERE account_id = $1 AND token_id = $2 AND block_height = $3",
    )
    .bind(account_id)
    .bind(intents_usdc_token)
    .bind(target_block)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();
    assert!(
        cleared.is_empty(),
        "Transaction hashes should be empty after simulated migration"
    );
    println!("Cleared transaction_hashes (simulating migration)");

    // Now call resolve_missing_tx_hashes — the same function the maintenance worker calls
    let resolved = resolve_missing_tx_hashes(&pool, &state.archival_network, account_id, 10)
        .await
        .expect("resolve_missing_tx_hashes should succeed");
    println!("resolve_missing_tx_hashes resolved {} records", resolved);

    // Re-fetch the record and verify the same assertions hold
    let re_resolved = sqlx::query!(
        r#"
        SELECT transaction_hashes
        FROM balance_changes
        WHERE account_id = $1 AND token_id = $2 AND block_height = $3
        "#,
        account_id,
        intents_usdc_token,
        target_block
    )
    .fetch_one(&pool)
    .await?;

    println!(
        "Re-resolved transaction hashes ({}): {:?}",
        re_resolved.transaction_hashes.len(),
        re_resolved.transaction_hashes
    );

    // The relevant transaction should be present after re-resolution
    assert!(
        re_resolved
            .transaction_hashes
            .contains(&relevant_tx.to_string()),
        "After re-resolution: should contain the relevant tx hash {} but got: {:?}",
        relevant_tx,
        re_resolved.transaction_hashes
    );

    // The unrelated transaction should NOT be present after re-resolution
    assert!(
        !re_resolved
            .transaction_hashes
            .contains(&unrelated_tx.to_string()),
        "After re-resolution: should NOT contain the unrelated tx hash {} but got: {:?}",
        unrelated_tx,
        re_resolved.transaction_hashes
    );

    // There should be exactly one transaction hash after re-resolution
    assert_eq!(
        re_resolved.transaction_hashes.len(),
        1,
        "After re-resolution: should have exactly 1 transaction hash, not {}",
        re_resolved.transaction_hashes.len()
    );

    println!("\n=== All assertions passed (including resolve_missing_tx_hashes) ===");

    Ok(())
}

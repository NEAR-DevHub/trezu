mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use nt_be::handlers::balance_changes::dirty_monitor::run_dirty_monitor_at_block;
use nt_be::routes::create_routes;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tower::ServiceExt;

/// Integration test: dirty monitor discovers intents tokens and fills gaps.
///
/// Real scenario from yurtur-treasury.sputnik-dao.near:
/// - Account holds intents.near:nep141:btc.omft.near (BTC via NEAR Intents)
/// - No prior balance_changes records exist for this intents token
/// - Dirty monitor should discover the token via mt_tokens_for_owner and fill gaps
///
/// This verifies the full dirty monitor flow: discover_intents_tokens + fill_dirty_account_gaps.
#[sqlx::test]
async fn test_dirty_monitor_discovers_intents_tokens(pool: PgPool) -> sqlx::Result<()> {
    let account_id = "yurtur-treasury.sputnik-dao.near";
    let intents_token = "intents.near:nep141:btc.omft.near";

    let state = Arc::new(common::build_test_state(pool.clone()));

    // Register the account via the API (POST /api/monitored-accounts)
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

    // Verify the account is dirty (API sets dirty_at = NOW())
    let dirty_at: (Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>,) =
        sqlx::query_as("SELECT dirty_at FROM monitored_accounts WHERE account_id = $1")
            .bind(account_id)
            .fetch_one(&pool)
            .await?;
    assert!(
        dirty_at.0.is_some(),
        "Account should be marked dirty after API registration"
    );

    // Verify no intents token records exist yet
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM balance_changes WHERE account_id = $1 AND token_id = $2",
    )
    .bind(account_id)
    .bind(intents_token)
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 0, "Should have no intents token records initially");

    // Run dirty monitor at a fixed block to keep the test deterministic.
    // This block keeps the known deposit (185171271) within the 600k lookback window.
    let fixed_up_to_block = 185_500_000;

    // Run the dirty monitor — it will spawn a task for the dirty account
    let mut active_tasks: HashMap<String, JoinHandle<()>> = HashMap::new();
    run_dirty_monitor_at_block(&state, &mut active_tasks, fixed_up_to_block).await;

    assert_eq!(
        active_tasks.len(),
        1,
        "Should spawn one task for the dirty account"
    );

    // Wait for the spawned task to complete
    let handle = active_tasks.remove(account_id).expect("Task should exist");
    handle.await.expect("Task should not panic");

    // Verify intents token was discovered and gaps were filled
    let records = sqlx::query!(
        r#"
        SELECT block_height, counterparty,
               balance_before::TEXT as "balance_before!",
               balance_after::TEXT as "balance_after!"
        FROM balance_changes
        WHERE account_id = $1 AND token_id = $2
        ORDER BY block_height ASC
        "#,
        account_id,
        intents_token
    )
    .fetch_all(&pool)
    .await?;

    println!("Found {} records for {}", records.len(), intents_token);
    for r in &records {
        println!(
            "  block {}: {} -> {} (counterparty: {})",
            r.block_height, r.balance_before, r.balance_after, r.counterparty
        );
    }

    assert!(
        !records.is_empty(),
        "Dirty monitor should have discovered intents token and created balance records"
    );

    // Verify chain consistency for discovered intents token records.
    // This is stable even as chain head advances over time.
    use bigdecimal::BigDecimal;
    use std::str::FromStr;
    for pair in records.windows(2) {
        let prev = &pair[0];
        let next = &pair[1];
        assert_eq!(
            BigDecimal::from_str(&prev.balance_after).unwrap(),
            BigDecimal::from_str(&next.balance_before).unwrap(),
            "Balance chain must be continuous between blocks {} and {}",
            prev.block_height,
            next.block_height
        );
    }

    // Verify the exact BTC deposit at block 185171271.
    // With fixed up_to_block, this remains within historical lookback deterministically.
    let btc_deposit = sqlx::query!(
        r#"
        SELECT block_height, block_time,
               amount::TEXT as "amount!",
               balance_before::TEXT as "balance_before!",
               balance_after::TEXT as "balance_after!",
               counterparty
        FROM balance_changes
        WHERE account_id = $1 AND token_id = $2 AND block_height = 185171271
        "#,
        account_id,
        intents_token
    )
    .fetch_one(&pool)
    .await
    .expect("Should find BTC deposit at block 185171271");

    println!(
        "BTC deposit: block {} at {}, amount {}, {} -> {} (counterparty: {})",
        btc_deposit.block_height,
        btc_deposit.block_time,
        btc_deposit.amount,
        btc_deposit.balance_before,
        btc_deposit.balance_after,
        btc_deposit.counterparty
    );

    assert_eq!(
        BigDecimal::from_str(&btc_deposit.balance_before).unwrap(),
        BigDecimal::from_str("0").unwrap(),
        "Balance before should be 0"
    );
    assert_eq!(
        BigDecimal::from_str(&btc_deposit.balance_after).unwrap(),
        BigDecimal::from_str("0.00374124").unwrap(),
        "Balance after should be 0.00374124 BTC"
    );
    assert_eq!(
        BigDecimal::from_str(&btc_deposit.amount).unwrap(),
        BigDecimal::from_str("0.00374124").unwrap(),
        "Amount should be 0.00374124 BTC"
    );
    // Block time should be 2026-02-12 02:22:02 UTC
    assert_eq!(
        btc_deposit.block_time.date_naive().to_string(),
        "2026-02-12",
        "Block date should be 2026-02-12"
    );

    // Dirty flag should be cleared after successful processing
    let dirty_at: (Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>,) =
        sqlx::query_as("SELECT dirty_at FROM monitored_accounts WHERE account_id = $1")
            .bind(account_id)
            .fetch_one(&pool)
            .await?;
    assert!(
        dirty_at.0.is_none(),
        "Dirty flag should be cleared after successful processing"
    );

    Ok(())
}

//! Integration test for bulk payment worker
//!
//! Reproduces the bug where the worker calls payout_batch for a list that has
//! zero pending payments (all payments already Paid). The worker should detect
//! this from the view_list response and remove the list from the queue without
//! making an unnecessary transaction call.
//!
//! Uses real mainnet list_id: 9945024033f352fc2070510dbf3866b959a2b2a1da8a22b3e24b448ec65f64bf
//! on bulkpayment.near — this list has status "Approved" but both payments are "Paid".

mod common;

use nt_be::handlers::bulkpayment::worker::{add_pending_list, query_and_process_pending_lists};
use sqlx::PgPool;
use std::sync::Arc;

/// List on bulkpayment.near with status "Approved" but all payments already "Paid"
const FULLY_PAID_LIST_ID: &str = "9945024033f352fc2070510dbf3866b959a2b2a1da8a22b3e24b448ec65f64bf";

/// Test: worker should NOT call payout_batch for a list with zero pending payments.
///
/// This list exists on mainnet (bulkpayment.near) with:
/// - status: "Approved"
/// - payments: 2 recipients, both with status { "Paid": { block_height: ... } }
///
/// The worker should detect that all payments are already paid from the view_list
/// response and remove the list from the queue without attempting payout_batch.
#[sqlx::test]
async fn test_worker_skips_payout_for_fully_paid_list(pool: PgPool) -> sqlx::Result<()> {
    common::load_test_env();

    println!("\n=== Bulk Payment Worker: Zero Pending Payments Test ===");
    println!("List ID: {}", FULLY_PAID_LIST_ID);

    // Add the fully-paid list to the worker queue
    add_pending_list(&pool, FULLY_PAID_LIST_ID)
        .await
        .map_err(|e| sqlx::Error::Io(std::io::Error::other(e.to_string())))?;

    // Verify it's in the queue
    let row = sqlx::query!(
        "SELECT list_id FROM pending_payment_lists WHERE list_id = $1",
        FULLY_PAID_LIST_ID
    )
    .fetch_one(&pool)
    .await?;
    println!("List added to queue: {}", row.list_id);

    // Build AppState — uses mainnet RPC for view calls
    let state = Arc::new(
        nt_be::AppState::builder()
            .db_pool(pool.clone())
            .build()
            .await
            .expect("Failed to build AppState"),
    );

    // Run the worker
    println!("Running worker...");
    let processed = query_and_process_pending_lists(&state)
        .await
        .expect("Worker should not error");

    println!("Batches processed: {}", processed);
    assert_eq!(processed, 0, "No batches should have been processed");

    // The list should have been marked as completed (completed_at set)
    let row = sqlx::query!(
        "SELECT completed_at FROM pending_payment_lists WHERE list_id = $1",
        FULLY_PAID_LIST_ID
    )
    .fetch_one(&pool)
    .await?;

    assert!(
        row.completed_at.is_some(),
        "List with zero pending payments should have been marked as completed. \
         BUG: Worker called payout_batch instead of detecting all payments are already Paid."
    );

    println!(
        "List correctly marked as completed at {:?} (no payout_batch call needed)",
        row.completed_at.unwrap()
    );
    println!("\nTest passed!");

    Ok(())
}

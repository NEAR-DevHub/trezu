//! The detector classifies `dao_proposals.proposal_kind` JSON after a
//! Postgres JSONB round-trip — these tests pin that the payload written to
//! `dao_notifications` carries the classified kind and description.

mod common;

use sqlx::PgPool;

const DAO_ID: &str = "test-decoder-dao.sputnik-dao.near";
const CHAT_ID: i64 = 1122334455;

async fn insert_dao_with_telegram(pool: &PgPool) {
    sqlx::query("INSERT INTO monitored_accounts (account_id, enabled) VALUES ($1, true)")
        .bind(DAO_ID)
        .execute(pool)
        .await
        .expect("insert monitored account");

    sqlx::query("INSERT INTO telegram_chats (chat_id, chat_title) VALUES ($1, $2)")
        .bind(CHAT_ID)
        .bind("Decoder Test Chat")
        .execute(pool)
        .await
        .expect("insert telegram chat");

    sqlx::query("INSERT INTO telegram_treasury_connections (dao_id, chat_id) VALUES ($1, $2)")
        .bind(DAO_ID)
        .bind(CHAT_ID)
        .execute(pool)
        .await
        .expect("insert telegram connection");
}

async fn reset_proposals_cursor(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO goldsky_cursors (consumer_name, last_processed_id, last_processed_block, updated_at)
         VALUES ('notifications:dao_proposals', '0', 0, NOW())
         ON CONFLICT (consumer_name) DO UPDATE SET
           last_processed_id = '0', last_processed_block = 0, updated_at = NOW()",
    )
    .execute(pool)
    .await
    .expect("reset dao_proposals cursor");
}

async fn insert_proposal_with_kind(
    pool: &PgPool,
    proposal_id: i64,
    description: &str,
    kind: serde_json::Value,
) -> i64 {
    sqlx::query_scalar(
        r#"
        INSERT INTO dao_proposals
            (dao_id, proposal_id, status, proposal_kind, proposer, description,
             proposal_created_at, proposal_creation_block_height)
        VALUES ($1, $2, 'in_progress', $3, 'alice.near', $4, NOW(), 100)
        RETURNING id
        "#,
    )
    .bind(DAO_ID)
    .bind(proposal_id)
    .bind(kind)
    .bind(description)
    .fetch_one(pool)
    .await
    .expect("insert dao_proposal")
}

#[sqlx::test]
async fn test_detector_classifies_transfer_kind_from_db(pool: PgPool) {
    common::load_test_env();
    insert_dao_with_telegram(&pool).await;
    reset_proposals_cursor(&pool).await;

    let kind = serde_json::json!({
        "Transfer": {"receiver_id": "alice.near", "amount": "1", "token_id": "usdc.near"}
    });
    insert_proposal_with_kind(&pool, 1, "Pay Alice", kind).await;

    let detected = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("run detection");
    assert_eq!(detected, 1, "one add_proposal notification expected");

    let payload: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM dao_notifications WHERE source_table = 'dao_proposals' AND event_type = 'add_proposal'",
    )
    .fetch_one(&pool)
    .await
    .expect("fetch dao_notifications payload");

    assert_eq!(
        payload.get("description").and_then(|v| v.as_str()),
        Some("Pay Alice")
    );
    assert_eq!(
        payload.get("proposal_kind").and_then(|v| v.as_str()),
        Some("Payment")
    );
    assert_eq!(
        payload.get("counterparty").and_then(|v| v.as_str()),
        Some("alice.near")
    );
}

#[sqlx::test]
async fn test_detector_classifies_change_policy_kind_from_db(pool: PgPool) {
    common::load_test_env();
    insert_dao_with_telegram(&pool).await;
    reset_proposals_cursor(&pool).await;

    let kind = serde_json::json!({"ChangePolicyUpdateParameters": {"parameters": {}}});
    insert_proposal_with_kind(&pool, 2, "* Title: Update Policy", kind).await;

    let detected = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("run detection");
    assert_eq!(detected, 1);

    let payload: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM dao_notifications WHERE source_table = 'dao_proposals' AND event_type = 'add_proposal'",
    )
    .fetch_one(&pool)
    .await
    .expect("fetch dao_notifications payload");

    assert_eq!(
        payload.get("proposal_kind").and_then(|v| v.as_str()),
        Some("Change Policy")
    );
}

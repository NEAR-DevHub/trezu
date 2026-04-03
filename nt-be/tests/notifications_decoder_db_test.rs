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

async fn reset_balance_changes_cursor(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO goldsky_cursors (consumer_name, last_processed_id, last_processed_block, updated_at)
         VALUES ('notifications:balance_changes', '0', 0, NOW())
         ON CONFLICT (consumer_name) DO UPDATE SET
           last_processed_id = '0', last_processed_block = 0, updated_at = NOW()",
    )
    .execute(pool)
    .await
    .expect("reset balance_changes cursor");
}

async fn insert_add_proposal_balance_change(
    pool: &PgPool,
    block_height: i64,
    actions: serde_json::Value,
) -> i64 {
    sqlx::query_scalar(
        r#"
        INSERT INTO balance_changes
            (account_id, block_height, block_timestamp, block_time, token_id, amount,
             balance_before, balance_after, counterparty, transaction_hashes, receipt_id,
             method_name, action_kind, actions)
        VALUES ($1, $2, $3, $4, 'near', 0, 0, 0, 'alice.near', '{}', '{}',
                'add_proposal', 'FUNCTION_CALL', $5)
        RETURNING id
        "#,
    )
    .bind(DAO_ID)
    .bind(block_height)
    .bind(1_000_000_000_000i64)
    .bind(chrono::Utc::now())
    .bind(actions)
    .fetch_one(pool)
    .await
    .expect("insert add_proposal balance change")
}

#[sqlx::test]
async fn test_decoder_reads_nested_proposal_shape_from_db(pool: PgPool) {
    common::load_test_env();

    let actions = serde_json::json!([{
        "FunctionCall": {
            "method_name": "add_proposal",
            "args": "eyJwcm9wb3NhbCI6eyJkZXNjcmlwdGlvbiI6IlBheSBBbGljZSIsImtpbmQiOnsiVHJhbnNmZXIiOnsicmVjZWl2ZXJfaWQiOiJhbGljZS5uZWFyIiwiYW1vdW50IjoiMSIsInRva2VuX2lkIjoidXNkYy5uZWFyIn19fX0="
        }
    }]);

    let id = insert_add_proposal_balance_change(&pool, 100, actions).await;
    let db_actions: serde_json::Value =
        sqlx::query_scalar("SELECT actions FROM balance_changes WHERE id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .expect("fetch actions from db");

    let decoded = nt_be::handlers::notifications::payload_decoder::decode_add_proposal_payload(
        Some(&db_actions),
    );
    assert_eq!(decoded.description.as_deref(), Some("Pay Alice"));
    assert_eq!(decoded.proposal_kind.as_deref(), Some("Payment"));
}

#[sqlx::test]
async fn test_detector_writes_decoded_payload_for_top_level_shape(pool: PgPool) {
    common::load_test_env();
    insert_dao_with_telegram(&pool).await;
    reset_balance_changes_cursor(&pool).await;

    let actions = serde_json::json!([{
        "FunctionCall": {
            "method_name": "add_proposal",
            "args": "eyJkZXNjcmlwdGlvbiI6IkxlZ2FjeSBzaGFwZSIsImtpbmQiOnsiVHJhbnNmZXIiOnsicmVjZWl2ZXJfaWQiOiJhbGljZS5uZWFyIiwiYW1vdW50IjoiMSIsInRva2VuX2lkIjoiIn19fQ=="
        }
    }]);

    let source_id = insert_add_proposal_balance_change(&pool, 101, actions).await;

    let detected = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("run detection");
    assert_eq!(detected, 1, "one add_proposal notification expected");

    let payload: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM dao_notifications WHERE source_table = 'balance_changes' AND source_id = $1 AND event_type = 'add_proposal'",
    )
    .bind(source_id)
    .fetch_one(&pool)
    .await
    .expect("fetch dao_notifications payload");

    assert_eq!(
        payload.get("description").and_then(|v| v.as_str()),
        Some("Legacy shape")
    );
    assert_eq!(
        payload.get("proposal_kind").and_then(|v| v.as_str()),
        Some("Payment")
    );
}

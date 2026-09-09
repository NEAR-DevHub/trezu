/// End-to-end tests for the DAO notification system.
///
/// Tests the full pipeline:
///   gold ledger rows → inline emitter (projection-time) → dao_notifications
///   dao_proposals / confidential_intents → detection worker → dao_notifications
///   dao_notifications → Telegram dispatcher → dao_notification_deliveries
///
/// No real Telegram API calls are made — TelegramClient::default() has bot=None
/// and silently succeeds on all send operations.
///
/// ```bash
/// cargo test --test notifications_e2e_test -- --nocapture
/// ```
mod common;

use sqlx::PgPool;
use std::sync::Arc;

const DAO_ID: &str = "test-notif-dao.sputnik-dao.near";
const CHAT_ID: i64 = 987654321;

/// Run the inline emitter for one gold ledger row the way a projector would:
/// inside a transaction, right after the row upsert.
async fn emit_for_key(pool: &PgPool, gold_event_key: &str) -> u64 {
    let mut tx = pool.begin().await.expect("begin emit tx");
    let inserted = nt_be::handlers::notifications::emitter::emit_gold_ledger_notification(
        &mut tx,
        gold_event_key,
    )
    .await
    .expect("emit gold ledger notification");
    tx.commit().await.expect("commit emit tx");
    inserted
}

async fn build_dispatch_state(pool: &PgPool) -> Arc<nt_be::AppState> {
    Arc::new(
        nt_be::AppState::builder()
            .db_pool(pool.clone())
            .build()
            .await
            .expect("build AppState for notification dispatch"),
    )
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async fn insert_dao(pool: &PgPool) {
    sqlx::query("INSERT INTO monitored_accounts (account_id, enabled) VALUES ($1, true) ON CONFLICT DO NOTHING")
        .bind(DAO_ID)
        .execute(pool)
        .await
        .expect("insert monitored_account");
}

async fn insert_dao_with_telegram(pool: &PgPool) {
    insert_dao(pool).await;

    sqlx::query("INSERT INTO telegram_chats (chat_id, chat_title) VALUES ($1, $2)")
        .bind(CHAT_ID)
        .bind("Test Chat")
        .execute(pool)
        .await
        .expect("insert telegram_chat");

    sqlx::query("INSERT INTO telegram_treasury_connections (dao_id, chat_id) VALUES ($1, $2)")
        .bind(DAO_ID)
        .bind(CHAT_ID)
        .execute(pool)
        .await
        .expect("insert telegram_treasury_connection");
}

/// Insert a `sent` (payment) gold ledger row. Returns the inserted id.
async fn insert_ledger_payment(
    pool: &PgPool,
    gold_event_key: &str,
    token_out: &str,
    amount_out: &str,
    recipient: &str,
    event_time: chrono::DateTime<chrono::Utc>,
) -> i64 {
    sqlx::query_scalar(
        r#"
        INSERT INTO gold_treasury_ledger_events
            (gold_event_key, dao_id, source_kind, history_visible, transaction_type,
             status, event_time, token_out, amount_out, recipient)
        VALUES ($1, $2, 'public_silver_leg', true, 'sent', 'success', $3, $4, $5::numeric, $6)
        RETURNING id
        "#,
    )
    .bind(gold_event_key)
    .bind(DAO_ID)
    .bind(event_time)
    .bind(token_out)
    .bind(amount_out)
    .bind(recipient)
    .fetch_one(pool)
    .await
    .expect("insert ledger payment")
}

/// Insert a fulfilled `exchange` gold ledger row (both legs). Returns the id.
async fn insert_ledger_exchange(
    pool: &PgPool,
    gold_event_key: &str,
    sent_token: &str,
    sent_amount: &str,
    received_token: &str,
    received_amount: &str,
) -> i64 {
    sqlx::query_scalar(
        r#"
        INSERT INTO gold_treasury_ledger_events
            (gold_event_key, dao_id, source_kind, history_visible, transaction_type,
             status, event_time, token_out, amount_out, token_in, amount_in)
        VALUES ($1, $2, 'public_silver_leg', true, 'exchange', 'success', NOW(),
                $3, $4::numeric, $5, $6::numeric)
        RETURNING id
        "#,
    )
    .bind(gold_event_key)
    .bind(DAO_ID)
    .bind(sent_token)
    .bind(sent_amount)
    .bind(received_token)
    .bind(received_amount)
    .fetch_one(pool)
    .await
    .expect("insert ledger exchange")
}

/// Insert a dao_proposals row as the linker would after seeing the creation
/// receipt. Returns the inserted id.
async fn insert_proposal(
    pool: &PgPool,
    proposal_id: i64,
    proposer: &str,
    description: &str,
    created_at: chrono::DateTime<chrono::Utc>,
) -> i64 {
    sqlx::query_scalar(
        r#"
        INSERT INTO dao_proposals
            (dao_id, proposal_id, status, proposal_kind, proposer, description,
             proposal_created_at, proposal_creation_block_height,
             proposal_creation_transaction_hash)
        VALUES ($1, $2, 'in_progress',
                '{"Transfer": {"receiver_id": "alice.near", "amount": "1", "token_id": "usdc.near"}}',
                $3, $4, $5, 100, 'proposal-tx-hash')
        RETURNING id
        "#,
    )
    .bind(DAO_ID)
    .bind(proposal_id)
    .bind(proposer)
    .bind(description)
    .bind(created_at)
    .fetch_one(pool)
    .await
    .expect("insert dao_proposal")
}

/// Insert a confidential intent whose on-chain proposal has been linked.
async fn insert_confidential_intent(pool: &PgPool, proposal_id: i64, notes: &str) -> i32 {
    sqlx::query_scalar(
        r#"
        INSERT INTO confidential_intents
            (dao_id, intent_payload, payload_hash, status, notes,
             proposal_id, proposal_created_at, quote_metadata)
        VALUES ($1, '{}', $2, 'pending', $3, $4, NOW(),
                '{"quoteRequest": {"originAsset": "nep141:wrap.near", "destinationAsset": "nep141:wrap.near"}}')
        RETURNING id
        "#,
    )
    .bind(DAO_ID)
    .bind(format!("payload-hash-{proposal_id}"))
    .bind(notes)
    .bind(proposal_id)
    .fetch_one(pool)
    .await
    .expect("insert confidential intent")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Full happy-path: the emitter queues ledger events at projection time,
/// detection queues the proposal, dispatcher records deliveries.
#[sqlx::test]
async fn test_emission_detection_and_dispatch(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    let now = chrono::Utc::now();

    // add_proposal event
    insert_proposal(&pool, 1, "alice.near", "Pay Alice", now).await;

    // Outgoing FT payment + outgoing NEAR payment
    insert_ledger_payment(&pool, "pay-usdc", "usdc.near", "50", "bob.near", now).await;
    insert_ledger_payment(&pool, "pay-near", "near", "1.5", "carol.near", now).await;

    // Fulfilled exchange
    insert_ledger_exchange(
        &pool,
        "swap-1",
        "near",
        "5",
        "intents.near:nep141:usdc.near",
        "100",
    )
    .await;

    // --- Emit ledger events (as the projectors would), then run detection ---
    assert_eq!(emit_for_key(&pool, "pay-usdc").await, 1);
    assert_eq!(emit_for_key(&pool, "pay-near").await, 1);
    assert_eq!(emit_for_key(&pool, "swap-1").await, 1);

    let detected = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("detection cycle");

    assert_eq!(detected, 1, "detection covers the add_proposal event");

    let notifications: Vec<(String, String)> = sqlx::query_as(
        "SELECT event_type, dao_id FROM dao_notifications WHERE dao_id = $1 ORDER BY id",
    )
    .bind(DAO_ID)
    .fetch_all(&pool)
    .await
    .expect("query dao_notifications");

    let event_types: Vec<&str> = notifications
        .iter()
        .map(|(event_type, _)| event_type.as_str())
        .collect();
    assert_eq!(notifications.len(), 4);
    assert_eq!(
        event_types,
        vec!["payment", "payment", "swap_fulfilled", "add_proposal"]
    );

    let (payment_payload,): (serde_json::Value,) =
        sqlx::query_as("SELECT payload FROM dao_notifications WHERE source_key = 'pay-usdc'")
            .fetch_one(&pool)
            .await
            .expect("payment payload");
    assert_eq!(
        payment_payload,
        serde_json::json!({
            "token_id": "usdc.near",
            "amount": "50",
            "counterparty": "bob.near",
            "usd_value": null,
        })
    );

    let (swap_payload,): (serde_json::Value,) =
        sqlx::query_as("SELECT payload FROM dao_notifications WHERE source_key = 'swap-1'")
            .fetch_one(&pool)
            .await
            .expect("swap payload");
    assert_eq!(
        swap_payload,
        serde_json::json!({
            "sent_token_id": "near",
            "sent_amount": "5",
            "received_token_id": "intents.near:nep141:usdc.near",
            "received_amount": "100",
        })
    );

    // --- Run dispatcher (TelegramClient::default() → no real API calls) ---
    let state = build_dispatch_state(&pool).await;
    let telegram_client = nt_be::utils::telegram::TelegramClient::default();
    let sent = nt_be::handlers::notifications::telegram_dispatcher::run_telegram_dispatch_cycle(
        &state,
        &telegram_client,
        "https://app.trezu.app",
    )
    .await
    .expect("dispatch cycle");

    assert_eq!(sent, 4, "should record delivery for all 4 notifications");

    let deliveries: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT notification_id, destination, destination_ref FROM dao_notification_deliveries ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .expect("query deliveries");

    assert_eq!(deliveries.len(), 4);
    for (_, dest, dest_ref) in &deliveries {
        assert_eq!(dest, "telegram");
        assert_eq!(dest_ref, &CHAT_ID.to_string());
    }
}

/// DAOs without a Telegram connection must not produce notifications.
#[sqlx::test]
async fn test_no_notification_for_unconnected_dao(pool: PgPool) {
    common::load_test_env();

    // Insert monitored account but NO telegram connection
    insert_dao(&pool).await;

    insert_proposal(&pool, 1, "alice.near", "Pay Alice", chrono::Utc::now()).await;
    insert_ledger_payment(
        &pool,
        "pay-1",
        "usdc.near",
        "50",
        "bob.near",
        chrono::Utc::now(),
    )
    .await;

    assert_eq!(
        emit_for_key(&pool, "pay-1").await,
        0,
        "emitter skips unconnected DAOs"
    );

    let detected = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("detection cycle");

    assert_eq!(detected, 0, "no notifications for unconnected DAO");

    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM dao_notifications WHERE dao_id = $1")
        .bind(DAO_ID)
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(count.0, 0);
}

/// Detection is idempotent — re-running does not insert duplicate rows.
#[sqlx::test]
async fn test_detection_is_idempotent(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    insert_proposal(&pool, 1, "alice.near", "Pay Alice", chrono::Utc::now()).await;
    insert_confidential_intent(&pool, 7, "conf payout").await;

    // Run detection twice — proposal detection rescans the recent window
    // every cycle, so the second run replays the same rows.
    nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("first detection cycle");

    let second_run = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("second detection cycle");

    assert_eq!(second_run, 0, "ON CONFLICT DO NOTHING prevents duplicates");

    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM dao_notifications WHERE dao_id = $1")
        .bind(DAO_ID)
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(count.0, 2, "one public + one confidential proposal row");
}

/// A gold reprojection deletes and re-inserts rows with fresh ids, and the
/// projector re-emits for the re-inserted row. The stable source_key must
/// prevent a second notification for the same event.
#[sqlx::test]
async fn test_reprojection_does_not_renotify(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    let first_id = insert_ledger_payment(
        &pool,
        "stable-key",
        "usdc.near",
        "50",
        "bob.near",
        chrono::Utc::now(),
    )
    .await;
    assert_eq!(emit_for_key(&pool, "stable-key").await, 1);

    // Reproject: delete + re-insert the same event under a new row id.
    sqlx::query("DELETE FROM gold_treasury_ledger_events WHERE id = $1")
        .bind(first_id)
        .execute(&pool)
        .await
        .expect("delete for reprojection");
    let second_id = insert_ledger_payment(
        &pool,
        "stable-key",
        "usdc.near",
        "50",
        "bob.near",
        chrono::Utc::now(),
    )
    .await;
    assert_ne!(first_id, second_id);

    assert_eq!(
        emit_for_key(&pool, "stable-key").await,
        0,
        "same gold_event_key must not notify twice"
    );
}

/// Ledger rows whose event_time is older than the notification window never
/// notify — a reprojection of deep history must not flood connected chats.
#[sqlx::test]
async fn test_old_events_are_skipped(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    let old = chrono::Utc::now() - chrono::Duration::days(30);
    insert_ledger_payment(&pool, "old-pay", "usdc.near", "50", "bob.near", old).await;

    assert_eq!(
        emit_for_key(&pool, "old-pay").await,
        0,
        "historical events must not notify"
    );
}

/// Proposals discovered without creation facts (execution-side linking of old
/// proposals) are not notifiable.
#[sqlx::test]
async fn test_proposal_without_creation_facts_is_skipped(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    sqlx::query(
        "INSERT INTO dao_proposals (dao_id, proposal_id, status) VALUES ($1, 42, 'approved')",
    )
    .bind(DAO_ID)
    .execute(&pool)
    .await
    .expect("insert creation-less proposal");

    let detected = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("detection cycle");
    assert_eq!(detected, 0);
}

/// NearBlocks ingests newest-to-oldest, so execution-side linking can insert
/// the proposal row first and a later page fills in the creation facts. The
/// windowed rescan must pick the row up once `proposal_created_at` lands —
/// an id cursor would have moved past it forever.
#[sqlx::test]
async fn test_proposal_notifies_once_creation_facts_arrive_later(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    sqlx::query(
        "INSERT INTO dao_proposals (dao_id, proposal_id, status) VALUES ($1, 77, 'in_progress')",
    )
    .bind(DAO_ID)
    .execute(&pool)
    .await
    .expect("insert creation-less proposal");

    let first = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("first detection cycle");
    assert_eq!(first, 0, "no creation facts yet, nothing to notify");

    // A later (older) NearBlocks page links the creation transaction.
    sqlx::query(
        "UPDATE dao_proposals
         SET proposal_created_at = NOW() - INTERVAL '1 hour',
             proposer = 'alice.near',
             description = 'pay the vendor',
             proposal_creation_block_height = 123,
             proposal_creation_transaction_hash = 'creation-hash'
         WHERE dao_id = $1 AND proposal_id = 77",
    )
    .bind(DAO_ID)
    .execute(&pool)
    .await
    .expect("linker fills creation facts");

    let second = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("second detection cycle");
    assert_eq!(second, 1, "windowed rescan picks up the completed row");

    // And the rescan stays idempotent afterwards.
    let third = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("third detection cycle");
    assert_eq!(third, 0, "source_key dedupe absorbs repeated scans");
}

/// The proposal payload carries proposer, title, and the classified kind.
#[sqlx::test]
async fn test_proposal_payload_contents(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    insert_proposal(
        &pool,
        5,
        "frol.near",
        "* Title: Pay Alice",
        chrono::Utc::now(),
    )
    .await;

    nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("detection cycle");

    let (source_key, payload): (String, serde_json::Value) = sqlx::query_as(
        "SELECT source_key, payload FROM dao_notifications WHERE dao_id = $1 AND event_type = 'add_proposal'",
    )
    .bind(DAO_ID)
    .fetch_one(&pool)
    .await
    .expect("fetch proposal notification");

    assert_eq!(source_key, format!("{DAO_ID}:5"));
    assert_eq!(
        payload.get("counterparty").and_then(|v| v.as_str()),
        Some("frol.near")
    );
    assert_eq!(
        payload.get("description").and_then(|v| v.as_str()),
        Some("* Title: Pay Alice")
    );
    assert_eq!(
        payload.get("proposal_kind").and_then(|v| v.as_str()),
        Some("Payment"),
        "Transfer kind classifies as Payment"
    );
    assert_eq!(
        payload.get("tx_hash").and_then(|v| v.as_str()),
        Some("proposal-tx-hash")
    );
}

/// Dispatch is idempotent — re-running does not send or record duplicates.
#[sqlx::test]
async fn test_dispatch_is_idempotent(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    insert_proposal(&pool, 1, "alice.near", "Pay Alice", chrono::Utc::now()).await;

    nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("detection");

    let state = build_dispatch_state(&pool).await;
    let telegram_client = nt_be::utils::telegram::TelegramClient::default();

    let first = nt_be::handlers::notifications::telegram_dispatcher::run_telegram_dispatch_cycle(
        &state,
        &telegram_client,
        "https://app.trezu.app",
    )
    .await
    .expect("first dispatch");

    let second = nt_be::handlers::notifications::telegram_dispatcher::run_telegram_dispatch_cycle(
        &state,
        &telegram_client,
        "https://app.trezu.app",
    )
    .await
    .expect("second dispatch");

    assert_eq!(first, 1);
    assert_eq!(second, 0, "already delivered — nothing to send");

    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM dao_notification_deliveries")
        .fetch_one(&pool)
        .await
        .expect("count deliveries");
    assert_eq!(count.0, 1);
}

/// The production sequence that broke the old cursor-based detector: a
/// pending exchange row is later fulfilled by an in-place upsert on the same
/// gold_event_key (same row id). The projection-time emitter must skip the
/// pending write and notify exactly once on the fulfilled one.
#[sqlx::test]
async fn test_pending_exchange_fulfilled_in_place_notifies(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    // Outgoing leg lands first: exchange row with no received leg, pending.
    let pending_id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO gold_treasury_ledger_events
            (gold_event_key, dao_id, source_kind, history_visible, transaction_type,
             status, event_time, token_out, amount_out)
        VALUES ('swap-late', $1, 'public_silver_leg', true, 'exchange', 'pending', NOW(),
                'near', 5)
        RETURNING id
        "#,
    )
    .bind(DAO_ID)
    .fetch_one(&pool)
    .await
    .expect("insert pending exchange");

    assert_eq!(
        emit_for_key(&pool, "swap-late").await,
        0,
        "half-leg pending exchange is not notifiable"
    );

    // Received leg lands: the projector upserts the same key in place.
    sqlx::query(
        r#"
        UPDATE gold_treasury_ledger_events
        SET status = 'success',
            token_in = 'intents.near:nep141:usdc.near',
            amount_in = 100
        WHERE gold_event_key = 'swap-late'
        "#,
    )
    .execute(&pool)
    .await
    .expect("fulfill exchange in place");

    assert_eq!(
        emit_for_key(&pool, "swap-late").await,
        1,
        "in-place fulfillment must notify"
    );

    let (event_type, source_id): (String, i64) = sqlx::query_as(
        "SELECT event_type, source_id FROM dao_notifications WHERE source_key = 'swap-late'",
    )
    .fetch_one(&pool)
    .await
    .expect("fetch swap notification");
    assert_eq!(event_type, "swap_fulfilled");
    assert_eq!(
        source_id, pending_id,
        "row was updated in place, not re-inserted"
    );

    // Delivery happens exactly once.
    let state = build_dispatch_state(&pool).await;
    let tg = nt_be::utils::telegram::TelegramClient::default();
    let sent = nt_be::handlers::notifications::telegram_dispatcher::run_telegram_dispatch_cycle(
        &state,
        &tg,
        "https://app.trezu.app",
    )
    .await
    .expect("dispatch cycle");
    assert_eq!(sent, 1, "swap notification delivered exactly once");
}

/// Hidden ledger rows (sponsor top-ups, wraps) never notify.
#[sqlx::test]
async fn test_hidden_rows_do_not_notify(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    sqlx::query(
        r#"
        INSERT INTO gold_treasury_ledger_events
            (gold_event_key, dao_id, source_kind, history_visible, transaction_type,
             status, event_time, token_out, amount_out, recipient)
        VALUES ('hidden-1', $1, 'public_balance_ledger', false, 'sent', 'success', NOW(),
                'near', 0.5, 'sponsor.trezu.near')
        "#,
    )
    .bind(DAO_ID)
    .execute(&pool)
    .await
    .expect("insert hidden row");

    assert_eq!(
        emit_for_key(&pool, "hidden-1").await,
        0,
        "hidden rows are not notifiable"
    );
}

/// Confidential intents notify once their on-chain proposal is linked, with
/// the payment/exchange kind derived from the stored quote.
#[sqlx::test]
async fn test_confidential_proposal_notification(pool: PgPool) {
    common::load_test_env();

    insert_dao_with_telegram(&pool).await;

    // An intent without a linked proposal must not notify.
    sqlx::query(
        "INSERT INTO confidential_intents (dao_id, intent_payload, payload_hash, status)
         VALUES ($1, '{}', 'unlinked-hash', 'pending')",
    )
    .bind(DAO_ID)
    .execute(&pool)
    .await
    .expect("insert unlinked intent");

    let intent_id = insert_confidential_intent(&pool, 3, "vendor payout").await;

    let detected = nt_be::handlers::notifications::detector::run_detection_cycle(&pool)
        .await
        .expect("detection cycle");
    assert_eq!(detected, 1, "only the linked intent notifies");

    let (source_key, payload): (String, serde_json::Value) = sqlx::query_as(
        "SELECT source_key, payload FROM dao_notifications WHERE dao_id = $1 AND event_type = 'add_proposal'",
    )
    .bind(DAO_ID)
    .fetch_one(&pool)
    .await
    .expect("fetch confidential notification");

    assert_eq!(source_key, intent_id.to_string());
    assert_eq!(
        payload.get("description").and_then(|v| v.as_str()),
        Some("vendor payout")
    );
    assert_eq!(
        payload.get("proposal_kind").and_then(|v| v.as_str()),
        Some("Payment"),
        "matching origin/destination assets classify as Payment"
    );
}

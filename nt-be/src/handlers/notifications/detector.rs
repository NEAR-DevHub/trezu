//! DAO event detection worker.
//!
//! Scans `balance_changes` and `detected_swaps` for notable events and writes
//! them to the generic `dao_notifications` queue.
//!
//! Only DAOs with at least one notification destination (currently: Telegram)
//! produce notifications. Zero RPC calls — reads from the app DB only.

use sqlx::PgPool;

use super::payload_decoder::decode_add_proposal_payload;

const CONSUMER_BC: &str = "notifications:balance_changes";
const CONSUMER_SWAPS: &str = "notifications:detected_swaps";
const BATCH_SIZE: i64 = 100;

// ---------------------------------------------------------------------------
// Cursor helpers (reuse goldsky_cursors table)
// ---------------------------------------------------------------------------

/// Return the last-processed id for `consumer_name`.
///
/// On first run (no cursor row yet), seed the cursor from the latest row in
/// `seed_table` so we don't flood connected chats with every historical event.
/// The seeded position is persisted immediately so subsequent calls return it.
async fn get_cursor(
    pool: &PgPool,
    consumer_name: &str,
    seed_table: &str,
) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
    let row: Option<i64> = sqlx::query_scalar(
        "SELECT last_processed_block FROM goldsky_cursors WHERE consumer_name = $1",
    )
    .bind(consumer_name)
    .fetch_optional(pool)
    .await?;

    if let Some(id) = row {
        return Ok(id);
    }

    // No cursor yet — seed from the latest row in the source table so we only
    // notify about events that arrive after this fresh deployment.
    let latest: Option<i64> = sqlx::query_scalar(&format!("SELECT MAX(id) FROM {seed_table}"))
        .fetch_optional(pool)
        .await?
        .flatten();

    let seed = latest.unwrap_or(0);
    log::info!(
        "[notifications] No cursor for {consumer_name}, seeding from latest {seed_table} id={seed}"
    );
    update_cursor(pool, consumer_name, seed).await?;
    Ok(seed)
}

async fn update_cursor(
    pool: &PgPool,
    consumer_name: &str,
    last_id: i64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    sqlx::query(
        "INSERT INTO goldsky_cursors (consumer_name, last_processed_id, last_processed_block, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (consumer_name) DO UPDATE SET
           last_processed_id = EXCLUDED.last_processed_id,
           last_processed_block = EXCLUDED.last_processed_block,
           updated_at = NOW()",
    )
    .bind(consumer_name)
    .bind(last_id.to_string())
    .bind(last_id)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// balance_changes detection
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct BalanceChangeRow {
    id: i64,
    account_id: String,
    token_id: String,
    amount: bigdecimal::BigDecimal,
    counterparty: Option<String>,
    method_name: Option<String>,
    action_kind: Option<String>,
    actions: Option<serde_json::Value>,
    usd_value: Option<bigdecimal::BigDecimal>,
    block_height: i64,
}

async fn detect_balance_change_events(
    pool: &PgPool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let last_id = get_cursor(pool, CONSUMER_BC, "balance_changes").await?;

    // Only scan events for DAOs that have at least one notification destination
    // registered (currently: Telegram). This keeps dao_notifications small.
    let rows: Vec<BalanceChangeRow> = sqlx::query_as(
        r#"
        SELECT bc.id, bc.account_id, bc.token_id, bc.amount, bc.counterparty,
               bc.method_name, bc.action_kind, bc.actions, bc.usd_value, bc.block_height
        FROM balance_changes bc
        WHERE bc.id > $1
          AND bc.account_id IN (SELECT dao_id FROM telegram_treasury_connections)
        ORDER BY bc.id ASC
        LIMIT $2
        "#,
    )
    .bind(last_id)
    .bind(BATCH_SIZE)
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(0);
    }

    let mut inserted = 0usize;
    let mut max_id = last_id;

    for row in &rows {
        max_id = max_id.max(row.id);

        let method = row.method_name.as_deref().unwrap_or("");
        let kind = row.action_kind.as_deref().unwrap_or("");

        let is_proposal = method == "add_proposal";

        let is_payment = row.amount < 0
            && ((kind == "TRANSFER" && !row.token_id.eq_ignore_ascii_case("near"))
                || (row.token_id.eq_ignore_ascii_case("near")
                    && matches!(method, "on_proposal_callback" | "ft_transfer")));

        if !is_proposal && !is_payment {
            continue;
        }

        let event_type = if is_proposal {
            "add_proposal"
        } else {
            "payment"
        };

        let payload = if is_proposal {
            let decoded = decode_add_proposal_payload(row.actions.as_ref());
            let submitter = decoded
                .delegate_sender_id
                .as_deref()
                .or(row.counterparty.as_deref());

            serde_json::json!({
                "counterparty": submitter,
                "block_height": row.block_height,
                "description": decoded.description,
                "proposal_kind": decoded.proposal_kind,
            })
        } else {
            serde_json::json!({
                "token_id": row.token_id,
                "amount": row.amount.to_string(),
                "counterparty": row.counterparty,
                "usd_value": row.usd_value.as_ref().map(|v| v.to_string()),
            })
        };

        let rows_inserted = sqlx::query(
            r#"
            INSERT INTO dao_notifications (dao_id, event_type, source_id, source_table, payload)
            VALUES ($1, $2, $3, 'balance_changes', $4)
            ON CONFLICT (source_table, source_id, dao_id, event_type) DO NOTHING
            "#,
        )
        .bind(&row.account_id)
        .bind(event_type)
        .bind(row.id)
        .bind(&payload)
        .execute(pool)
        .await?
        .rows_affected();

        inserted += rows_inserted as usize;
    }

    update_cursor(pool, CONSUMER_BC, max_id).await?;

    Ok(inserted)
}

// ---------------------------------------------------------------------------
// detected_swaps detection
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct DetectedSwapRow {
    id: i64,
    account_id: String,
    sent_token_id: Option<String>,
    sent_amount: Option<bigdecimal::BigDecimal>,
    received_token_id: String,
    received_amount: bigdecimal::BigDecimal,
}

async fn detect_swap_events(
    pool: &PgPool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let last_id = get_cursor(pool, CONSUMER_SWAPS, "detected_swaps").await?;

    // Only scan swaps for DAOs that have at least one notification destination registered.
    let rows: Vec<DetectedSwapRow> = sqlx::query_as(
        r#"
        SELECT id, account_id, sent_token_id, sent_amount, received_token_id, received_amount
        FROM detected_swaps
        WHERE id > $1
          AND account_id IN (SELECT dao_id FROM telegram_treasury_connections)
        ORDER BY id ASC
        LIMIT $2
        "#,
    )
    .bind(last_id)
    .bind(BATCH_SIZE)
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(0);
    }

    let mut inserted = 0usize;
    let mut max_id = last_id;

    for row in &rows {
        max_id = max_id.max(row.id);

        let payload = serde_json::json!({
            "sent_token_id": row.sent_token_id,
            "sent_amount": row.sent_amount.as_ref().map(|a| a.to_string()),
            "received_token_id": row.received_token_id,
            "received_amount": row.received_amount.to_string(),
        });

        let rows_inserted = sqlx::query(
            r#"
            INSERT INTO dao_notifications (dao_id, event_type, source_id, source_table, payload)
            VALUES ($1, 'swap_fulfilled', $2, 'detected_swaps', $3)
            ON CONFLICT (source_table, source_id, dao_id, event_type) DO NOTHING
            "#,
        )
        .bind(&row.account_id)
        .bind(row.id)
        .bind(&payload)
        .execute(pool)
        .await?
        .rows_affected();

        inserted += rows_inserted as usize;
    }

    update_cursor(pool, CONSUMER_SWAPS, max_id).await?;

    Ok(inserted)
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Scan `balance_changes` and `detected_swaps` for new events and write them
/// to `dao_notifications`. Zero RPC calls — reads from the app DB only.
///
/// Returns the total number of new notification rows inserted.
pub async fn run_detection_cycle(
    pool: &PgPool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let bc = detect_balance_change_events(pool).await?;
    let sw = detect_swap_events(pool).await?;
    Ok(bc + sw)
}

//! DAO event detection worker.
//!
//! Scans the unified gold ledger (`gold_treasury_ledger_events`) for payments
//! and fulfilled exchanges, `dao_proposals` for new public proposals, and
//! `confidential_intents` for new confidential proposals, and writes them to
//! the generic `dao_notifications` queue.
//!
//! Only DAOs with at least one notification destination (currently: Telegram)
//! produce notifications. Zero RPC calls — reads from the app DB only.
//!
//! Gold ledger rows are deleted and re-inserted with fresh ids whenever a
//! recompute window replays a DAO, so id cursors alone cannot dedupe: every
//! insert dedupes on a stable `source_key` (`gold_event_key`,
//! `{dao_id}:{proposal_id}`, `confidential_intents.id`), and events older
//! than [`MAX_NOTIFIABLE_EVENT_AGE`] never notify — a full reprojection
//! advances the ledger cursor without replaying history into connected chats.
//!
//! Proposal detection (public and confidential) uses no id cursor at all:
//! NearBlocks ingests newest-to-oldest, so a proposal row can be created by
//! execution-side linking first and only receive its creation facts from a
//! later page. A windowed rescan of the last 24 hours picks the row up once
//! `proposal_created_at` lands, and the unique `source_key` absorbs the
//! repeated scans.

use chrono::{Duration, Utc};
use sqlx::PgPool;

use super::payload_decoder::classify_proposal_kind;

const CONSUMER_LEDGER: &str = "notifications:gold_ledger";
const BATCH_SIZE: i64 = 100;

/// Events whose on-chain time is older than this are skipped (cursor still
/// advances). Guards reprojections and late backfills from flooding chats.
const MAX_NOTIFIABLE_EVENT_AGE: Duration = Duration::hours(24);

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
    tracing::info!("No cursor for {consumer_name}, seeding from latest {seed_table} id={seed}");
    update_cursor(pool, consumer_name, seed).await?;
    Ok(seed)
}

async fn update_cursor(
    pool: &PgPool,
    consumer_name: &str,
    last_id: i64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    sqlx::query!(
        "INSERT INTO goldsky_cursors (consumer_name, last_processed_id, last_processed_block, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (consumer_name) DO UPDATE SET
           last_processed_id = EXCLUDED.last_processed_id,
           last_processed_block = EXCLUDED.last_processed_block,
           updated_at = NOW()",
        consumer_name,
        last_id.to_string(),
        last_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_notification(
    pool: &PgPool,
    dao_id: &str,
    event_type: &str,
    source_table: &str,
    source_id: i64,
    source_key: &str,
    payload: &serde_json::Value,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query!(
        r#"
        INSERT INTO dao_notifications (dao_id, event_type, source_id, source_table, source_key, payload)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (source_table, source_key, dao_id, event_type) DO NOTHING
        "#,
        dao_id,
        event_type,
        source_id,
        source_table,
        source_key,
        payload,
    )
    .execute(pool)
    .await?
    .rows_affected())
}

// ---------------------------------------------------------------------------
// Gold ledger detection: payments + fulfilled exchanges
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct LedgerEventRow {
    id: i64,
    gold_event_key: String,
    dao_id: String,
    transaction_type: String,
    event_time: chrono::DateTime<Utc>,
    token_in: Option<String>,
    amount_in: Option<bigdecimal::BigDecimal>,
    token_out: Option<String>,
    amount_out: Option<bigdecimal::BigDecimal>,
    amount_out_usd: Option<bigdecimal::BigDecimal>,
    recipient: Option<String>,
    counterparty: Option<String>,
}

#[tracing::instrument(
    level = "debug",
    skip_all,
    fields(job = "notification_detection", step = "gold_ledger")
)]
async fn detect_ledger_events(
    pool: &PgPool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let last_id = get_cursor(pool, CONSUMER_LEDGER, "gold_treasury_ledger_events").await?;

    // Only scan events for DAOs that have at least one notification destination
    // registered (currently: Telegram). This keeps dao_notifications small.
    // The recency guard is applied in Rust so the cursor still advances over
    // reprojected historical rows instead of rescanning them forever.
    let rows: Vec<LedgerEventRow> = sqlx::query_as(
        r#"
        SELECT gle.id, gle.gold_event_key, gle.dao_id,
               gle.transaction_type::text AS transaction_type,
               gle.event_time, gle.token_in, gle.amount_in,
               gle.token_out, gle.amount_out, gle.amount_out_usd,
               gle.recipient, gle.counterparty
        FROM gold_treasury_ledger_events gle
        WHERE gle.id > $1
          AND gle.status = 'success'
          AND gle.history_visible
          AND gle.transaction_type IN ('sent', 'exchange')
          AND gle.dao_id IN (SELECT dao_id FROM telegram_treasury_connections)
        ORDER BY gle.id ASC
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

    let cutoff = Utc::now() - MAX_NOTIFIABLE_EVENT_AGE;
    let mut inserted = 0usize;
    let mut max_id = last_id;

    for row in &rows {
        max_id = max_id.max(row.id);

        if row.event_time < cutoff {
            continue;
        }

        let (event_type, payload) = match row.transaction_type.as_str() {
            "sent" => {
                let Some(amount_out) = row.amount_out.as_ref() else {
                    continue;
                };
                (
                    "payment",
                    serde_json::json!({
                        "token_id": row.token_out,
                        "amount": amount_out.to_string(),
                        "counterparty": row.recipient.as_deref().or(row.counterparty.as_deref()),
                        "usd_value": row.amount_out_usd.as_ref().map(|v| v.to_string()),
                    }),
                )
            }
            "exchange" => {
                // An exchange row carries both legs once fulfilled; a row
                // missing its received leg is not notifiable (fulfillment
                // arrives as a re-projected row with a fresh id, so there is
                // no need to hold the cursor for it).
                let (Some(token_in), Some(amount_in)) =
                    (row.token_in.as_deref(), row.amount_in.as_ref())
                else {
                    continue;
                };
                (
                    "swap_fulfilled",
                    serde_json::json!({
                        "sent_token_id": row.token_out,
                        "sent_amount": row.amount_out.as_ref().map(|a| a.to_string()),
                        "received_token_id": token_in,
                        "received_amount": amount_in.to_string(),
                    }),
                )
            }
            _ => continue,
        };

        inserted += insert_notification(
            pool,
            &row.dao_id,
            event_type,
            "gold_treasury_ledger_events",
            row.id,
            &row.gold_event_key,
            &payload,
        )
        .await? as usize;
    }

    update_cursor(pool, CONSUMER_LEDGER, max_id).await?;

    Ok(inserted)
}

// ---------------------------------------------------------------------------
// Public proposal detection (dao_proposals, written by the linker)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct ProposalRow {
    id: i64,
    dao_id: String,
    proposal_id: i64,
    proposer: Option<String>,
    description: Option<String>,
    proposal_kind: Option<serde_json::Value>,
    proposal_creation_block_height: Option<i64>,
    proposal_creation_transaction_hash: Option<String>,
}

#[tracing::instrument(
    level = "debug",
    skip_all,
    fields(job = "notification_detection", step = "dao_proposals")
)]
async fn detect_public_proposal_events(
    pool: &PgPool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    // Windowed scan, no id cursor: an execution-side page can insert the
    // proposal row before its creation facts exist, and the linker fills
    // `proposal_created_at` in place from a later page — an id cursor would
    // have moved past the row and never notify. Rescanning the recency window
    // is idempotent because the `{dao_id}:{proposal_id}` source_key dedupes.
    let rows: Vec<ProposalRow> = sqlx::query_as(
        r#"
        SELECT dp.id, dp.dao_id, dp.proposal_id, dp.proposer, dp.description,
               dp.proposal_kind,
               dp.proposal_creation_block_height, dp.proposal_creation_transaction_hash
        FROM dao_proposals dp
        WHERE dp.proposal_created_at > NOW() - INTERVAL '24 hours'
          AND dp.dao_id IN (SELECT dao_id FROM telegram_treasury_connections)
        ORDER BY dp.id ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut inserted = 0usize;
    for row in &rows {
        let proposal_kind = row.proposal_kind.as_ref().and_then(|kind| {
            classify_proposal_kind(&serde_json::json!({
                "description": row.description.as_deref().unwrap_or_default(),
                "kind": kind,
            }))
        });
        let payload = serde_json::json!({
            "counterparty": row.proposer,
            "block_height": row.proposal_creation_block_height,
            "description": row.description,
            "proposal_kind": proposal_kind,
            "tx_hash": row.proposal_creation_transaction_hash,
        });

        inserted += insert_notification(
            pool,
            &row.dao_id,
            "add_proposal",
            "dao_proposals",
            row.id,
            &format!("{}:{}", row.dao_id, row.proposal_id),
            &payload,
        )
        .await? as usize;
    }

    Ok(inserted)
}

// ---------------------------------------------------------------------------
// Confidential proposal detection (confidential_intents)
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct ConfidentialIntentRow {
    id: i32,
    dao_id: String,
    notes: Option<String>,
    quote_metadata: Option<serde_json::Value>,
}

/// Label a confidential proposal from its stored 1Click quote: differing
/// origin/destination assets mean an exchange, matching ones a payment.
fn confidential_proposal_kind(quote_metadata: Option<&serde_json::Value>) -> &'static str {
    let request = quote_metadata.and_then(|metadata| metadata.get("quoteRequest"));
    let origin = request
        .and_then(|request| request.get("originAsset"))
        .and_then(|v| v.as_str());
    let destination = request
        .and_then(|request| request.get("destinationAsset"))
        .and_then(|v| v.as_str());
    match (origin, destination) {
        (Some(origin), Some(destination)) if origin != destination => "Exchange",
        (Some(_), Some(_)) => "Payment",
        _ => "Confidential Request",
    }
}

/// Confidential intents get `proposal_id`/`proposal_created_at` stamped in
/// place when the on-chain `add_proposal` is linked, so an id cursor would
/// permanently skip intents whose rows predate the stamp. Instead, the recent
/// window is rescanned every cycle and the unique `source_key` makes the
/// insert a no-op after the first time.
#[tracing::instrument(
    level = "debug",
    skip_all,
    fields(job = "notification_detection", step = "confidential_intents")
)]
async fn detect_confidential_proposal_events(
    pool: &PgPool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let rows: Vec<ConfidentialIntentRow> = sqlx::query_as(
        r#"
        SELECT ci.id, ci.dao_id, ci.notes, ci.quote_metadata
        FROM confidential_intents ci
        WHERE ci.proposal_id IS NOT NULL
          AND ci.proposal_created_at > NOW() - INTERVAL '24 hours'
          AND ci.dao_id IN (SELECT dao_id FROM telegram_treasury_connections)
        ORDER BY ci.id ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut inserted = 0usize;
    for row in &rows {
        let payload = serde_json::json!({
            "description": row.notes,
            "proposal_kind": confidential_proposal_kind(row.quote_metadata.as_ref()),
        });

        inserted += insert_notification(
            pool,
            &row.dao_id,
            "add_proposal",
            "confidential_intents",
            i64::from(row.id),
            &row.id.to_string(),
            &payload,
        )
        .await? as usize;
    }

    Ok(inserted)
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Scan the gold ledger, `dao_proposals`, and `confidential_intents` for new
/// events and write them to `dao_notifications`. Zero RPC calls — reads from
/// the app DB only.
///
/// Returns the total number of new notification rows inserted.
#[tracing::instrument(level = "info", skip_all, fields(job = "notification_detection"))]
pub async fn run_detection_cycle(
    pool: &PgPool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let ledger = detect_ledger_events(pool).await?;
    let proposals = detect_public_proposal_events(pool).await?;
    let confidential = detect_confidential_proposal_events(pool).await?;
    Ok(ledger + proposals + confidential)
}

#[cfg(test)]
mod tests {
    use super::confidential_proposal_kind;

    #[test]
    fn confidential_kind_distinguishes_exchange_from_payment() {
        let exchange = serde_json::json!({
            "quoteRequest": {"originAsset": "nep141:wrap.near", "destinationAsset": "nep141:btc.omft.near"}
        });
        assert_eq!(confidential_proposal_kind(Some(&exchange)), "Exchange");

        let payment = serde_json::json!({
            "quoteRequest": {"originAsset": "nep141:wrap.near", "destinationAsset": "nep141:wrap.near"}
        });
        assert_eq!(confidential_proposal_kind(Some(&payment)), "Payment");

        assert_eq!(confidential_proposal_kind(None), "Confidential Request");
    }
}

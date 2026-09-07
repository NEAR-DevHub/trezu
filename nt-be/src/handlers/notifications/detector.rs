//! DAO event detection worker.
//!
//! Scans `dao_proposals` for new public proposals and `confidential_intents`
//! for new confidential proposals, and writes them to the generic
//! `dao_notifications` queue. Gold ledger events (payments, fulfilled
//! exchanges) are not detected here: the gold projectors emit them inline
//! via [`super::emitter`] in the same transaction that writes the ledger
//! row, because a pending exchange lands its received leg as an in-place
//! upsert on the same row id — an id-cursor scan would advance past it and
//! never notify.
//!
//! Only DAOs with at least one notification destination (currently: Telegram)
//! produce notifications. Zero RPC calls — reads from the app DB only.
//!
//! Every insert dedupes on a stable `source_key` (`{dao_id}:{proposal_id}`,
//! `confidential_intents.id`) because proposal detection uses no id cursor
//! at all: NearBlocks ingests newest-to-oldest, so a proposal row can be
//! created by execution-side linking first and only receive its creation
//! facts from a later page. A windowed rescan of the last 24 hours picks the
//! row up once `proposal_created_at` lands, and the unique `source_key`
//! absorbs the repeated scans.

use sqlx::PgPool;

use super::payload_decoder::classify_proposal_kind;

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

/// Scan `dao_proposals` and `confidential_intents` for new proposals and
/// write them to `dao_notifications`. Zero RPC calls — reads from the app DB
/// only. Gold ledger events are emitted by the projectors, not detected here.
///
/// Returns the total number of new notification rows inserted.
#[tracing::instrument(level = "info", skip_all, fields(job = "notification_detection"))]
pub async fn run_detection_cycle(
    pool: &PgPool,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let proposals = detect_public_proposal_events(pool).await?;
    let confidential = detect_confidential_proposal_events(pool).await?;
    Ok(proposals + confidential)
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

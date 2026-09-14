//! Inline notification emission for gold-ledger events.
//!
//! Called by the gold projectors (public and confidential) right after they
//! upsert a `gold_treasury_ledger_events` row, inside the same transaction.
//! The projector is the only place that observes a row transitioning to its
//! notifiable state — a pending exchange lands its received leg as an
//! in-place upsert on the same `gold_event_key` (same row id), so any
//! after-the-fact scan keyed on row ids can silently skip it. Emitting in
//! the projection transaction makes the notification atomic with the ledger
//! row itself: committed together or not at all.
//!
//! The insert re-reads the row by key and applies every notifiability guard
//! in one statement: success status, history-visible, a `sent` row with an
//! outgoing amount or an `exchange` row with both legs, an event no older
//! than 24 hours (reprojections of deep history must not flood connected
//! chats), and a DAO with at least one Telegram connection. The unique
//! `(source_table, source_key, dao_id, event_type)` constraint absorbs
//! re-projections of the same event.

use sqlx::{Postgres, Transaction};

/// Queue a `payment` / `swap_fulfilled` notification for the gold ledger row
/// at `gold_event_key`, if it is notifiable. Idempotent per event. Returns
/// the number of notification rows inserted (0 or 1).
pub async fn emit_gold_ledger_notification(
    tx: &mut Transaction<'_, Postgres>,
    gold_event_key: &str,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        r#"
        INSERT INTO dao_notifications (dao_id, event_type, source_id, source_table, source_key, payload)
        SELECT gle.dao_id,
               CASE gle.transaction_type::text WHEN 'sent' THEN 'payment' ELSE 'swap_fulfilled' END,
               gle.id,
               'gold_treasury_ledger_events',
               gle.gold_event_key,
               CASE gle.transaction_type::text
                   WHEN 'sent' THEN jsonb_build_object(
                       'token_id', gle.token_out,
                       'amount', gle.amount_out::text,
                       'counterparty', COALESCE(gle.recipient, gle.counterparty),
                       'usd_value', gle.amount_out_usd::text
                   )
                   ELSE jsonb_build_object(
                       'sent_token_id', gle.token_out,
                       'sent_amount', gle.amount_out::text,
                       'received_token_id', gle.token_in,
                       'received_amount', gle.amount_in::text
                   )
               END
        FROM gold_treasury_ledger_events gle
        WHERE gle.gold_event_key = $1
          AND gle.status = 'success'
          AND gle.history_visible
          AND ((gle.transaction_type::text = 'sent' AND gle.amount_out IS NOT NULL)
               OR (gle.transaction_type::text = 'exchange'
                   AND gle.token_in IS NOT NULL AND gle.amount_in IS NOT NULL))
          AND gle.event_time > NOW() - INTERVAL '24 hours'
          AND EXISTS (SELECT 1 FROM telegram_treasury_connections t WHERE t.dao_id = gle.dao_id)
        ON CONFLICT (source_table, source_key, dao_id, event_type) DO NOTHING
        "#,
    )
    .bind(gold_event_key)
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

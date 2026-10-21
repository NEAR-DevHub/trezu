use sqlx::{PgPool, Postgres, Transaction};

use crate::handlers::intents::confidential::gold::cursors::mark_gold_dirty_for_history_event;

pub(super) async fn link_history_event_to_intent_tx(
    tx: &mut Transaction<'_, Postgres>,
    history_event_id: i64,
    account_id: &str,
    deposit_address: &str,
    recipient: Option<&str>,
) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        WITH candidate AS (
            SELECT id
            FROM confidential_intents
            WHERE dao_id = $2
              AND deposit_address = $3
              AND history_event_id IS NULL
              AND proposal_id IS NOT NULL
              AND status = 'submitted'
              AND NOT EXISTS (
                  SELECT 1
                  FROM confidential_intents existing
                  WHERE existing.history_event_id = $1
              )
              AND (
                  $4::TEXT IS NULL
                  OR $4 = quote_metadata->'quoteRequest'->>'recipient'
              )
        ),
        single_candidate AS (
            SELECT id
            FROM candidate
            WHERE (SELECT COUNT(*) FROM candidate) = 1
        )
        UPDATE confidential_intents ci
        SET history_event_id = $1,
            updated_at = NOW()
        FROM single_candidate sc
        WHERE ci.id = sc.id
        RETURNING ci.id
        "#,
    )
    .bind(history_event_id)
    .bind(account_id)
    .bind(deposit_address)
    .bind(recipient)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn link_intent_to_history_event(
    pool: &PgPool,
    dao_id: &str,
    payload_hash: &str,
) -> Result<Option<i64>, sqlx::Error> {
    let linked = sqlx::query_scalar(
        r#"
        WITH intent AS (
            SELECT
                id,
                dao_id,
                deposit_address,
                quote_metadata->'quoteRequest'->>'recipient' AS recipient
            FROM confidential_intents
            WHERE dao_id = $1
              AND payload_hash = $2
              AND history_event_id IS NULL
              AND proposal_id IS NOT NULL
              AND status = 'submitted'
              AND deposit_address IS NOT NULL
        ),
        candidate AS (
            SELECT he.id AS history_event_id
            FROM bronze_confidential_history_events he
            JOIN intent i
              ON he.account_id = i.dao_id
             AND he.deposit_address = i.deposit_address
             AND (
                 i.recipient IS NULL
                 OR he.recipient = i.recipient
             )
            WHERE NOT EXISTS (
                SELECT 1
                FROM confidential_intents existing
                WHERE existing.history_event_id = he.id
            )
        ),
        single_candidate AS (
            SELECT history_event_id
            FROM candidate
            WHERE (SELECT COUNT(*) FROM candidate) = 1
        )
        UPDATE confidential_intents ci
        SET history_event_id = sc.history_event_id,
            updated_at = NOW()
        FROM intent i, single_candidate sc
        WHERE ci.id = i.id
        RETURNING ci.history_event_id
        "#,
    )
    .bind(dao_id)
    .bind(payload_hash)
    .fetch_optional(pool)
    .await?;

    if let Some(history_event_id) = linked {
        mark_gold_dirty_for_history_event(pool, history_event_id).await?;
        return Ok(Some(history_event_id));
    }

    Ok(None)
}

/// 1Click's answer to a submit can be lost in transit after 1Click accepted
/// the intent. The executed-but-unsubmitted row is then reconciled against
/// the DAO's ingested 1Click history: an existing link (rows the ingest-time
/// linker already matched) or a single unlinked history row for the intent's
/// deposit address (and recipient) proves acceptance, so the row is promoted
/// to `submitted` with a synthetic `submit_result` and linked. Only the
/// holder of `lease_token` may do this. Returns the linked history event id.
pub async fn recover_unsubmitted_intent_from_history(
    pool: &PgPool,
    dao_id: &str,
    payload_hash: &str,
    lease_token: &str,
) -> Result<Option<i64>, sqlx::Error> {
    let linked = sqlx::query_scalar(
        r#"
        WITH intent AS (
            SELECT
                id,
                dao_id,
                COALESCE(deposit_address, quote_metadata->'quote'->>'depositAddress')
                    AS deposit_address,
                -- A linked quote 1Click never saw a deposit on proves nothing
                -- about submission (the quote exists before the intent runs).
                (
                    SELECT he.id
                    FROM bronze_confidential_history_events he
                    WHERE he.id = src.history_event_id
                      AND UPPER(he.status) <> 'PENDING_DEPOSIT'
                ) AS linked_event_id,
                quote_metadata->'quoteRequest'->>'recipient' AS recipient
            FROM confidential_intents src
            WHERE dao_id = $1
              AND payload_hash = $2
              AND submit_lease_token = $3
              AND submit_result IS NULL
              AND status IN ('pending', 'submitted')
              AND proposal_id IS NOT NULL
        ),
        candidate AS (
            SELECT he.id AS history_event_id
            FROM bronze_confidential_history_events he
            JOIN intent i
              ON he.account_id = i.dao_id
             AND he.deposit_address = i.deposit_address
             AND (
                 i.recipient IS NULL
                 OR he.recipient = i.recipient
             )
            WHERE i.linked_event_id IS NULL
              AND i.deposit_address IS NOT NULL
              AND UPPER(he.status) <> 'PENDING_DEPOSIT'
              AND NOT EXISTS (
                  SELECT 1
                  FROM confidential_intents existing
                  WHERE existing.history_event_id = he.id
              )
        ),
        resolved AS (
            SELECT COALESCE(
                i.linked_event_id,
                (
                    SELECT history_event_id
                    FROM candidate
                    WHERE (SELECT COUNT(*) FROM candidate) = 1
                )
            ) AS history_event_id
            FROM intent i
        )
        UPDATE confidential_intents ci
        SET history_event_id = r.history_event_id,
            status = 'submitted',
            submit_result = jsonb_build_object(
                'recoveredFromHistory', true,
                'historyEventId', r.history_event_id
            ),
            submit_state = 'done',
            submit_next_attempt_at = NULL,
            submit_last_error = NULL,
            submit_lease_token = NULL,
            submit_lease_until = NULL,
            updated_at = NOW()
        FROM intent i, resolved r
        WHERE ci.id = i.id
          -- Re-checked on the row version the UPDATE locks: the CTE's view can
          -- predate a replacement lease taken by another holder meanwhile.
          AND ci.submit_lease_token = $3
          AND ci.submit_result IS NULL
          AND r.history_event_id IS NOT NULL
        RETURNING ci.history_event_id
        "#,
    )
    .bind(dao_id)
    .bind(payload_hash)
    .bind(lease_token)
    .fetch_optional(pool)
    .await?;

    if let Some(history_event_id) = linked {
        mark_gold_dirty_for_history_event(pool, history_event_id).await?;
        return Ok(Some(history_event_id));
    }

    Ok(None)
}

use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;

use super::models::HistoryCursor;

/// A recently submitted intent is still waiting for 1Click to settle: poll at
/// the scheduler's native cadence so the terminal status lands within seconds.
/// Bounded by a 10-minute window anchored to the intent's execution/creation
/// time (immutable columns — `updated_at` is churned by enrichment/linker
/// passes) so a stuck intent can't pin this tier.
const AWAIT_SETTLEMENT_POLL_DELAY: Duration = Duration::seconds(10);
const HOT_POLL_DELAY: Duration = Duration::seconds(30);
const RECENT_POLL_DELAY: Duration = Duration::seconds(120);
const WARM_POLL_DELAY: Duration = Duration::seconds(600);
const INACTIVE_POLL_DELAY: Duration = Duration::seconds(3600);

/// 1Click history statuses after which a swap can no longer change.
const ONECLICK_TERMINAL_STATUSES: &[&str] =
    &["SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"];

pub(crate) fn confidential_history_next_poll_delay(
    had_history_changes: bool,
    awaiting_intent_settlement: bool,
    last_confidential_activity_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Duration {
    if awaiting_intent_settlement {
        return AWAIT_SETTLEMENT_POLL_DELAY;
    }
    if had_history_changes {
        return HOT_POLL_DELAY;
    }

    let Some(last_activity_at) = last_confidential_activity_at else {
        return INACTIVE_POLL_DELAY;
    };

    if last_activity_at > now - Duration::hours(2) {
        RECENT_POLL_DELAY
    } else if last_activity_at > now - Duration::hours(48) {
        WARM_POLL_DELAY
    } else {
        INACTIVE_POLL_DELAY
    }
}

pub async fn load_history_cursor(
    pool: &PgPool,
    account_id: &str,
) -> Result<Option<HistoryCursor>, sqlx::Error> {
    sqlx::query_as::<_, HistoryCursor>(
        r#"
        SELECT
            account_id,
            forward_cursor,
            backward_cursor,
            backfill_done,
            next_poll_at,
            last_polled_at,
            last_confidential_activity_at
        FROM bronze_confidential_history_cursors
        WHERE account_id = $1
        "#,
    )
    .bind(account_id)
    .fetch_optional(pool)
    .await
}

/// Update only `forward_cursor` (and `last_polled_at`) for a latest-page poll.
/// Never touches `backward_cursor` — that column is owned by the backfill path
/// and overwriting it from a latest-page poll resets backfill progress.
pub async fn save_latest_page_cursor(
    pool: &PgPool,
    account_id: &str,
    next_cursor: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO bronze_confidential_history_cursors (
            account_id,
            forward_cursor,
            last_polled_at,
            updated_at
        )
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            forward_cursor = COALESCE(
                EXCLUDED.forward_cursor,
                bronze_confidential_history_cursors.forward_cursor
            ),
            last_polled_at = NOW(),
            updated_at = NOW()
        "#,
    )
    .bind(account_id)
    .bind(next_cursor)
    .execute(pool)
    .await?;

    Ok(())
}

/// Advance the backfill resume cursor. Optionally seeds `forward_cursor` on
/// the very first backfill page (when no cursor row existed yet).
pub async fn save_backfill_progress(
    pool: &PgPool,
    account_id: &str,
    prev_cursor: Option<&str>,
    initial_forward_cursor: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO bronze_confidential_history_cursors (
            account_id,
            forward_cursor,
            backward_cursor,
            last_polled_at,
            updated_at
        )
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            forward_cursor = COALESCE(
                EXCLUDED.forward_cursor,
                bronze_confidential_history_cursors.forward_cursor
            ),
            backward_cursor = COALESCE(
                EXCLUDED.backward_cursor,
                bronze_confidential_history_cursors.backward_cursor
            ),
            last_polled_at = NOW(),
            updated_at = NOW()
        "#,
    )
    .bind(account_id)
    .bind(initial_forward_cursor)
    .bind(prev_cursor)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn mark_history_backfill_done(
    pool: &PgPool,
    account_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO bronze_confidential_history_cursors (
            account_id,
            backfill_done,
            updated_at
        )
        VALUES ($1, true, NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            backfill_done = true,
            updated_at = NOW()
        "#,
    )
    .bind(account_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn record_confidential_history_poll_result(
    pool: &PgPool,
    account_id: &str,
    had_history_changes: bool,
) -> Result<(), sqlx::Error> {
    let now = Utc::now();
    let (current_last_activity_at, awaiting_intent_settlement) =
        sqlx::query_as::<_, (Option<DateTime<Utc>>, bool)>(
            r#"
        SELECT
            (
                SELECT last_confidential_activity_at
                FROM bronze_confidential_history_cursors
                WHERE account_id = $1
            ),
            EXISTS (
                SELECT 1
                FROM confidential_intents ci
                LEFT JOIN bronze_confidential_history_events he
                  ON he.id = ci.history_event_id
                WHERE ci.dao_id = $1
                  AND ci.status = 'submitted'
                  AND COALESCE(ci.proposal_executed_at, ci.created_at)
                      > NOW() - INTERVAL '10 minutes'
                  AND (he.id IS NULL OR NOT (UPPER(he.status) = ANY($2)))
            )
        "#,
        )
        .bind(account_id)
        .bind(ONECLICK_TERMINAL_STATUSES)
        .fetch_one(pool)
        .await?;

    let last_confidential_activity_at = if had_history_changes {
        Some(now)
    } else {
        current_last_activity_at
    };
    let delay = confidential_history_next_poll_delay(
        had_history_changes,
        awaiting_intent_settlement,
        last_confidential_activity_at,
        now,
    );
    let next_poll_at = now + delay;

    sqlx::query(
        r#"
        INSERT INTO bronze_confidential_history_cursors (
            account_id,
            last_confidential_activity_at,
            next_poll_at,
            updated_at
        )
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            last_confidential_activity_at = EXCLUDED.last_confidential_activity_at,
            next_poll_at = EXCLUDED.next_poll_at,
            updated_at = NOW()
        "#,
    )
    .bind(account_id)
    .bind(last_confidential_activity_at)
    .bind(next_poll_at)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn mark_confidential_history_activity_due(
    pool: &PgPool,
    account_id: &str,
) -> Result<(), sqlx::Error> {
    let now = Utc::now();

    sqlx::query(
        r#"
        INSERT INTO bronze_confidential_history_cursors (
            account_id,
            last_confidential_activity_at,
            next_poll_at,
            updated_at
        )
        VALUES ($1, $2, $2, NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            last_confidential_activity_at = EXCLUDED.last_confidential_activity_at,
            next_poll_at = EXCLUDED.next_poll_at,
            updated_at = NOW()
        "#,
    )
    .bind(account_id)
    .bind(now)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn load_confidential_history_accounts(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT account_id
        FROM monitored_accounts
        WHERE enabled = true
          AND is_confidential_account = true
        ORDER BY account_id
        "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn load_due_confidential_history_accounts(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT ma.account_id
        FROM monitored_accounts ma
        LEFT JOIN bronze_confidential_history_cursors chc
          ON chc.account_id = ma.account_id
        WHERE ma.enabled = true
          AND ma.is_confidential_account = true
          AND (
              chc.account_id IS NULL
              OR chc.next_poll_at IS NULL
              OR chc.next_poll_at <= NOW()
          )
        ORDER BY chc.next_poll_at ASC NULLS FIRST, ma.account_id ASC
        LIMIT $1
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_confidential_history_next_poll_delay_uses_activity_only() {
        let now = DateTime::parse_from_rfc3339("2026-05-20T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        assert_eq!(
            confidential_history_next_poll_delay(true, false, None, now),
            HOT_POLL_DELAY
        );
        assert_eq!(
            confidential_history_next_poll_delay(
                false,
                false,
                Some(now - Duration::minutes(30)),
                now
            ),
            RECENT_POLL_DELAY
        );
        assert_eq!(
            confidential_history_next_poll_delay(
                false,
                false,
                Some(now - Duration::hours(12)),
                now
            ),
            WARM_POLL_DELAY
        );
        assert_eq!(
            confidential_history_next_poll_delay(
                false,
                false,
                Some(now - Duration::hours(72)),
                now
            ),
            INACTIVE_POLL_DELAY
        );
        assert_eq!(
            confidential_history_next_poll_delay(false, false, None, now),
            INACTIVE_POLL_DELAY
        );
    }

    #[test]
    fn test_awaiting_intent_settlement_overrides_every_tier() {
        let now = DateTime::parse_from_rfc3339("2026-05-20T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        assert_eq!(
            confidential_history_next_poll_delay(true, true, Some(now), now),
            AWAIT_SETTLEMENT_POLL_DELAY
        );
        assert_eq!(
            confidential_history_next_poll_delay(false, true, None, now),
            AWAIT_SETTLEMENT_POLL_DELAY
        );
        assert_eq!(
            confidential_history_next_poll_delay(false, true, Some(now - Duration::hours(72)), now),
            AWAIT_SETTLEMENT_POLL_DELAY
        );
    }
}

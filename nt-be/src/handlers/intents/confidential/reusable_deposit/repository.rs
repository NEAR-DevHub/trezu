//! The cached set on `monitored_accounts`.

use chrono::{DateTime, Duration, Utc};
use reqwest::StatusCode;
use serde_json::Value;
use sqlx::PgPool;

use super::types::ReusableDepositAddresses;

pub(super) struct CachedSet {
    pub(super) set: ReusableDepositAddresses,
    pub(super) confirmed_at: Option<DateTime<Utc>>,
}

impl CachedSet {
    pub(super) fn confirmed_within(&self, window: Duration, now: DateTime<Utc>) -> bool {
        self.confirmed_at
            .is_some_and(|confirmed_at| now - confirmed_at < window)
    }
}

pub(super) async fn load_cached_entry(
    pool: &PgPool,
    dao_id: &str,
) -> Result<Option<CachedSet>, sqlx::Error> {
    let stored: Option<(Option<Value>, Option<DateTime<Utc>>)> = sqlx::query_as(
        r#"
        SELECT confidential_reusable_deposit, confidential_reusable_deposit_updated_at
        FROM monitored_accounts
        WHERE account_id = $1
        "#,
    )
    .bind(dao_id)
    .fetch_optional(pool)
    .await?;
    let Some((Some(value), confirmed_at)) = stored else {
        return Ok(None);
    };
    Ok(serde_json::from_value(value)
        .inspect_err(|e| tracing::warn!(dao_id, "stored reusable deposit set is unreadable: {e}"))
        .ok()
        .map(|set| CachedSet { set, confirmed_at }))
}

pub async fn load_cached(
    pool: &PgPool,
    dao_id: &str,
) -> Result<Option<ReusableDepositAddresses>, sqlx::Error> {
    Ok(load_cached_entry(pool, dao_id)
        .await?
        .map(|cached| cached.set))
}

pub(super) async fn store_cached(
    pool: &PgPool,
    dao_id: &str,
    set: &ReusableDepositAddresses,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE monitored_accounts
        SET confidential_reusable_deposit = $2,
            confidential_reusable_deposit_updated_at = NOW(),
            updated_at = NOW()
        WHERE account_id = $1
        "#,
    )
    .bind(dao_id)
    .bind(serde_json::to_value(set).expect("reusable deposit set serialises"))
    .execute(pool)
    .await?;
    Ok(())
}

/// Forget the cached set so the next request re-discovers it (1Click no
/// longer knows the quote).
pub async fn clear_cached(pool: &PgPool, dao_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE monitored_accounts
        SET confidential_reusable_deposit = NULL,
            confidential_reusable_deposit_updated_at = NOW(),
            updated_at = NOW()
        WHERE account_id = $1
        "#,
    )
    .bind(dao_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub(super) fn db_error(error: sqlx::Error) -> (StatusCode, String) {
    tracing::error!("reusable deposit set storage failed: {error}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to read reusable deposit set".to_string(),
    )
}

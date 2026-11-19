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

/// Whether the set can be stored for this treasury at all.
pub(super) async fn is_monitored(pool: &PgPool, dao_id: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM monitored_accounts WHERE account_id = $1)")
        .bind(dao_id)
        .fetch_one(pool)
        .await
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

/// Store a public treasury's set unless one is already stored, and return
/// the stored one: 1Click cannot list a public set again, so the first
/// stored copy is the treasury's address for good.
pub(super) async fn store_first(
    pool: &PgPool,
    dao_id: &str,
    set: &ReusableDepositAddresses,
) -> Result<ReusableDepositAddresses, sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE monitored_accounts
        SET confidential_reusable_deposit = $2,
            confidential_reusable_deposit_updated_at = NOW(),
            updated_at = NOW()
        WHERE account_id = $1 AND confidential_reusable_deposit IS NULL
        "#,
    )
    .bind(dao_id)
    .bind(serde_json::to_value(set).expect("reusable deposit set serialises"))
    .execute(pool)
    .await?;
    Ok(load_cached(pool, dao_id)
        .await?
        .unwrap_or_else(|| set.clone()))
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

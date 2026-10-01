use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;

/// Outcome of the last inline ledger-vs-1Click balance check for a DAO.
#[derive(Debug, Clone, Default, sqlx::FromRow)]
pub(crate) struct BalanceCheckState {
    pub balance_check_failed_at: Option<DateTime<Utc>>,
    pub balance_check_mismatch: Option<Value>,
}

impl BalanceCheckState {
    pub fn is_failed(&self) -> bool {
        self.balance_check_failed_at.is_some()
    }

    /// Assets named in the recorded mismatch, for change detection between checks.
    pub fn mismatched_assets(&self) -> Vec<String> {
        let mut assets: Vec<String> = self
            .balance_check_mismatch
            .as_ref()
            .and_then(Value::as_object)
            .map(|map| map.keys().cloned().collect())
            .unwrap_or_default();
        assets.sort();
        assets
    }

    /// Drifting assets this round could not compare, so the flag must stay.
    /// A failure without per-asset detail (e.g. set by hand) is only cleared
    /// by a check that compared every asset.
    pub fn unresolved_assets(&self, unverifiable: &HashSet<String>) -> Vec<String> {
        if !self.is_failed() {
            return Vec::new();
        }
        let mut assets: Vec<String> = match self.balance_check_mismatch {
            Some(_) => self
                .mismatched_assets()
                .into_iter()
                .filter(|asset| unverifiable.contains(asset))
                .collect(),
            None => unverifiable.iter().cloned().collect(),
        };
        assets.sort();
        assets
    }

    pub fn mismatch_entry(&self, asset: &str) -> Option<&Value> {
        self.balance_check_mismatch
            .as_ref()
            .and_then(Value::as_object)
            .and_then(|map| map.get(asset))
    }
}

pub(crate) async fn load_balance_check_state(
    pool: &PgPool,
    dao_id: &str,
) -> Result<BalanceCheckState, sqlx::Error> {
    let state = sqlx::query_as::<_, BalanceCheckState>(
        r#"
        SELECT balance_check_failed_at, balance_check_mismatch
        FROM gold_confidential_history_cursors
        WHERE account_id = $1
        "#,
    )
    .bind(dao_id)
    .fetch_optional(pool)
    .await?;
    Ok(state.unwrap_or_default())
}

/// True while the DAO's ledger heads disagree with 1Click; readers then
/// serve live balances instead of the ledger.
pub(crate) async fn is_balance_check_failed(
    pool: &PgPool,
    dao_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM gold_confidential_history_cursors
            WHERE account_id = $1
              AND balance_check_failed_at IS NOT NULL
        )
        "#,
    )
    .bind(dao_id)
    .fetch_one(pool)
    .await
}

/// Keeps the original failure time across repeated failing checks.
pub(crate) async fn record_balance_check_failed(
    pool: &PgPool,
    dao_id: &str,
    mismatch: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO gold_confidential_history_cursors (
            account_id,
            balance_checked_at,
            balance_check_failed_at,
            balance_check_mismatch,
            updated_at
        )
        VALUES ($1, NOW(), NOW(), $2, NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            balance_checked_at = NOW(),
            balance_check_failed_at = COALESCE(gold_confidential_history_cursors.balance_check_failed_at, NOW()),
            balance_check_mismatch = EXCLUDED.balance_check_mismatch,
            updated_at = NOW()
        "#,
    )
    .bind(dao_id)
    .bind(mismatch)
    .execute(pool)
    .await?;
    Ok(())
}

pub(crate) async fn record_balance_check_passed(
    pool: &PgPool,
    dao_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO gold_confidential_history_cursors (account_id, balance_checked_at, updated_at)
        VALUES ($1, NOW(), NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            balance_checked_at = NOW(),
            balance_check_failed_at = NULL,
            balance_check_mismatch = NULL,
            updated_at = NOW()
        "#,
    )
    .bind(dao_id)
    .execute(pool)
    .await?;
    Ok(())
}

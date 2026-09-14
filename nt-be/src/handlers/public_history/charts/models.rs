use std::collections::HashMap;

use bigdecimal::BigDecimal;
use chrono::{DateTime, Months, Utc};
use near_api::AccountId;
use serde::{Deserialize, Serialize};

use crate::utils::serde::comma_separated;

/// One balance-bearing gold leg unpivoted for chart carry-forward: the
/// asset's absolute balance after the event, in chain chronology.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct GoldBalancePoint {
    pub asset: String,
    pub balance: BigDecimal,
    pub at_time: DateTime<Utc>,
    pub at_height: i64,
    pub gold_id: i64,
    pub leg_order: i32,
}

/// Everything the chart endpoint needs to decide Ok / Stale / Unavailable in
/// one read: gold projection readiness plus the verification gate.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ChartReadiness {
    pub projection_ready: bool,
    pub projection_ready_at: Option<DateTime<Utc>>,
    pub gold_dirty: bool,
    pub verification_passed: bool,
    pub head_check_failed: bool,
    /// False while a validated staking pool still has uncovered chart-horizon
    /// boundaries — a partially backfilled staked series would be misleading.
    pub staking_ready: bool,
    /// Preserves the distinction between an empty requested range/token filter
    /// and a projection that has no balance-bearing Gold rows at all.
    pub has_gold_balance_points: bool,
    pub ledger_coverage_start: Option<DateTime<Utc>>,
    pub ledger_head_time: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Interval {
    Hourly,
    Daily,
    Weekly,
    Monthly,
}

impl Interval {
    /// Increments the given DateTime by one interval period
    ///
    /// For monthly intervals, this properly handles month boundaries by advancing
    /// to the same day of the next month (e.g., Feb 1 -> Mar 1, not Feb 1 -> Mar 3).
    /// If the day is invalid for the target month (e.g., Jan 31 -> Feb), it clamps
    /// to the last valid day of the target month (e.g., Feb 28 or Feb 29).
    pub fn increment(&self, datetime: DateTime<Utc>) -> DateTime<Utc> {
        match self {
            Interval::Hourly => datetime + chrono::Duration::hours(1),
            Interval::Daily => datetime + chrono::Duration::days(1),
            Interval::Weekly => datetime + chrono::Duration::weeks(1),
            Interval::Monthly => datetime.checked_add_months(Months::new(1)).unwrap(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartRequest {
    pub account_id: AccountId,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub interval: Interval,
    #[serde(default, deserialize_with = "comma_separated")]
    pub token_ids: Option<Vec<String>>, // Comma-separated list, e.g., "near,wrap.near"
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSnapshot {
    pub timestamp: String,   // ISO 8601 format
    pub balance: BigDecimal, // Decimal-adjusted balance
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_usd: Option<f64>, // USD price at timestamp (null if unavailable)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_usd: Option<f64>, // balance * price_usd (null if unavailable)
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChartStatus {
    Ok,
    Stale,
    Unavailable,
}

/// Freshness of the data source backing a chart response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartMeta {
    pub status: ChartStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_snapshot_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage_start: Option<DateTime<Utc>>,
}

/// Chart response with metadata
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartResponse {
    #[serde(flatten)]
    pub data: HashMap<String, Vec<BalanceSnapshot>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_synced_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_meta: Option<ChartMeta>,
}

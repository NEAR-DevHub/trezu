//! Balance History APIs
//!
//! Provides endpoints for querying historical balance data:
//! - Chart API: Returns balance snapshots at specified intervals
//! - CSV Export: Returns raw balance changes as downloadable CSV
//! - Export History: Track and manage export credits

use axum::{
    Json,
    body::Body,
    extract::{Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use bigdecimal::{BigDecimal, ToPrimitive};
use chrono::{DateTime, Months, Utc};
use near_account_id::AccountIdRef;
use near_api::AccountId;
use rust_xlsxwriter::{Color, Format, Workbook};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use std::sync::Arc;
use urlencoding::encode;

use crate::config::get_plan_config;
use crate::handlers::public_history::{confidential_list, public_list};
use crate::handlers::subscription::plans::get_account_plan_info;
use crate::handlers::token::{TokenMetadata, fetch_tokens_with_fallback};
use crate::routes::{
    BalanceChangesQuery, BalanceChangesReadSource, EnrichedBalanceChange,
    get_balance_changes_from_source, get_balance_changes_internal,
    resolve_balance_changes_read_source,
};
use crate::utils::serde::comma_separated;
use crate::{AppState, auth::OptionalAuthUser};

// ============================================================================
// Shared Helper Functions
// ============================================================================

pub use crate::handlers::public_history::charts::models::{
    BalanceSnapshot, ChartMeta, ChartRequest, ChartResponse, ChartStatus, Interval,
};

/// Chart API - returns balance snapshots at intervals
///
/// Response format: { "token_id": [...], "lastSyncedAt": "..." }
pub async fn get_balance_chart(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Query(params): Query<ChartRequest>,
) -> Result<Json<ChartResponse>, (StatusCode, String)> {
    user.verify_member_if_confidential(&state.db_pool, &params.account_id)
        .await?;

    let is_confidential =
        confidential_list::is_confidential_dao(&state.db_pool, params.account_id.as_str())
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let response = if is_confidential {
        crate::handlers::public_history::charts::chart::build_confidential_chart_response(
            &state,
            params.account_id.as_str(),
            params.start_time,
            params.end_time,
            &params.interval,
            params.token_ids.as_ref(),
        )
        .await?
    } else {
        crate::handlers::public_history::charts::chart::build_public_chart_response(
            &state,
            params.account_id.as_str(),
            params.start_time,
            params.end_time,
            &params.interval,
            params.token_ids.as_ref(),
        )
        .await?
    };

    Ok(Json(response))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub account_id: AccountId,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    #[serde(default, deserialize_with = "comma_separated")]
    pub token_ids: Option<Vec<String>>, // Comma-separated list
    #[serde(default, deserialize_with = "comma_separated")]
    pub transaction_types: Option<Vec<String>>, // Comma-separated: "sent", "received", "staking_rewards", "all"
    pub generated_by: Option<String>, // User who requested the export
    pub email: Option<String>,        // Email for notifications
    pub format: String,               // csv, json, or xlsx
}

/// Unified export endpoint - handles CSV, JSON, and XLSX exports
///
/// Accepts a `format` query parameter to determine the export type
/// Excludes SNAPSHOT and NOT_REGISTERED records
/// Validates date range based on user's plan limits
/// Creates export history record and decrements credits
pub async fn export_balance(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Query(params): Query<ExportRequest>,
) -> Result<Response, (StatusCode, String)> {
    user.verify_member_if_confidential(&state.db_pool, &params.account_id)
        .await?;

    // Validate format
    if !["csv", "json", "xlsx"].contains(&params.format.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "Invalid format: {}. Must be csv, json, or xlsx",
                params.format
            ),
        ));
    }

    let (filename, data, content_type) = handle_export(&state, &params, &params.format).await?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (
                header::CONTENT_DISPOSITION,
                &format!("attachment; filename=\"{}\"", filename),
            ),
        ],
        Body::from(data),
    )
        .into_response())
}
/// Build file URL for export with all filter parameters
fn build_export_file_url(params: &ExportRequest, format: &str) -> String {
    let mut url = format!(
        "/api/balance-history/export?format={}&accountId={}&startTime={}&endTime={}",
        format,
        encode(params.account_id.as_str()),
        encode(&params.start_time.to_rfc3339()),
        encode(&params.end_time.to_rfc3339())
    );

    if let Some(ref token_ids) = params.token_ids {
        url.push_str(&format!("&tokenIds={}", encode(&token_ids.join(","))));
    }

    if let Some(ref transaction_types) = params.transaction_types
        && !transaction_types.is_empty()
        && !transaction_types.contains(&"all".to_string())
    {
        url.push_str(&format!(
            "&transactionTypes={}",
            encode(&transaction_types.join(","))
        ));
    }

    url
}

/// Internal helper that processes all export formats
async fn handle_export(
    state: &Arc<AppState>,
    params: &ExportRequest,
    format: &str,
) -> Result<(String, Vec<u8>, &'static str), (StatusCode, String)> {
    // Validate date range based on plan
    validate_export_date_range(
        &state.db_pool,
        params.account_id.as_str(),
        params.start_time,
    )
    .await?;

    // Generate export data
    let (data, content_type) = match format {
        "csv" => {
            let csv_data = generate_csv(
                state,
                &params.account_id,
                params.start_time,
                params.end_time,
                params.token_ids.as_ref(),
                params.transaction_types.as_ref(),
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            (csv_data.into_bytes(), "text/csv; charset=utf-8")
        }
        "json" => {
            let json_data = generate_json(
                state,
                &params.account_id,
                params.start_time,
                params.end_time,
                params.token_ids.as_ref(),
                params.transaction_types.as_ref(),
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            (json_data.into_bytes(), "application/json; charset=utf-8")
        }
        "xlsx" => {
            let xlsx_data = generate_xlsx(
                state,
                &params.account_id,
                params.start_time,
                params.end_time,
                params.token_ids.as_ref(),
                params.transaction_types.as_ref(),
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            (
                xlsx_data,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Unsupported format: {}", format),
            ));
        }
    };

    // Build file URL with all parameters
    let file_url = build_export_file_url(params, format);

    // Only after successful generation, create export record and decrement credits
    let _export_id = create_export_record(
        &state.db_pool,
        CreateExportRequest {
            account_id: params.account_id.to_string(),
            generated_by: params
                .generated_by
                .clone()
                .unwrap_or_else(|| params.account_id.to_string()),
            email: params.email.clone(),
            file_url,
        },
    )
    .await
    .map_err(|e| (StatusCode::FORBIDDEN, e.to_string()))?;

    crate::services::platform_metrics::record_event(
        &state.db_pool,
        params.account_id.as_str(),
        crate::services::platform_metrics::PlatformMetric::ExportsUsed,
    )
    .await;

    // Format dates as YYYY-MM-DD for cleaner filename
    let start_date = params.start_time.format("%Y-%m-%d").to_string();
    let end_date = params.end_time.format("%Y-%m-%d").to_string();

    let filename = format!(
        "{}_activity_{}_{}.{}",
        params.account_id, start_date, end_date, format
    );

    Ok((filename, data, content_type))
}

/// Helper function to build BalanceChangesQuery for export
fn build_export_query(
    account_id: &AccountIdRef,
    start_date: DateTime<Utc>,
    end_date: DateTime<Utc>,
    token_ids: Option<&Vec<String>>,
    transaction_types: Option<&Vec<String>>,
) -> BalanceChangesQuery {
    BalanceChangesQuery {
        account_id: account_id.to_owned(),
        limit: None, // Export all
        offset: None,
        start_time: Some(start_date.to_rfc3339()),
        end_time: Some(end_date.to_rfc3339()),
        token_ids: token_ids.cloned(),
        exclude_token_ids: None,
        transaction_types: transaction_types.cloned(),
        min_amount: None,
        max_amount: None,
        tx_hash: None,
        from_accounts: None,
        from_accounts_not: None,
        to_accounts: None,
        to_accounts_not: None,
        include_metadata: Some(true), // Export needs metadata (symbol, contract)
        include_prices: Some(true),   // Export needs prices (USD values)
        include_chain_metadata: Some(false), // Export doesn't need chain metadata
        exclude_near_dust: false,
        exclude_swaps_from_direction: false, // Export: include swaps in incoming/outgoing
    }
}

/// Accounting-friendly export record structure
#[derive(Debug, Clone)]
struct ExportRecord {
    date: String,
    time: String,
    direction: String,
    from_address: String,
    to_address: String,
    asset_symbol: String,
    asset_contract_address: String,
    amount: f64,
    balance_after: String,
    price_usd: Option<f64>,
    value_usd: Option<f64>,
    transaction_hash: String,
    receipt_id: String,
}

/// USD value of a balance change, preferring the value computed at quote time.
///
/// Confidential rows persist `amount_usd` (the exact quote-time USD) in
/// `usd_value`, so we use it directly — it's accurate and needs no price-table
/// lookup. Public rows have no stored value, so fall back to a spot
/// `price × amount` estimate.
fn resolve_value_usd(change: &EnrichedBalanceChange, price: Option<f64>) -> Option<f64> {
    if let Some(stored) = change.usd_value.as_ref().and_then(|v| v.to_f64()) {
        return Some(stored.abs());
    }
    change
        .amount
        .abs()
        .to_f64()
        .zip(price)
        .map(|(amount, price)| amount * price)
}

/// Convert enriched balance changes to accounting-friendly export records
fn transform_to_export_records(
    enriched_changes: Vec<EnrichedBalanceChange>,
    account_id: &str,
) -> Vec<ExportRecord> {
    enriched_changes
        .into_iter()
        .map(|change| {
            let metadata = change
                .token_metadata
                .as_ref()
                .expect("Metadata should always be present");

            let price = metadata.price;
            let amount_val = change.amount.abs().to_f64().unwrap_or(0.0);
            let value_usd = resolve_value_usd(&change, price);

            // Determine direction and addresses
            let is_incoming = change.amount.to_f64().map(|a| a > 0.0).unwrap_or(false);
            let direction = if is_incoming { "in" } else { "out" };
            let from_address = if is_incoming {
                change.counterparty.as_deref().unwrap_or("")
            } else {
                account_id
            };
            let to_address = if is_incoming {
                account_id
            } else {
                change.counterparty.as_deref().unwrap_or("")
            };

            // Split date and time
            let datetime = change.block_time;
            let date = datetime.format("%Y-%m-%d").to_string();
            let time = datetime.format("%H:%M:%S UTC").to_string();

            // Use first transaction hash and receipt ID
            let transaction_hash = change
                .transaction_hashes
                .first()
                .map(|h| h.to_string())
                .unwrap_or_default();

            let receipt_id = change
                .receipt_id
                .first()
                .map(|r| r.to_string())
                .unwrap_or_default();

            // Remove "intents.near:" prefix from token_id for cleaner export
            let asset_contract_address = change
                .token_id
                .strip_prefix("intents.near:")
                .unwrap_or(&change.token_id)
                .to_string();

            ExportRecord {
                date,
                time,
                direction: direction.to_string(),
                from_address: from_address.to_string(),
                to_address: to_address.to_string(),
                asset_symbol: metadata.symbol.clone(),
                asset_contract_address,
                amount: amount_val,
                balance_after: change.balance_after.to_string(),
                price_usd: price,
                value_usd,
                transaction_hash,
                receipt_id,
            }
        })
        .collect()
}

/// Generate CSV from enriched balance changes
async fn generate_csv(
    state: &Arc<AppState>,
    account_id: &AccountIdRef,
    start_date: DateTime<Utc>,
    end_date: DateTime<Utc>,
    token_ids: Option<&Vec<String>>,
    transaction_types: Option<&Vec<String>>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let query = build_export_query(
        account_id,
        start_date,
        end_date,
        token_ids,
        transaction_types,
    );
    let enriched = get_balance_changes_internal(state, &query).await?;
    let records = transform_to_export_records(enriched, account_id.as_str());

    let mut csv = String::new();

    // Header (accounting-friendly format)
    csv.push_str("date,time,direction,from_address,to_address,asset_symbol,asset_contract_address,amount,balance_after,price_usd,value_usd,transaction_hash,receipt_id\n");

    // Rows
    for record in records {
        let price_str = record.price_usd.map(|p| p.to_string()).unwrap_or_default();
        let value_str = record.value_usd.map(|v| v.to_string()).unwrap_or_default();

        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
            record.date,
            record.time,
            record.direction,
            record.from_address,
            record.to_address,
            record.asset_symbol,
            record.asset_contract_address,
            record.amount,
            record.balance_after,
            price_str,
            value_str,
            record.transaction_hash,
            record.receipt_id
        ));
    }

    Ok(csv)
}

/// Generate JSON from enriched balance changes
async fn generate_json(
    state: &Arc<AppState>,
    account_id: &AccountIdRef,
    start_date: DateTime<Utc>,
    end_date: DateTime<Utc>,
    token_ids: Option<&Vec<String>>,
    transaction_types: Option<&Vec<String>>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let query = build_export_query(
        account_id,
        start_date,
        end_date,
        token_ids,
        transaction_types,
    );
    let enriched = get_balance_changes_internal(state, &query).await?;
    let records = transform_to_export_records(enriched, account_id.as_str());

    // Convert to JSON-friendly format
    let json_records: Vec<serde_json::Value> = records
        .into_iter()
        .map(|record| {
            serde_json::json!({
                "date": record.date,
                "time": record.time,
                "direction": record.direction,
                "from_address": record.from_address,
                "to_address": record.to_address,
                "asset_symbol": record.asset_symbol,
                "asset_contract_address": record.asset_contract_address,
                "amount": record.amount,
                "balance_after": record.balance_after,
                "price_usd": record.price_usd,
                "value_usd": record.value_usd,
                "transaction_hash": record.transaction_hash,
                "receipt_id": record.receipt_id,
            })
        })
        .collect();

    Ok(serde_json::to_string_pretty(&json_records)?)
}

/// Generate XLSX from enriched balance changes
async fn generate_xlsx(
    state: &Arc<AppState>,
    account_id: &AccountIdRef,
    start_date: DateTime<Utc>,
    end_date: DateTime<Utc>,
    token_ids: Option<&Vec<String>>,
    transaction_types: Option<&Vec<String>>,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let query = build_export_query(
        account_id,
        start_date,
        end_date,
        token_ids,
        transaction_types,
    );
    let enriched = get_balance_changes_internal(state, &query).await?;
    let records = transform_to_export_records(enriched, account_id.as_str());

    // Create workbook
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();

    // Create header format
    let header_format = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x4472C4))
        .set_font_color(Color::White);

    // Write headers
    let headers = vec![
        "Date",
        "Time",
        "Direction",
        "From Address",
        "To Address",
        "Asset Symbol",
        "Asset Contract Address",
        "Amount",
        "Balance After",
        "Price USD",
        "Value USD",
        "Transaction Hash",
        "Receipt ID",
    ];

    for (col, header) in headers.iter().enumerate() {
        worksheet.write_with_format(0, col as u16, *header, &header_format)?;
    }

    // Write data rows
    for (row, record) in (1u32..).zip(records) {
        worksheet.write(row, 0, record.date)?;
        worksheet.write(row, 1, record.time)?;
        worksheet.write(row, 2, record.direction)?;
        worksheet.write(row, 3, record.from_address)?;
        worksheet.write(row, 4, record.to_address)?;
        worksheet.write(row, 5, record.asset_symbol)?;
        worksheet.write(row, 6, record.asset_contract_address)?;
        worksheet.write(row, 7, record.amount)?;
        worksheet.write(row, 8, record.balance_after)?;

        if let Some(p) = record.price_usd {
            worksheet.write(row, 9, p)?;
        } else {
            worksheet.write(row, 9, "")?;
        }

        if let Some(value) = record.value_usd {
            worksheet.write(row, 10, value)?;
        } else {
            worksheet.write(row, 10, "")?;
        }

        worksheet.write(row, 11, record.transaction_hash)?;
        worksheet.write(row, 12, record.receipt_id)?;
    }

    // Auto-fit columns
    worksheet.autofit();

    let buffer = workbook.save_to_buffer()?;

    Ok(buffer)
}

/// Validate that the export date range is within the user's plan limits
///
/// Returns an error if the start_time is before the earliest allowed date
/// based on the user's plan history_lookup_months limit
async fn validate_export_date_range(
    pool: &sqlx::PgPool,
    account_id: &str,
    start_time: DateTime<Utc>,
) -> Result<(), (StatusCode, String)> {
    // Get account plan info
    let account_plan = get_account_plan_info(pool, account_id).await.map_err(|e| {
        tracing::error!("Failed to fetch account plan info: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to check subscription status: {}", e),
        )
    })?;

    // If account not found, default to Free plan
    let plan_config = if let Some(plan) = account_plan {
        get_plan_config(plan.plan_type)
    } else {
        // Default to Free plan if account not monitored
        get_plan_config(crate::config::PlanType::Free)
    };

    // Calculate the earliest allowed date based on plan
    // Subtract 1 day to include the boundary (more lenient)
    let history_months = plan_config.limits.history_lookup_months;
    let earliest_allowed = Utc::now()
        .checked_sub_months(Months::new(history_months as u32))
        .unwrap_or(Utc::now())
        - chrono::Duration::days(1);

    // Check if start_time is before the earliest allowed date
    if start_time < earliest_allowed {
        return Err((
            StatusCode::FORBIDDEN,
            format!(
                "Export start date is outside your plan's history limit. Your plan allows access to the last {} months of data. Earliest allowed date: {}",
                history_months,
                earliest_allowed.format("%Y-%m-%d")
            ),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn start_bound_uses_requested_start_when_inside_plan_window() {
        // Regression: the plan cutoff used to win unconditionally, so a
        // `startDate` inside the plan window was dropped and older rows
        // (e.g. July) leaked into an August-only request.
        let cutoff = Utc.with_ymd_and_hms(2026, 2, 25, 0, 0, 0).unwrap();
        let start = Utc.with_ymd_and_hms(2026, 8, 18, 22, 0, 0).unwrap();

        assert_eq!(narrower_start_bound(Some(cutoff), Some(start)), Some(start));
    }

    #[test]
    fn start_bound_keeps_plan_cutoff_when_requested_start_is_older() {
        let cutoff = Utc.with_ymd_and_hms(2026, 2, 25, 0, 0, 0).unwrap();
        let start = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();

        assert_eq!(
            narrower_start_bound(Some(cutoff), Some(start)),
            Some(cutoff)
        );
    }

    #[test]
    fn start_bound_falls_back_to_whichever_bound_exists() {
        let bound = Utc.with_ymd_and_hms(2026, 8, 18, 22, 0, 0).unwrap();

        assert_eq!(narrower_start_bound(Some(bound), None), Some(bound));
        assert_eq!(narrower_start_bound(None, Some(bound)), Some(bound));
        assert_eq!(narrower_start_bound(None, None), None);
    }

    #[test]
    fn test_interval_increment_hourly() {
        let dt = Utc.with_ymd_and_hms(2024, 1, 15, 10, 30, 0).unwrap();
        let result = Interval::Hourly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 1, 15, 11, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_daily() {
        let dt = Utc.with_ymd_and_hms(2024, 1, 15, 10, 30, 0).unwrap();
        let result = Interval::Daily.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 1, 16, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_weekly() {
        let dt = Utc.with_ymd_and_hms(2024, 1, 15, 10, 30, 0).unwrap();
        let result = Interval::Weekly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 1, 22, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_normal() {
        // Normal case: Jan 15 -> Feb 15
        let dt = Utc.with_ymd_and_hms(2024, 1, 15, 10, 30, 0).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 2, 15, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_year_boundary() {
        // Dec -> Jan (year boundary)
        let dt = Utc.with_ymd_and_hms(2024, 12, 15, 10, 30, 0).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2025, 1, 15, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_jan_31_to_feb() {
        // Jan 31 -> Feb 29 (leap year - clamp to last valid day)
        let dt = Utc.with_ymd_and_hms(2024, 1, 31, 10, 30, 0).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 2, 29, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_mar_31_to_apr() {
        // Mar 31 -> Apr 30 (clamp to last valid day)
        let dt = Utc.with_ymd_and_hms(2024, 3, 31, 10, 30, 0).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 4, 30, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_may_31_to_jun() {
        // May 31 -> Jun 30 (clamp to last valid day)
        let dt = Utc.with_ymd_and_hms(2024, 5, 31, 10, 30, 0).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 6, 30, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_jan_30_to_feb_non_leap() {
        // Jan 30 -> Feb 28 in non-leap year (clamp to last valid day)
        let dt = Utc.with_ymd_and_hms(2023, 1, 30, 10, 30, 0).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2023, 2, 28, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_jan_29_to_feb_non_leap() {
        // Jan 29 -> Feb 28 in non-leap year (clamp to last valid day)
        let dt = Utc.with_ymd_and_hms(2023, 1, 29, 10, 30, 0).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2023, 2, 28, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_jan_30_to_feb_leap_year() {
        // Jan 30 -> Feb 29 in leap year (clamp to last valid day)
        let dt = Utc.with_ymd_and_hms(2024, 1, 30, 10, 30, 0).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 2, 29, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_jan_29_to_feb_leap_year() {
        // Jan 29 -> Feb 29 in leap year (should work)
        let dt = Utc.with_ymd_and_hms(2024, 1, 29, 10, 30, 0).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 2, 29, 10, 30, 0).unwrap()
        );
    }

    #[test]
    fn test_interval_increment_monthly_preserves_time() {
        // Verify time and timezone are preserved
        let dt = Utc.with_ymd_and_hms(2024, 1, 15, 23, 59, 59).unwrap();
        let result = Interval::Monthly.increment(dt);
        assert_eq!(
            result,
            Utc.with_ymd_and_hms(2024, 2, 15, 23, 59, 59).unwrap()
        );
    }
}

// ============================================================================
// Export History & Credits Management
// ============================================================================

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExportHistoryItem {
    pub id: i64,
    pub account_id: String,
    pub generated_by: String,
    pub email: Option<String>,
    pub status: String,
    pub file_url: String,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportHistoryQuery {
    pub account_id: AccountId,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub from_date: Option<String>, // ISO 8601 date string
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportHistoryResponse {
    pub data: Vec<ExportHistoryItem>,
    pub total: i64,
}

/// Get export history for an account
pub async fn get_export_history(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Query(params): Query<ExportHistoryQuery>,
) -> Result<Json<ExportHistoryResponse>, (StatusCode, String)> {
    user.verify_member_if_confidential(&state.db_pool, &params.account_id)
        .await?;

    let limit = params.limit.unwrap_or(10).min(100);
    let offset = params.offset.unwrap_or(0);

    // Build WHERE clause - show exports from current month OR still active (within 48 hours)
    // This filters to:
    // 1. Exports created on or after 1st of current month, OR
    // 2. Exports created within last 48 hours (even if from previous month)
    let where_clause = r#"
        WHERE account_id = $1
        AND (
            created_at >= DATE_TRUNC('month', NOW())
            OR created_at >= NOW() - INTERVAL '48 hours'
        )
    "#;

    // Get total count
    let total_query = format!("SELECT COUNT(*) FROM export_history {}", where_clause);
    let total = sqlx::query_scalar::<_, i64>(&total_query)
        .bind(params.account_id.as_str())
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Get export history records
    let data_query = format!(
        r#"
        SELECT
            id,
            account_id,
            generated_by,
            email,
            status,
            file_url,
            error_message,
            created_at
        FROM export_history
        {}
        ORDER BY created_at DESC
        LIMIT $2
        OFFSET $3
        "#,
        where_clause
    );

    let data = sqlx::query_as::<_, ExportHistoryItem>(&data_query)
        .bind(params.account_id.as_str())
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db_pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ExportHistoryResponse { data, total }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExportRequest {
    pub account_id: String,
    pub generated_by: String,
    pub email: Option<String>,
    pub file_url: String,
}

/// Create a new export history record and decrement credits
async fn create_export_record(
    pool: &PgPool,
    request: CreateExportRequest,
) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
    // Start a transaction
    let mut tx = pool.begin().await?;

    // Check if an identical export already exists FIRST (before checking credits)
    let existing_export: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT id
        FROM export_history
        WHERE account_id = $1 AND file_url = $2
        LIMIT 1
        "#,
    )
    .bind(&request.account_id)
    .bind(&request.file_url)
    .fetch_optional(&mut *tx)
    .await?;

    let export_id = if let Some(existing_id) = existing_export {
        // Export already exists - don't check or charge credits, just return existing ID
        existing_id
    } else {
        // New export - check if account has enough credits
        let credits: Option<i32> = sqlx::query_scalar(
            r#"
            SELECT export_credits
            FROM monitored_accounts
            WHERE account_id = $1
            FOR UPDATE
            "#,
        )
        .bind(&request.account_id)
        .fetch_optional(&mut *tx)
        .await?;

        let current_credits = credits.unwrap_or(0);
        if current_credits <= 0 {
            return Err("Insufficient export credits".into());
        }

        // Decrement credits
        sqlx::query(
            r#"
        UPDATE monitored_accounts
        SET export_credits = export_credits - 1
        WHERE account_id = $1
        "#,
        )
        .bind(&request.account_id)
        .execute(&mut *tx)
        .await?;

        // Insert export history record
        let new_id: i64 = sqlx::query_scalar(
            r#"
        INSERT INTO export_history (
            account_id,
            generated_by,
            email,
            file_url,
            status
        ) VALUES ($1, $2, $3, $4, 'completed')
        RETURNING id
        "#,
        )
        .bind(&request.account_id)
        .bind(&request.generated_by)
        .bind(&request.email)
        .bind(&request.file_url)
        .fetch_one(&mut *tx)
        .await?;

        new_id
    };

    // Commit transaction
    tx.commit().await?;

    Ok(export_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCreditsQuery {
    pub account_id: String,
}

// ============================================================================
// Recent Activity Endpoint
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentActivityQuery {
    pub account_id: AccountId,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub min_usd_value: Option<f64>,
    pub transaction_type: Option<String>, // "outgoing" | "incoming" | "staking_rewards" | "exchange" (single selection for tabs)
    pub token_symbol: Option<String>,
    pub token_symbol_not: Option<String>,
    pub tx_hash: Option<String>,
    #[serde(rename = "from", default, deserialize_with = "comma_separated")]
    pub from_account: Option<Vec<String>>,
    #[serde(rename = "fromNot", default, deserialize_with = "comma_separated")]
    pub from_account_not: Option<Vec<String>>,
    #[serde(rename = "to", default, deserialize_with = "comma_separated")]
    pub to_account: Option<Vec<String>>,
    #[serde(rename = "toNot", default, deserialize_with = "comma_separated")]
    pub to_account_not: Option<Vec<String>>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentActivityResponse {
    pub data: Vec<RecentActivity>,
    pub total: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentActivitySendersQuery {
    pub account_id: AccountId,
    pub transaction_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentActivitySendersResponse {
    pub options: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentActivityRecipientsQuery {
    pub account_id: AccountId,
    pub transaction_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentActivityRecipientsResponse {
    pub options: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SwapInfo {
    pub sent_token_id: Option<String>,
    pub sent_amount: Option<BigDecimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_token_metadata: Option<TokenMetadata>,
    pub received_token_id: String,
    pub received_amount: Option<BigDecimal>,
    pub received_token_metadata: TokenMetadata,
    pub solver_transaction_hash: String,
    /// "deposit" for the outgoing leg, "fulfillment" for the incoming leg
    pub swap_role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_amount_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received_amount_usd: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentActivity {
    pub id: i64,
    pub block_time: DateTime<Utc>,
    pub token_id: String,
    pub token_metadata: TokenMetadata,
    pub counterparty: Option<String>,
    pub signer_id: Option<String>,
    pub receiver_id: Option<String>,
    pub amount: BigDecimal,
    pub transaction_hashes: Vec<String>,
    pub receipt_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quote_deposit_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub swap: Option<SwapInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method_name: Option<String>,
}

/// `BalanceChangesQuery` carries a single lower time bound, but the plan
/// history cutoff and the caller's `startDate` both narrow the window. Collapse
/// them to whichever is later so the plan limit cannot be bypassed and the
/// requested range is still honoured.
///
/// `endDate` is not part of this helper: the readers take the collapsed
/// value as `start_time` and bind `endDate` separately.
fn narrower_start_bound(
    date_cutoff: Option<DateTime<Utc>>,
    start_date: Option<DateTime<Utc>>,
) -> Option<DateTime<Utc>> {
    match (date_cutoff, start_date) {
        (Some(cutoff), Some(start)) => Some(cutoff.max(start)),
        (cutoff, start) => cutoff.or(start),
    }
}

pub async fn get_recent_activity(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Query(params): Query<RecentActivityQuery>,
) -> Result<Json<RecentActivityResponse>, (StatusCode, Json<serde_json::Value>)> {
    user.verify_member_if_confidential(&state.db_pool, &params.account_id)
        .await
        .map_err(|(status, message)| (status, Json(serde_json::json!({ "error": message }))))?;

    let limit = params.limit.unwrap_or(10).min(100);
    let offset = params.offset.unwrap_or(0);
    let read_source = resolve_balance_changes_read_source(&state, params.account_id.as_str())
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    // Get account plan info and calculate date cutoff
    let account_plan = get_account_plan_info(&state.db_pool, params.account_id.as_str())
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch account plan info: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to check subscription status: {}", e) })),
            )
        })?;

    // If account not found, default to Free plan
    let plan_config = if let Some(plan) = account_plan {
        get_plan_config(plan.plan_type)
    } else {
        // Default to Free plan if account not monitored
        get_plan_config(crate::config::PlanType::Free)
    };

    // Calculate date cutoff for plan limits
    // Subtract 1 day to include the boundary (more lenient)
    let history_months = plan_config.limits.history_lookup_months;
    let date_cutoff = Some(
        Utc::now()
            .checked_sub_months(Months::new(history_months as u32))
            .unwrap_or(Utc::now())
            - chrono::Duration::days(1),
    );

    // Parse user-provided date range filters
    let start_date = params.start_date.as_deref();

    let end_date = params.end_date.as_deref();

    // Convert token symbol to token IDs using NearBlocks search
    let token_ids: Option<Vec<String>> = if let Some(ref symbol) = params.token_symbol {
        match crate::handlers::token::search_token_by_symbol(&state, symbol).await {
            Ok(addresses) => {
                if addresses.is_empty() {
                    None
                } else {
                    Some(addresses)
                }
            }
            Err(e) => {
                tracing::error!("Failed to search token by symbol '{}': {:?}", symbol, e);
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        serde_json::json!({ "error": format!("Failed to search token: {:?}", e) }),
                    ),
                ));
            }
        }
    } else {
        None
    };

    let exclude_token_ids: Option<Vec<String>> = if let Some(ref symbol) = params.token_symbol_not {
        match crate::handlers::token::search_token_by_symbol(&state, symbol).await {
            Ok(addresses) => {
                if addresses.is_empty() {
                    None
                } else {
                    Some(addresses)
                }
            }
            Err(e) => {
                tracing::error!("Failed to search token by symbol '{}': {:?}", symbol, e);
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        serde_json::json!({ "error": format!("Failed to search token: {:?}", e) }),
                    ),
                ));
            }
        }
    } else {
        None
    };

    // For recent activity, "incoming" should exclude staking rewards (shown in separate tab)
    let transaction_types_for_query = params
        .transaction_type
        .as_deref()
        .map(|t| vec![t.to_string()]);

    // One lower time bound: the later of the plan cutoff and the caller's
    // startDate.
    let effective_start_str: Option<String> = narrower_start_bound(
        date_cutoff,
        start_date
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc)),
    )
    .map(|dt| dt.to_rfc3339());

    let source_count_query = BalanceChangesQuery {
        account_id: params.account_id.clone(),
        limit: None,
        offset: None,
        start_time: effective_start_str.clone(),
        end_time: end_date.map(|s| s.to_string()),
        token_ids: token_ids.clone(),
        exclude_token_ids: exclude_token_ids.clone(),
        transaction_types: transaction_types_for_query.clone(),
        min_amount: None,
        max_amount: None,
        tx_hash: params.tx_hash.clone(),
        from_accounts: params.from_account.clone(),
        from_accounts_not: params.from_account_not.clone(),
        to_accounts: params.to_account.clone(),
        to_accounts_not: params.to_account_not.clone(),
        include_metadata: Some(false),
        include_prices: Some(false),
        include_chain_metadata: Some(false),
        exclude_near_dust: true,
        exclude_swaps_from_direction: true,
    };
    let total: i64 = match read_source {
        BalanceChangesReadSource::Confidential => {
            confidential_list::count_balance_change_legs(&state.db_pool, &source_count_query)
                .await
                .unwrap_or(0)
        }
        BalanceChangesReadSource::PublicGold => {
            public_list::count_balance_change_legs(&state.db_pool, &source_count_query)
                .await
                .unwrap_or(0)
        }
    };

    // If min_usd_value filter is specified, we need to fetch more records and filter them
    // because we can't filter by USD value in the database (prices come from API)
    let fetch_limit = if params.min_usd_value.is_some() {
        // Fetch more records to account for filtering
        // This is a heuristic - fetch 5x the requested limit
        limit.saturating_mul(5).min(500)
    } else {
        limit
    };

    // Use the source already selected for this request so the rows cannot
    // switch stores after the count query has completed.
    let balance_query = BalanceChangesQuery {
        account_id: params.account_id.clone(),
        limit: Some(fetch_limit),
        offset: Some(offset),
        start_time: effective_start_str,
        end_time: end_date.map(|s| s.to_string()),
        token_ids: token_ids.clone(),
        exclude_token_ids: exclude_token_ids.clone(),
        transaction_types: transaction_types_for_query,
        min_amount: None,
        max_amount: None,
        tx_hash: params.tx_hash.clone(),
        from_accounts: params.from_account.clone(),
        from_accounts_not: params.from_account_not.clone(),
        to_accounts: params.to_account.clone(),
        to_accounts_not: params.to_account_not.clone(),
        include_metadata: Some(true),
        include_prices: Some(true),
        include_chain_metadata: Some(false), // Recent activity doesn't need chain metadata here (will be added for swaps later)
        exclude_near_dust: true,
        exclude_swaps_from_direction: true, // Recent activity: exclude swaps from incoming/outgoing (separate Exchange tab)
    };

    let mut enriched_changes = get_balance_changes_from_source(&state, &balance_query, read_source)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch recent activity: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to fetch recent activity",
                    "details": e.to_string()
                })),
            )
        })?;

    // Enrich all recent-activity rows with chain metadata
    let activity_token_ids: Vec<String> = enriched_changes
        .iter()
        .map(|c| c.token_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    if !activity_token_ids.is_empty() {
        let chain_metadata_map =
            fetch_tokens_with_fallback(&state, &activity_token_ids, true, false).await;
        for change in &mut enriched_changes {
            if let Some(ref mut metadata) = change.token_metadata
                && let Some(chain_meta) = chain_metadata_map.get(&change.token_id)
            {
                if chain_meta.network.is_some() {
                    metadata.network = chain_meta.network.clone();
                }
                if chain_meta.chain_name.is_some() {
                    metadata.chain_name = chain_meta.chain_name.clone();
                }
                if chain_meta.chain_icons.is_some() {
                    metadata.chain_icons = chain_meta.chain_icons.clone();
                }
            }
        }
    }

    // Convert enriched changes to RecentActivity format with swap info
    let activities: Vec<RecentActivity> = enriched_changes
        .into_iter()
        .filter_map(|change| {
            // Metadata should always be present since include_metadata=true
            let token_metadata = change
                .token_metadata
                .as_ref()
                .expect("Metadata should always be present");

            // Prefer the stored quote-time USD (confidential rows); fall back to a
            // spot price estimate for public rows that have none.
            let value_usd = resolve_value_usd(&change, token_metadata.price);

            // Filter by minimum USD value if specified
            if let Some(min_usd) = params.min_usd_value {
                let usd_value = value_usd?;
                if usd_value < min_usd {
                    return None;
                }
            }

            // Gold rows arrive with `change.swap` already populated by the
            // list adapters (one Exchange Fulfillment row per swap, public and
            // confidential alike).
            let swap = change.swap.as_ref().map(|s| SwapInfo {
                sent_token_id: s.sent_token_id.clone(),
                sent_amount: s.sent_amount.clone(),
                sent_token_metadata: s.sent_token_metadata.clone(),
                received_token_id: s.received_token_id.clone(),
                received_amount: s.received_amount.clone(),
                received_token_metadata: s.received_token_metadata.clone(),
                solver_transaction_hash: s.solver_transaction_hash.clone(),
                swap_role: "fulfillment".to_string(),
                sent_amount_usd: s.sent_amount_usd.as_ref().and_then(ToPrimitive::to_f64),
                received_amount_usd: s.received_amount_usd.as_ref().and_then(ToPrimitive::to_f64),
            });

            Some(RecentActivity {
                id: change.id,
                block_time: change.block_time,
                token_id: change.token_id,
                token_metadata: token_metadata.clone(),
                counterparty: change.counterparty,
                signer_id: change.signer_id,
                receiver_id: change.receiver_id,
                amount: change.amount,
                transaction_hashes: change.transaction_hashes,
                receipt_ids: change.receipt_id,
                value_usd,
                proposal_id: change.proposal_id,
                quote_deposit_address: change.quote_deposit_address,
                swap,
                action_kind: change.action_kind,
                method_name: change.method_name,
            })
        })
        .collect::<Vec<_>>();

    // If we're filtering by USD, we need to return the actual filtered total
    // since we can't count USD-filtered items in SQL
    let actual_total = if params.min_usd_value.is_some() {
        activities.len() as i64
    } else {
        total
    };

    // Only return the requested number of results (pagination)
    let paginated_activities: Vec<RecentActivity> =
        activities.into_iter().take(limit as usize).collect();

    Ok(Json(RecentActivityResponse {
        data: paginated_activities,
        total: actual_total,
    }))
}

/// The activity feed's "from" party for one gold ledger row.
const GOLD_FROM_ACCOUNT_EXPR: &str =
    "CASE WHEN transaction_type::text = 'deposit' THEN counterparty ELSE dao_id END";
/// The activity feed's "to" party for one gold ledger row.
const GOLD_TO_ACCOUNT_EXPR: &str = "CASE WHEN transaction_type::text = 'deposit' THEN dao_id ELSE COALESCE(recipient, counterparty) END";

/// Distinct sender/recipient options for the recent-activity filter
/// dropdowns, read from the unified gold ledger (public and confidential DAOs
/// alike). Honors the transactionType tab the same way the feed does:
/// incoming/outgoing exclude exchanges (separate tab), and the staking tab has
/// no counterparties.
async fn fetch_activity_account_options(
    pool: &PgPool,
    account_id: &str,
    transaction_type: Option<&str>,
    account_expr: &str,
) -> Result<Vec<String>, sqlx::Error> {
    if transaction_type == Some("staking_rewards") {
        return Ok(Vec::new());
    }

    let mut builder = sqlx::QueryBuilder::<sqlx::Postgres>::new(format!(
        "SELECT DISTINCT {account_expr} AS account FROM gold_treasury_ledger_events WHERE dao_id = "
    ));
    builder.push_bind(account_id);
    builder.push(" AND history_visible");

    let types: Option<Vec<String>> = match transaction_type {
        Some("incoming") => Some(vec!["deposit".to_string()]),
        Some("outgoing") => Some(vec!["sent".to_string()]),
        Some("exchange") => Some(vec!["exchange".to_string()]),
        _ => None,
    };
    if let Some(types) = types {
        builder.push(" AND transaction_type = ANY(");
        builder.push_bind(types);
        builder.push("::public_transaction_type[])");
    }

    builder.push(format!(
        " AND {account_expr} IS NOT NULL ORDER BY account ASC"
    ));
    builder.build_query_scalar::<String>().fetch_all(pool).await
}

pub async fn get_recent_activity_senders(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Query(params): Query<RecentActivitySendersQuery>,
) -> Result<Json<RecentActivitySendersResponse>, (StatusCode, Json<serde_json::Value>)> {
    user.verify_member_if_confidential(&state.db_pool, &params.account_id)
        .await
        .map_err(|(status, message)| (status, Json(serde_json::json!({ "error": message }))))?;

    let options = fetch_activity_account_options(
        &state.db_pool,
        params.account_id.as_str(),
        params.transaction_type.as_deref(),
        GOLD_FROM_ACCOUNT_EXPR,
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch recent activity senders: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to fetch recent activity senders",
                "details": e.to_string()
            })),
        )
    })?;

    Ok(Json(RecentActivitySendersResponse { options }))
}

pub async fn get_recent_activity_recipients(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Query(params): Query<RecentActivityRecipientsQuery>,
) -> Result<Json<RecentActivityRecipientsResponse>, (StatusCode, Json<serde_json::Value>)> {
    user.verify_member_if_confidential(&state.db_pool, &params.account_id)
        .await
        .map_err(|(status, message)| (status, Json(serde_json::json!({ "error": message }))))?;

    let options = fetch_activity_account_options(
        &state.db_pool,
        params.account_id.as_str(),
        params.transaction_type.as_deref(),
        GOLD_TO_ACCOUNT_EXPR,
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch recent activity recipients: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Failed to fetch recent activity recipients",
                "details": e.to_string()
            })),
        )
    })?;

    Ok(Json(RecentActivityRecipientsResponse { options }))
}

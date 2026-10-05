//! `GET /api/intents/deposit-tracker`: in-process deposits for the deposit
//! modal, scoped to the address the user is looking at (a chain for public
//! treasuries, a quote address for confidential one-time addresses).

use std::collections::HashSet;
use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use near_api::AccountId;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::OptionalAuthUser;
use crate::handlers::token::{TokenMetadata, fetch_tokens_with_fallback};

use super::store::{InProcessDeposit, load_recent_deposits_for_scope};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositTrackerQuery {
    pub account_id: AccountId,
    /// Public treasuries: the bridge chain id shown in the modal (e.g. `eth:8453`).
    pub chain: Option<String>,
    /// Confidential treasuries: the 1Click quote deposit address.
    pub quote_deposit_address: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedDeposit {
    pub id: i64,
    /// `detected | finalized | ledger_confirmed | failed`.
    pub status: &'static str,
    pub provider_status: String,
    pub chain: Option<String>,
    pub token_id: String,
    pub token_metadata: TokenMetadata,
    /// Decimal-adjusted amount, when the provider reported one.
    pub amount: Option<BigDecimal>,
    pub origin_tx_hash: Option<String>,
    pub detected_at: DateTime<Utc>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositTrackerResponse {
    pub deposits: Vec<TrackedDeposit>,
}

impl TrackedDeposit {
    fn from_row(row: InProcessDeposit, metadata: TokenMetadata) -> Self {
        Self {
            id: row.id,
            status: row.status.as_str(),
            provider_status: row.provider_status,
            chain: row.chain,
            token_id: row.token_id,
            token_metadata: metadata,
            amount: row.amount,
            origin_tx_hash: row.origin_tx_hash,
            detected_at: row.detected_at,
            finalized_at: row.finalized_at,
            updated_at: row.updated_at,
        }
    }
}

pub async fn get_deposit_tracker(
    State(state): State<Arc<AppState>>,
    user: OptionalAuthUser,
    Query(query): Query<DepositTrackerQuery>,
) -> Result<Json<DepositTrackerResponse>, (StatusCode, String)> {
    user.verify_member_if_confidential(&state.db_pool, &query.account_id)
        .await?;

    let quote = query
        .quote_deposit_address
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let chain = query
        .chain
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if quote.is_none() && chain.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "chain or quoteDepositAddress is required".to_string(),
        ));
    }

    let rows =
        load_recent_deposits_for_scope(&state.db_pool, query.account_id.as_str(), quote, chain)
            .await
            .map_err(|e| {
                tracing::error!("deposit tracker read failed: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to load deposit tracker state".to_string(),
                )
            })?;

    let token_ids: Vec<String> = rows
        .iter()
        .map(|row| row.token_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let metadata = fetch_tokens_with_fallback(&state, &token_ids, false, false).await;

    let deposits = rows
        .into_iter()
        .map(|row| {
            let token_metadata = metadata.get(&row.token_id).cloned().unwrap_or_else(|| {
                crate::handlers::public_history::public_list::fallback_metadata(&row.token_id)
            });
            TrackedDeposit::from_row(row, token_metadata)
        })
        .collect();

    Ok(Json(DepositTrackerResponse { deposits }))
}

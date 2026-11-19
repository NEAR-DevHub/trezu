use axum::{Json, extract::State, http::StatusCode};
use near_api::AccountId;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;
use crate::handlers::intents::confidential::reusable_deposit::{
    ResolvedDepositAddress, ReusableDepositResolver,
};
use crate::handlers::intents::deposit_tracker::{WatchActivation, WatchKind};
use crate::handlers::public_history::confidential_list::is_confidential_dao;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositAddressRequest {
    pub account_id: AccountId,
    pub chain: String,
    pub token_id: Option<String>,
    pub amount: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DepositAddressResult {
    pub address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// 1Click `quote.minAmountIn` (bridge floor) for the chosen token.
    pub min_amount: Option<String>,
    pub memo: Option<String>,
    /// The treasury's reusable 1Click quote address (the deposit tracker
    /// scope). Differs from `address`, which is the funding
    /// address on the chosen chain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_deposit_address: Option<String>,
}

impl From<ResolvedDepositAddress> for DepositAddressResult {
    fn from(resolved: ResolvedDepositAddress) -> Self {
        Self {
            address: resolved.address,
            min_amount: resolved.min_amount,
            memo: resolved.memo,
            quote_deposit_address: Some(resolved.quote_deposit_address),
        }
    }
}

/// Fetch deposit address for a specific account and chain.
///
/// Every treasury is served from its reusable 1Click deposit set: one
/// long-lived address per chain. A confidential set is owned by the DAO's
/// 1Click session and credits its confidential balance; a public set is
/// created with the partner credentials and credits its Intents balance.
/// `tokenId` (the 1Click `quoteAssetId`, which may be `1cs_v1:…`) selects
/// the bridge floor returned as `minAmount`.
///
/// Guests and non-members may generate addresses — depositing funds into a
/// treasury is not a member-only action.
#[tracing::instrument(
    level = "info",
    skip_all,
    fields(
        account_id = %request.account_id,
        chain = %request.chain,
        token_id = request.token_id.as_deref()
    )
)]
pub async fn get_deposit_address(
    State(state): State<Arc<AppState>>,
    Json(request): Json<DepositAddressRequest>,
) -> Result<Json<DepositAddressResult>, (StatusCode, String)> {
    let account_id = request.account_id.clone();
    let chain = request.chain.clone();

    let confidential = is_confidential_dao(&state.db_pool, account_id.as_str())
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to check confidential status: {}", e),
            )
        })?;

    let token_id = request
        .token_id
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "tokenId is required".to_string()))?;
    let amount: u128 = request
        .amount
        .as_deref()
        .unwrap_or("0")
        .parse()
        .unwrap_or(0);
    let resolver = if confidential {
        ReusableDepositResolver::new(&state)
    } else {
        ReusableDepositResolver::public(&state)
    };
    let result = DepositAddressResult::from(
        resolver
            .deposit_address(&account_id, &chain, &token_id, amount)
            .await
            .inspect_err(|(status, msg)| {
                if !confidential && status.is_server_error() {
                    crate::error_event!(
                        crate::error_event::ErrorCode::DepositAddressFailed,
                        account_id = %account_id,
                        chain,
                        status = %status,
                        error = %msg
                    );
                }
            })?,
    );
    if let Some(quote_deposit_address) = result.quote_deposit_address.as_deref() {
        let kind = if confidential {
            WatchKind::Confidential
        } else {
            WatchKind::Public
        };
        activate_deposit_watch(
            &state,
            WatchActivation {
                dao_id: account_id.to_string(),
                chain,
                token_id: Some(token_id),
            },
            kind,
            quote_deposit_address,
        )
        .await;
    }
    Ok(Json(result))
}

/// Showing an address starts (or renews) deposit tracking. Tracking is a
/// best-effort UX layer: failures are logged and never fail the address
/// request. Accounts that are not monitored are skipped.
async fn activate_deposit_watch(
    state: &AppState,
    activation: WatchActivation,
    kind: WatchKind,
    quote_deposit_address: &str,
) {
    match activation
        .activate(&state.db_pool, kind, quote_deposit_address)
        .await
    {
        Ok(true) => {}
        Ok(false) => tracing::debug!(
            dao_id = %activation.dao_id,
            "deposit watch skipped: account is not monitored"
        ),
        Err(error) => tracing::warn!(
            dao_id = %activation.dao_id,
            chain = %activation.chain,
            %error,
            "deposit watch activation failed"
        ),
    }
}

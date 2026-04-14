use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use near_api::types::json::U128;
use near_api::{AccountId, Contract, Reference};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::Arc;

use crate::AppState;
use crate::handlers::proposals::scraper::fetch_proposal;
use crate::handlers::proposals::tx::{
    TransactionQueryParams, find_proposal_execution_transaction_inner,
};
use crate::utils::cache::{CacheKey, CacheTier};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StakingAmountResponse {
    /// Resolved NEAR amount in yoctoNEAR, as string. None if proposal doesn't
    /// carry a `*_all` staking method or the amount couldn't be resolved.
    pub amount: Option<String>,
    pub block_height: u64,
    pub pool_id: String,
    pub method: String,
    pub kind: Kind,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    #[serde(rename = "unstake")]
    Unstake,
    #[serde(rename = "withdraw")]
    Withdraw,
}

#[derive(Deserialize, Debug)]
struct StakingPoolAccountView {
    unstaked_balance: U128,
    staked_balance: U128,
}

/// GET /api/proposal/{dao_id}/{proposal_id}/staking-amount
///
/// For executed staking proposals that used `unstake_all`, `withdraw_all`, or
/// `withdraw_all_from_staking_pool`, return the actual NEAR amount moved by
/// querying the pool's `get_account` at the block just before execution.
pub async fn get_proposal_staking_amount(
    State(state): State<Arc<AppState>>,
    Path((dao_id, proposal_id)): Path<(AccountId, u64)>,
    Query(params): Query<TransactionQueryParams>,
) -> Result<(StatusCode, Json<StakingAmountResponse>), (StatusCode, String)> {
    let proposal = fetch_proposal(&state.network, &dao_id, proposal_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch proposal: {}", e),
            )
        })?;

    let (receiver_id, method_name) = extract_staking_action(&proposal.kind).ok_or((
        StatusCode::BAD_REQUEST,
        "Proposal is not a full-amount staking action".to_string(),
    ))?;

    let kind = match method_name.as_str() {
        "unstake_all" => Kind::Unstake,
        "withdraw_all" | "withdraw_all_from_staking_pool" => Kind::Withdraw,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Unsupported staking method: {}", method_name),
            ));
        }
    };

    let cache_key = CacheKey::new("proposal-staking-amount")
        .with(&dao_id)
        .with(proposal_id)
        .build();

    let state_clone = state.clone();
    let dao_id_clone = dao_id.clone();
    let method_clone = method_name.clone();
    let receiver_clone = receiver_id.clone();

    let response = state
        .cache
        .cached(CacheTier::LongTerm, cache_key, async move {
            let tx = find_proposal_execution_transaction_inner(
                &state_clone,
                &dao_id_clone,
                proposal_id,
                &params,
            )
            .await?;

            let (pool_id, account_id) =
                resolve_pool_and_account(&state_clone, &dao_id_clone, &receiver_clone).await?;

            let pool_account = AccountId::from_str(&pool_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Invalid pool id: {}", e),
                )
            })?;

            // Query pool at block_height - 1 to capture pre-execution state.
            let query_block = tx.block_height.saturating_sub(1);

            let view: near_api::Data<StakingPoolAccountView> = Contract(pool_account)
                .call_function(
                    "get_account",
                    serde_json::json!({ "account_id": account_id }),
                )
                .read_only::<StakingPoolAccountView>()
                .at(Reference::AtBlock(query_block))
                .fetch_from(&state_clone.archival_network)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!(
                            "Archival RPC failed for pool {} at block {}: {}",
                            pool_id, query_block, e
                        ),
                    )
                })?;

            let amount = match method_clone.as_str() {
                "unstake_all" => view.data.staked_balance.0.to_string(),
                "withdraw_all" | "withdraw_all_from_staking_pool" => {
                    view.data.unstaked_balance.0.to_string()
                }
                _ => unreachable!(),
            };

            Ok::<_, (StatusCode, String)>(StakingAmountResponse {
                amount: Some(amount),
                block_height: tx.block_height,
                pool_id,
                method: method_clone,
                kind: kind.clone(),
            })
        })
        .await?;

    Ok((StatusCode::OK, Json(response)))
}

/// Extract (receiver_id, method_name) from a proposal whose kind is a
/// FunctionCall with a full-amount staking action. Returns None otherwise.
fn extract_staking_action(kind: &serde_json::Value) -> Option<(String, String)> {
    let fc = kind.get("FunctionCall")?;
    let receiver_id = fc.get("receiver_id")?.as_str()?.to_string();
    let actions = fc.get("actions")?.as_array()?;
    for action in actions {
        let method = action.get("method_name")?.as_str()?;
        if matches!(
            method,
            "unstake_all" | "withdraw_all" | "withdraw_all_from_staking_pool"
        ) {
            return Some((receiver_id, method.to_string()));
        }
    }
    None
}

/// Resolve (pool_id, account_to_query) for a proposal receiver.
///
/// - DAO-direct pool call: receiver_id is the pool → account is the DAO.
/// - Lockup call: receiver_id is lockup → pool via `get_staking_pool_account_id`,
///   account is the lockup itself.
async fn resolve_pool_and_account(
    state: &Arc<AppState>,
    dao_id: &AccountId,
    receiver_id: &str,
) -> Result<(String, String), (StatusCode, String)> {
    if receiver_id.ends_with("lockup.near") {
        let lockup = AccountId::from_str(receiver_id).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Invalid lockup account: {}", e),
            )
        })?;
        let pool: Option<AccountId> = Contract(lockup)
            .call_function("get_staking_pool_account_id", ())
            .read_only::<Option<AccountId>>()
            .fetch_from(&state.network)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to query lockup pool: {}", e),
                )
            })?
            .data;
        let pool = pool.ok_or((
            StatusCode::NOT_FOUND,
            format!("Lockup {} has no staking pool set", receiver_id),
        ))?;
        Ok((pool.to_string(), receiver_id.to_string()))
    } else {
        Ok((receiver_id.to_string(), dao_id.to_string()))
    }
}

use std::collections::HashSet;
use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use futures::{StreamExt, TryStreamExt};
use near_api::{AccountId, Contract, NearToken, NetworkConfig};
use serde::{Deserialize, Serialize};

use crate::{
    AppState,
    handlers::user::lockup::StakingPoolAccount,
    utils::cache::{CacheKey, CacheTier},
};

/// API response from FastNear and NearTreasury staking pool APIs
#[derive(Deserialize, Debug)]
pub struct StakingPoolsApiResponse {
    pub pools: Option<Vec<StakingPoolEntry>>,
}

#[derive(Deserialize, Debug)]
pub struct StakingPoolEntry {
    pub pool_id: String,
}

/// Aggregated staking balance for an account
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StakingBalance {
    pub staked_balance: NearToken,
    pub unstaked_balance: NearToken,
    pub can_withdraw: bool,
    pub pools: Vec<StakingPoolAccountInfo>,
}

/// Per-pool staking balance info
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StakingPoolAccountInfo {
    pub pool_id: String,
    pub staked_balance: NearToken,
    pub unstaked_balance: NearToken,
    pub can_withdraw: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StakingValidatorQuery {
    pub pool_id: AccountId,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StakingValidatorDetails {
    pub pool_id: String,
    pub apy: Option<f64>,
    pub fee_percent: Option<f64>,
}

#[derive(Deserialize, Debug)]
struct RewardFeeFraction {
    numerator: u64,
    denominator: u64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct NearblocksValidatorsResponse {
    last_epoch_apy: String,
}

async fn fetch_nearblocks_last_epoch_apy(
    state: &Arc<AppState>,
) -> Result<f64, (StatusCode, String)> {
    let cache_key = CacheKey::new("nearblocks-last-epoch-apy").build();
    let state_clone = state.clone();

    state
        .cache
        .cached(CacheTier::VeryLongTerm, cache_key, async move {
            let mut request = state_clone
                .http_client
                .get("https://api.nearblocks.io/v1/validators")
                .header("accept", "application/json");
            if let Some(api_key) = state_clone.env_vars.nearblocks_api_key.as_ref() {
                request = request.header("Authorization", format!("Bearer {}", api_key));
            }

            let response = request.send().await.map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!("Failed to fetch validators from Nearblocks: {}", e),
                )
            })?;
            let response = response.error_for_status().map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!("Nearblocks validators endpoint error: {}", e),
                )
            })?;

            let payload: NearblocksValidatorsResponse = response.json().await.map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!("Failed to parse Nearblocks validators response: {}", e),
                )
            })?;

            let apy = payload.last_epoch_apy.parse::<f64>().map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!("Invalid lastEpochApy in Nearblocks response: {}", e),
                )
            })?;
            Ok::<_, (StatusCode, String)>(apy)
        })
        .await
}

async fn fetch_staking_validator_details(
    state: &Arc<AppState>,
    pool_id: &AccountId,
) -> Result<StakingValidatorDetails, (StatusCode, String)> {
    let cache_key = CacheKey::new("staking-validator-details")
        .with(pool_id)
        .build();
    let state_clone = state.clone();
    let pool_id_clone = pool_id.clone();

    state
        .cache
        .cached(CacheTier::VeryLongTerm, cache_key, async move {
            let last_epoch_apy = fetch_nearblocks_last_epoch_apy(&state_clone).await?;
            let fee = Contract(pool_id_clone.clone())
                .call_function("get_reward_fee_fraction", serde_json::json!({}))
                .read_only::<RewardFeeFraction>()
                .fetch_from(&state_clone.network)
                .await
                .map_err(|e| {
                    (
                        StatusCode::BAD_GATEWAY,
                        format!(
                            "Failed to fetch validator fee fraction from pool {}: {}",
                            pool_id_clone, e
                        ),
                    )
                })?
                .data;
            let fee_percent = if fee.denominator == 0 {
                None
            } else {
                Some((fee.numerator as f64 / fee.denominator as f64) * 100.0)
            };
            let validator_fee = (fee_percent.unwrap_or(0.0) / 100.0).clamp(0.0, 1.0);
            let adjusted_apy = last_epoch_apy - (last_epoch_apy * validator_fee);
            let apy = if adjusted_apy.is_finite() {
                Some(adjusted_apy.max(0.0))
            } else {
                None
            };

            Ok::<_, (StatusCode, String)>(StakingValidatorDetails {
                pool_id: pool_id_clone.to_string(),
                apy,
                fee_percent,
            })
        })
        .await
}

pub async fn get_staking_validator_details(
    State(state): State<Arc<AppState>>,
    Query(params): Query<StakingValidatorQuery>,
) -> Result<Json<StakingValidatorDetails>, (StatusCode, String)> {
    let details = fetch_staking_validator_details(&state, &params.pool_id).await?;
    Ok(Json(details))
}

/// Fetch staking pools from FastNear API
async fn fetch_staking_pools_fastnear(
    state: &Arc<AppState>,
    account_id: &AccountId,
) -> Result<Vec<String>, (StatusCode, String)> {
    let response = state
        .http_client
        .get(format!(
            "https://api.fastnear.com/v1/account/{}/staking",
            account_id
        ))
        .header(
            "Authorization",
            format!("Bearer {}", state.env_vars.fastnear_api_key),
        )
        .send()
        .await
        .map_err(|e| {
            eprintln!("Error fetching staking pools from FastNear: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch staking pools from FastNear".to_string(),
            )
        })?;

    let data: StakingPoolsApiResponse = response.json().await.map_err(|e| {
        eprintln!("Error parsing FastNear staking response: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to parse FastNear staking response".to_string(),
        )
    })?;

    Ok(data
        .pools
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.pool_id)
        .collect())
}

/// Fetch staking pools from NearTreasury staking pools API
async fn fetch_staking_pools_neartreasury(
    state: &Arc<AppState>,
    account_id: &AccountId,
) -> Result<Vec<String>, (StatusCode, String)> {
    let response = state
        .http_client
        .get(format!(
            "https://staking-pools-api.neartreasury.com/v1/account/{}/staking",
            account_id
        ))
        .send()
        .await
        .map_err(|e| {
            eprintln!("Error fetching staking pools from NearTreasury API: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch staking pools from NearTreasury API".to_string(),
            )
        })?;

    let data: StakingPoolsApiResponse = response.json().await.map_err(|e| {
        eprintln!("Error parsing NearTreasury staking response: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to parse NearTreasury staking response".to_string(),
        )
    })?;

    Ok(data
        .pools
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.pool_id)
        .collect())
}

/// Fetch and merge staking pools from both APIs (with deduplication)
async fn fetch_staking_pools(
    state: &Arc<AppState>,
    account_id: &AccountId,
) -> Result<HashSet<String>, (StatusCode, String)> {
    let cache_key = CacheKey::new("staking-pools")
        .with(account_id.clone())
        .build();

    let state_clone = state.clone();
    let account_id_clone = account_id.clone();

    state
        .cache
        .cached(CacheTier::LongTerm, cache_key, async move {
            // Fetch from both sources concurrently
            let (fastnear_result, neartreasury_result) = tokio::join!(
                fetch_staking_pools_fastnear(&state_clone, &account_id_clone),
                fetch_staking_pools_neartreasury(&state_clone, &account_id_clone)
            );

            // Merge results with graceful degradation
            let mut pools = HashSet::new();

            match fastnear_result {
                Ok(fastnear_pools) => {
                    pools.extend(fastnear_pools);
                }
                Err(e) => {
                    eprintln!("Warning: FastNear staking pools API failed: {:?}", e);
                }
            }

            match neartreasury_result {
                Ok(neartreasury_pools) => {
                    pools.extend(neartreasury_pools);
                }
                Err(e) => {
                    eprintln!("Warning: NearTreasury staking pools API failed: {:?}", e);
                }
            }

            Ok::<_, (StatusCode, String)>(pools)
        })
        .await
}

/// Fetch balance from a single staking pool
async fn fetch_staking_pool_balance(
    network: &NetworkConfig,
    account_id: &AccountId,
    pool_id: &AccountId,
) -> Result<StakingPoolAccountInfo, (StatusCode, String)> {
    let result = Contract(pool_id.clone())
        .call_function(
            "get_account",
            serde_json::json!({ "account_id": account_id.to_string() }),
        )
        .read_only::<StakingPoolAccount>()
        .fetch_from(network)
        .await
        .map_err(|e| {
            eprintln!(
                "Error fetching staking balance from pool {}: {}",
                pool_id, e
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch staking balance from {}", pool_id),
            )
        })?;

    Ok(StakingPoolAccountInfo {
        pool_id: pool_id.to_string(),
        staked_balance: result.data.staked_balance,
        unstaked_balance: result.data.unstaked_balance,
        can_withdraw: result.data.can_withdraw,
    })
}

/// Fetch balances from all staking pools for an account
pub async fn fetch_staking_balances(
    state: &Arc<AppState>,
    account_id: &AccountId,
) -> Result<Option<StakingBalance>, (StatusCode, String)> {
    let cache_key = CacheKey::new("staking-balances")
        .with(account_id.clone())
        .build();

    let state_clone = state.clone();
    let account_id_clone = account_id.clone();

    state
        .cache
        .cached(CacheTier::ShortTerm, cache_key, async move {
            // Get all staking pools for this account
            let pools = fetch_staking_pools(&state_clone, &account_id_clone).await?;

            if pools.is_empty() {
                return Ok::<_, (StatusCode, String)>(None);
            }

            // Fetch balances from all pools in parallel
            let balance_futures: Vec<_> = pools
                .iter()
                .filter_map(|pool_id| pool_id.parse::<AccountId>().ok())
                .map(|pool_id| {
                    let state = state_clone.clone();
                    let account_id = account_id_clone.clone();
                    async move {
                        fetch_staking_pool_balance(&state.network, &account_id, &pool_id).await
                    }
                })
                .collect();

            let results = futures::future::join_all(balance_futures).await;

            // Preserve the live path's existing handling of individual pool failures.
            let pool_balances = results.into_iter().filter_map(|result| match result {
                Ok(balance) => Some(balance),
                Err(e) => {
                    eprintln!("Warning: Failed to fetch balance from pool: {:?}", e);
                    None
                }
            });
            Ok::<_, (StatusCode, String)>(aggregate_staking_balances(pool_balances))
        })
        .await
}

/// Read current staking state for known pools without a history API dependency.
/// A failed pool read must fail the ledger response instead of understating funds.
pub(crate) async fn fetch_staking_balances_for_pools(
    network: &NetworkConfig,
    account_id: &AccountId,
    pool_ids: &[String],
) -> Result<Option<StakingBalance>, (StatusCode, String)> {
    let mut pools = pool_ids
        .iter()
        .map(|pool_id| {
            pool_id.parse::<AccountId>().map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Invalid staking pool account: {pool_id}"),
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    pools.sort();
    pools.dedup();

    let balances: Vec<_> =
        futures::stream::iter(pools)
            .map(|pool_id| async move {
                fetch_staking_pool_balance(network, account_id, &pool_id).await
            })
            .buffered(8)
            .try_collect()
            .await?;
    Ok(aggregate_staking_balances(balances))
}

fn aggregate_staking_balances(
    balances: impl IntoIterator<Item = StakingPoolAccountInfo>,
) -> Option<StakingBalance> {
    let mut total_staked = NearToken::from_yoctonear(0);
    let mut total_unstaked = NearToken::from_yoctonear(0);
    let mut any_can_withdraw = false;
    let mut pools = Vec::new();

    for balance in balances {
        if balance.staked_balance.is_zero() && balance.unstaked_balance.is_zero() {
            continue;
        }
        total_staked = total_staked.saturating_add(balance.staked_balance);
        total_unstaked = total_unstaked.saturating_add(balance.unstaked_balance);
        any_can_withdraw |= balance.can_withdraw && !balance.unstaked_balance.is_zero();
        pools.push(balance);
    }

    (!pools.is_empty()).then_some(StakingBalance {
        staked_balance: total_staked,
        unstaked_balance: total_unstaked,
        can_withdraw: any_can_withdraw,
        pools,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_api::RPCEndpoint;
    use serde_json::json;
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers::body_partial_json};

    fn network(server: &MockServer) -> NetworkConfig {
        NetworkConfig {
            rpc_endpoints: vec![RPCEndpoint::new(server.uri().parse().unwrap()).with_retries(1)],
            ..NetworkConfig::mainnet()
        }
    }

    async fn mock_pool(server: &MockServer, pool: &str, staked: u128, unstaked: u128, ready: bool) {
        let result = serde_json::to_vec(&json!({
            "account_id": "test.sputnik-dao.near",
            "staked_balance": NearToken::from_near(staked).as_yoctonear().to_string(),
            "unstaked_balance": NearToken::from_near(unstaked).as_yoctonear().to_string(),
            "can_withdraw": ready,
        }))
        .unwrap();
        Mock::given(body_partial_json(json!({
            "method": "query",
            "params": { "account_id": pool, "method_name": "get_account" },
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "jsonrpc": "2.0",
            "id": "dontcare",
            "result": {
                "result": result,
                "logs": [],
                "block_height": 123,
                "block_hash": "11111111111111111111111111111111",
            },
        })))
        .expect(1)
        .mount(server)
        .await;
    }

    #[tokio::test]
    async fn known_pools_read_rpc_staking_and_withdrawal_state() {
        let server = MockServer::start().await;
        mock_pool(&server, "ready.poolv1.near", 2, 3, true).await;
        mock_pool(&server, "pending.poolv1.near", 4, 5, false).await;
        mock_pool(&server, "empty.poolv1.near", 0, 0, true).await;
        let account = "test.sputnik-dao.near".parse().unwrap();
        let balance = fetch_staking_balances_for_pools(
            &network(&server),
            &account,
            &[
                "ready.poolv1.near".into(),
                "pending.poolv1.near".into(),
                "empty.poolv1.near".into(),
                "ready.poolv1.near".into(),
            ],
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(balance.staked_balance, NearToken::from_near(6));
        assert_eq!(balance.unstaked_balance, NearToken::from_near(8));
        assert!(balance.can_withdraw);
        assert_eq!(balance.pools.len(), 2);
        assert_eq!(balance.pools[0].pool_id, "pending.poolv1.near");
        assert!(!balance.pools[0].can_withdraw);
        assert_eq!(balance.pools[0].unstaked_balance, NearToken::from_near(5));
        assert!(balance.pools[1].can_withdraw);
        assert_eq!(balance.pools[1].unstaked_balance, NearToken::from_near(3));

        use base64::Engine;
        for request in server.received_requests().await.unwrap() {
            let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
            let args = base64::engine::general_purpose::STANDARD
                .decode(body["params"]["args_base64"].as_str().unwrap())
                .unwrap();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&args).unwrap(),
                json!({"account_id": account.as_str()})
            );
        }
    }

    #[tokio::test]
    async fn known_pools_fail_instead_of_returning_partial_balances() {
        let server = MockServer::start().await;
        mock_pool(&server, "a-ready.poolv1.near", 2, 3, true).await;
        Mock::given(body_partial_json(json!({
            "params": { "account_id": "z-failed.poolv1.near" },
        })))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
        let account = "test.sputnik-dao.near".parse().unwrap();
        let error = fetch_staking_balances_for_pools(
            &network(&server),
            &account,
            &["a-ready.poolv1.near".into(), "z-failed.poolv1.near".into()],
        )
        .await
        .unwrap_err();
        assert_eq!(error.0, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(error.1.contains("z-failed.poolv1.near"));
    }

    #[tokio::test]
    async fn empty_and_invalid_pool_lists_do_not_need_rpc() {
        let account = "test.sputnik-dao.near".parse().unwrap();
        let network = NetworkConfig {
            rpc_endpoints: vec![],
            ..NetworkConfig::mainnet()
        };
        assert!(
            fetch_staking_balances_for_pools(&network, &account, &[])
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            fetch_staking_balances_for_pools(&network, &account, &["INVALID!".into()])
                .await
                .is_err()
        );
    }

    #[test]
    fn withdrawal_requires_ready_unstaked_funds() {
        let balance = aggregate_staking_balances([
            StakingPoolAccountInfo {
                pool_id: "pending.poolv1.near".into(),
                staked_balance: NearToken::from_near(0),
                unstaked_balance: NearToken::from_near(3),
                can_withdraw: false,
            },
            StakingPoolAccountInfo {
                pool_id: "staked.poolv1.near".into(),
                staked_balance: NearToken::from_near(2),
                unstaked_balance: NearToken::from_near(0),
                can_withdraw: true,
            },
        ])
        .unwrap();
        assert!(!balance.can_withdraw);
        assert_eq!(balance.unstaked_balance, NearToken::from_near(3));
        assert!(aggregate_staking_balances([]).is_none());
    }
}

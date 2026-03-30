use crate::{
    handlers::user::{
        balance::TokenBalanceResponse,
        lockup::{LockupBalance, fetch_lockup_balance_of_account},
        staking::{StakingBalance, fetch_staking_balances},
    },
    utils::{
        cache::{CacheKey, CacheTier},
        serde::{opt_u32_from_string_or_number, opt_u64_from_string_or_number},
    },
};
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use near_api::{AccountId, Contract, types::json::U128};
use serde::{Deserialize, Serialize};
use sqlx::query_as;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::{
    AppState,
    constants::{
        INTENTS_CONTRACT_ID, NEAR_ICON, REF_FINANCE_CONTRACT_ID,
        intents_chains::ChainIcons,
        intents_tokens::{find_token_by_symbol, find_unified_asset_id},
    },
    handlers::token::{TokenMetadata as TokenMetadataResponse, fetch_tokens_with_defuse_extension},
};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum Balance {
    Standard { total: String, locked: String },
    Staked(StakingBalance),
    Vested(LockupBalance),
}

impl Balance {
    pub fn total_raw(&self) -> U128 {
        match self {
            Balance::Standard { total, .. } => total.parse::<u128>().unwrap_or(0).into(),
            Balance::Staked(staking) => staking
                .staked_balance
                .saturating_add(staking.unstaked_balance)
                .as_yoctonear()
                .into(),
            Balance::Vested(lockup) => lockup.total.as_yoctonear().into(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAssetsQuery {
    pub account_id: AccountId,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TokenMetadata {
    pub decimals: u8,
    pub symbol: String,
    pub name: String,
    pub icon: String,
}

impl TokenMetadata {
    pub fn near() -> Self {
        Self {
            decimals: 24,
            symbol: "NEAR".to_string(),
            name: "NEAR".to_string(),
            icon: NEAR_ICON.to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum TokenResidency {
    Near,
    Ft,
    Intents,
    Lockup,
    Staked,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FtLockupSchedule {
    pub start_timestamp: Option<u64>,
    pub session_interval: Option<u64>,
    pub session_num: Option<u32>,
    pub last_claim_session: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimplifiedToken {
    pub id: String,
    pub contract_id: Option<String>,
    /// FT lockup instance contract ID (one token can have multiple lockup sessions).
    pub lockup_instance_id: Option<String>,
    /// Optional schedule metadata for FT lockup session rows.
    pub ft_lockup_schedule: Option<FtLockupSchedule>,
    pub residency: TokenResidency,
    pub network: String,
    pub chain_name: String,
    pub symbol: String,

    pub balance: Balance,
    pub decimals: u8,
    pub price: String,
    pub name: String,
    pub icon: Option<String>,
    pub chain_icons: Option<ChainIcons>,
}

#[derive(Deserialize, Debug)]
pub struct FastNearToken {
    pub contract_id: String,
    #[serde(deserialize_with = "deserialize_u128_or_empty")]
    pub balance: U128,
}

fn deserialize_u128_or_empty<'de, D>(deserializer: D) -> Result<U128, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    Ok(U128(s.parse::<u128>().unwrap_or(0)))
}

#[derive(Deserialize, Debug)]
pub struct FastNearResponse {
    pub tokens: Option<Vec<FastNearToken>>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub(crate) struct FtLockupContractMetadata {
    pub token_account_id: String,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub(crate) struct FtLockupAccountData {
    pub deposited_amount: String,
    pub claimed_amount: String,
    pub unclaimed_amount: String,
    #[serde(default, deserialize_with = "opt_u64_from_string_or_number")]
    pub start_timestamp: Option<u64>,
    #[serde(default, deserialize_with = "opt_u64_from_string_or_number")]
    pub session_interval: Option<u64>,
    #[serde(default, deserialize_with = "opt_u32_from_string_or_number")]
    pub session_num: Option<u32>,
    #[serde(default, deserialize_with = "opt_u32_from_string_or_number")]
    pub last_claim_session: Option<u32>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub(crate) struct FtLockupListedAccount {
    pub account_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct FtLockupPosition {
    instance_id: String,
    token_account_id: String,
    deposited_amount: u128,
    claimed_amount: u128,
    unclaimed_amount: u128,
    start_timestamp: Option<u64>,
    session_interval: Option<u64>,
    session_num: Option<u32>,
    last_claim_session: Option<u32>,
}

fn parse_u128_amount(value: &str) -> u128 {
    value.parse::<u128>().unwrap_or(0)
}

fn canonical_token_id(token_id: &str) -> &str {
    token_id
        .strip_prefix("intents.near:")
        .unwrap_or(token_id)
        .strip_prefix("nep141:")
        .unwrap_or(token_id)
}

fn is_near_or_wrap_near(token_id: &str) -> bool {
    matches!(canonical_token_id(token_id), "near" | "wrap.near")
}

fn resolve_token_meta_and_unified_id<'a>(
    token_id: &str,
    metadata_map: &'a HashMap<String, TokenMetadataResponse>,
    near_token_meta: &'a TokenMetadataResponse,
) -> Option<(&'a TokenMetadataResponse, String)> {
    if is_near_or_wrap_near(token_id) {
        return Some((near_token_meta, "near".to_string()));
    }

    let token_meta = metadata_map.get(token_id)?;
    let unified_id = find_token_by_symbol(&token_meta.symbol)
        .map(|u| u.unified_asset_id)
        .unwrap_or_else(|| token_meta.symbol.to_lowercase());

    Some((token_meta, unified_id))
}

/// Fetch full account data from the FastNear API.
///
/// Queries `https://api.fastnear.com/v1/account/{account_id}/full` and returns
/// the parsed response. Shared by the assets endpoint and the monitor cycle's
/// FT token discovery.
pub async fn fetch_fastnear_account_full(
    http_client: &reqwest::Client,
    fastnear_api_key: &str,
    account_id: &str,
) -> Result<FastNearResponse, Box<dyn std::error::Error + Send + Sync>> {
    let response = http_client
        .get(format!(
            "https://api.fastnear.com/v1/account/{}/full",
            account_id
        ))
        .header("Authorization", format!("Bearer {}", fastnear_api_key))
        .send()
        .await?
        .error_for_status()?;

    Ok(response.json().await?)
}

/// Fetches whitelisted token IDs from the Ref Finance contract via RPC
async fn fetch_whitelisted_tokens_from_rpc(
    state: &Arc<AppState>,
) -> Result<HashSet<String>, (StatusCode, String)> {
    let whitelisted_tokens = Contract(REF_FINANCE_CONTRACT_ID.into())
        .call_function("get_whitelisted_tokens", ())
        .read_only::<HashSet<String>>()
        .fetch_from(&state.network)
        .await
        .map_err(|e| {
            eprintln!("Error fetching whitelisted tokens from RPC: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch whitelisted tokens".to_string(),
            )
        })?;

    Ok(whitelisted_tokens.data)
}

/// Fetches all Ref Finance tokens and filters them by whitelist
pub(crate) async fn fetch_whitelisted_tokens(
    state: &Arc<AppState>,
) -> Result<HashSet<String>, (StatusCode, String)> {
    let cache_key = "ref-whitelisted-tokens".to_string();
    let state_clone = state.clone();

    state
        .cache
        .cached(CacheTier::VeryLongTerm, cache_key, async move {
            fetch_whitelisted_tokens_from_rpc(&state_clone).await
        })
        .await
}

/// Fetches user balances from FastNear API
async fn fetch_user_balances(
    state: &Arc<AppState>,
    account: &AccountId,
) -> Result<FastNearResponse, (StatusCode, String)> {
    fetch_fastnear_account_full(
        &state.http_client,
        &state.env_vars.fastnear_api_key,
        account.as_ref(),
    )
    .await
    .map_err(|e| {
        eprintln!("Error fetching user balances: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to fetch user balances".to_string(),
        )
    })
}

/// Builds a map of token balances from FastNear response
fn build_balance_map(user_balances: &FastNearResponse) -> HashMap<String, U128> {
    let mut balance_map = HashMap::new();
    if let Some(tokens) = &user_balances.tokens {
        for token in tokens {
            balance_map.insert(token.contract_id.to_lowercase(), token.balance.clone());
        }
    }
    balance_map
}

#[derive(Deserialize, Debug)]
struct IntentsToken {
    token_id: String,
}

/// Fetches tokens owned by an account from intents.near
async fn fetch_intents_owned_tokens(
    state: &Arc<AppState>,
    account_id: &AccountId,
) -> Result<Vec<String>, (StatusCode, String)> {
    let owned_tokens = Contract(INTENTS_CONTRACT_ID.into())
        .call_function(
            "mt_tokens_for_owner",
            serde_json::json!({
                "account_id": account_id
            }),
        )
        .read_only::<Vec<IntentsToken>>()
        .fetch_from(&state.network)
        .await
        .map_err(|e| {
            eprintln!("Error fetching owned tokens from intents.near: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch owned tokens from intents.near".to_string(),
            )
        })?;

    Ok(owned_tokens.data.into_iter().map(|t| t.token_id).collect())
}

/// Fetches balances for multiple tokens from intents.near
async fn fetch_intents_balances(
    state: &Arc<AppState>,
    account_id: &AccountId,
    token_ids: &[String],
) -> Result<Vec<String>, (StatusCode, String)> {
    if token_ids.is_empty() {
        return Ok(Vec::new());
    }

    let balances = Contract(INTENTS_CONTRACT_ID.into())
        .call_function(
            "mt_batch_balance_of",
            serde_json::json!({
                "account_id": account_id,
                "token_ids": token_ids
            }),
        )
        .read_only::<Vec<String>>()
        .fetch_from(&state.network)
        .await
        .map_err(|e| {
            eprintln!("Error fetching balances from intents.near: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch balances from intents.near".to_string(),
            )
        })?;

    Ok(balances.data)
}

/// FT lockup lookup flow (backend-only):
/// 1) Fetch `ft-lockup.near` instances (`get_instances`) and cache for hours.
/// 2) For each instance, fetch `list_accounts` and cache for hours.
/// 3) Build/cache reverse index: `dao_account_id -> [instance_ids]` for hours.
/// 4) For current DAO, read matched instances from index.
/// 5) For each matched instance, fetch:
///    - `get_account(dao)` (short-term cache, live claimed/unclaimed values)
///    - `contract_metadata` (hours cache, token account id)
/// 6) Convert to portfolio buckets:
///    - total   = deposited - claimed
///    - locked  = deposited - claimed - unclaimed
///    - available = unclaimed
pub(crate) async fn fetch_ft_lockup_instance_ids(
    state: &Arc<AppState>,
) -> Result<Vec<String>, (StatusCode, String)> {
    log::info!("[ft-lockup] fetching registry instances");
    let cache_key = CacheKey::new("ft-lockup-instances").build();
    let state_clone = state.clone();

    state
        .cache
        .cached(CacheTier::VeryLongTerm, cache_key, async move {
            let ft_lockup_registry: AccountId = "ft-lockup.near".parse().map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Invalid ft-lockup registry account id: {}", e),
                )
            })?;

            let instances = Contract(ft_lockup_registry)
                .call_function("get_instances", serde_json::json!({}))
                .read_only::<Vec<(String, String)>>()
                .fetch_from(&state_clone.network)
                .await
                .map_err(|e| {
                    log::warn!("[ft-lockup] get_instances failed: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to fetch FT lockup instances".to_string(),
                    )
                })?;

            let ids = instances
                .data
                .into_iter()
                .map(|(_, instance_id)| instance_id)
                .collect::<Vec<_>>();
            log::info!("[ft-lockup] registry instances fetched: {}", ids.len());

            Ok::<_, (StatusCode, String)>(ids)
        })
        .await
}

pub(crate) async fn fetch_ft_lockup_instance_accounts(
    state: &Arc<AppState>,
    instance_id: &str,
) -> Result<Vec<String>, (StatusCode, String)> {
    log::info!("[ft-lockup] list_accounts for instance={}", instance_id);
    let cache_key = CacheKey::new("ft-lockup-instance-accounts")
        .with(instance_id)
        .build();
    let state_clone = state.clone();
    let instance_id_owned = instance_id.to_string();

    state
        .cache
        .cached(CacheTier::VeryLongTerm, cache_key, async move {
            let instance_account: AccountId = instance_id_owned.parse().map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Invalid ft-lockup instance id: {}", e),
                )
            })?;

            let accounts = Contract(instance_account)
                .call_function("list_accounts", serde_json::json!({}))
                .read_only::<Vec<FtLockupListedAccount>>()
                .fetch_from(&state_clone.network)
                .await
                .map_err(|e| {
                    log::warn!(
                        "[ft-lockup] list_accounts failed for instance={}: {}",
                        instance_id_owned,
                        e
                    );
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to fetch FT lockup accounts".to_string(),
                    )
                })?;

            let account_ids = accounts
                .data
                .into_iter()
                .map(|a| a.account_id)
                .collect::<Vec<_>>();
            log::info!(
                "[ft-lockup] list_accounts instance={} accounts={}",
                instance_id_owned,
                account_ids.len()
            );
            Ok::<_, (StatusCode, String)>(account_ids)
        })
        .await
}

/// Build reverse index of DAO account -> ft-lockup instance IDs.
///
/// Uses cached `list_accounts` per instance and stores the full reverse map
async fn fetch_ft_lockup_dao_instance_index(
    state: &Arc<AppState>,
    instance_ids: &[String],
) -> Result<HashMap<String, Vec<String>>, (StatusCode, String)> {
    log::info!(
        "[ft-lockup] building dao->instances index from instances={}",
        instance_ids.len()
    );
    let cache_key = CacheKey::new("ft-lockup-dao-instance-index").build();
    let state_clone = state.clone();
    let instance_ids_for_cache = instance_ids.to_vec();

    state
        .cache
        .cached(CacheTier::VeryLongTerm, cache_key, async move {
            let mut index: HashMap<String, Vec<String>> = HashMap::new();

            for instance_id in instance_ids_for_cache {
                let accounts =
                    match fetch_ft_lockup_instance_accounts(&state_clone, &instance_id).await {
                        Ok(accounts) => accounts,
                        Err((status, message)) => {
                            log::warn!(
                                "[ft-lockup] skipping instance={} during index build: {} ({})",
                                instance_id,
                                message,
                                status
                            );
                            continue;
                        }
                    };
                for dao_account_id in accounts {
                    index
                        .entry(dao_account_id)
                        .or_default()
                        .push(instance_id.clone());
                }
            }
            log::info!("[ft-lockup] dao index built entries={}", index.len());

            Ok::<_, (StatusCode, String)>(index)
        })
        .await
}

pub(crate) async fn fetch_ft_lockup_contract_metadata(
    state: &Arc<AppState>,
    instance_id: &str,
) -> Result<FtLockupContractMetadata, (StatusCode, String)> {
    log::info!("[ft-lockup] contract_metadata for instance={}", instance_id);
    let cache_key = CacheKey::new("ft-lockup-contract-metadata")
        .with(instance_id)
        .build();
    let state_clone = state.clone();
    let instance_id_owned = instance_id.to_string();

    state
        .cache
        .cached(CacheTier::VeryLongTerm, cache_key, async move {
            let instance_account: AccountId = instance_id_owned.parse().map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Invalid ft-lockup instance id: {}", e),
                )
            })?;

            let metadata = Contract(instance_account)
                .call_function("contract_metadata", serde_json::json!({}))
                .read_only::<FtLockupContractMetadata>()
                .fetch_from(&state_clone.network)
                .await
                .map_err(|e| {
                    log::warn!(
                        "[ft-lockup] contract_metadata failed for instance={}: {}",
                        instance_id_owned,
                        e
                    );
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to fetch FT lockup metadata".to_string(),
                    )
                })?;

            Ok::<_, (StatusCode, String)>(metadata.data)
        })
        .await
}

pub(crate) async fn fetch_ft_lockup_account_data(
    state: &Arc<AppState>,
    instance_id: &str,
    account_id: &AccountId,
) -> Result<Option<FtLockupAccountData>, (StatusCode, String)> {
    log::info!(
        "[ft-lockup] get_account instance={} dao={}",
        instance_id,
        account_id
    );
    let cache_key = CacheKey::new("ft-lockup-account")
        .with(instance_id)
        .with(account_id)
        .build();
    let state_clone = state.clone();
    let instance_id_owned = instance_id.to_string();
    let account_id_owned = account_id.to_string();

    state
        .cache
        .cached(CacheTier::ShortTerm, cache_key, async move {
            let instance_account: AccountId = instance_id_owned.parse().map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Invalid ft-lockup instance id: {}", e),
                )
            })?;

            let account_data_res = Contract(instance_account)
                .call_function(
                    "get_account",
                    serde_json::json!({
                        "account_id": account_id_owned
                    }),
                )
                .read_only::<serde_json::Value>()
                .fetch_from(&state_clone.network)
                .await;

            let account_data_value = match account_data_res {
                Ok(v) => v.data,
                Err(e) => {
                    log::warn!(
                        "[ft-lockup] get_account failed instance={} dao={}: {}",
                        instance_id_owned,
                        account_id_owned,
                        e
                    );
                    return Ok::<_, (StatusCode, String)>(None);
                }
            };

            if account_data_value.is_null() || !account_data_value.is_object() {
                log::info!(
                    "[ft-lockup] get_account empty instance={} dao={}",
                    instance_id_owned,
                    account_id_owned
                );
                return Ok::<_, (StatusCode, String)>(None);
            }

            let account_data =
                match serde_json::from_value::<FtLockupAccountData>(account_data_value) {
                    Ok(data) => data,
                    Err(e) => {
                        log::warn!(
                            "[ft-lockup] get_account parse failed instance={} dao={}: {}",
                            instance_id_owned,
                            account_id_owned,
                            e
                        );
                        return Ok::<_, (StatusCode, String)>(None);
                    }
                };

            log::info!(
                "[ft-lockup] get_account ok instance={} dao={}",
                instance_id_owned,
                account_id_owned
            );
            Ok::<_, (StatusCode, String)>(Some(account_data))
        })
        .await
}

async fn fetch_ft_lockup_positions(
    state: &Arc<AppState>,
    account_id: &AccountId,
) -> Result<Vec<FtLockupPosition>, (StatusCode, String)> {
    log::info!("[ft-lockup] resolve positions dao={}", account_id);
    let matched_instance_ids = match query_as::<_, (bool, Vec<String>)>(
        r#"
        SELECT
            EXISTS(SELECT 1 FROM ft_lockup_dao_schedules) AS has_any_rows,
            COALESCE(
                (
                    SELECT array_agg(instance_id ORDER BY instance_id)
                    FROM ft_lockup_dao_schedules
                    WHERE dao_account_id = $1
                ),
                ARRAY[]::TEXT[]
            ) AS matched_instance_ids
        "#,
    )
    .bind(account_id.as_str())
    .fetch_one(&state.db_pool)
    .await
    {
        Ok((_, ids)) if !ids.is_empty() => {
            log::info!(
                "[ft-lockup] matched instances from db dao={} count={}",
                account_id,
                ids.len()
            );
            ids
        }
        Ok((true, _)) => {
            log::info!(
                "[ft-lockup] no db matches for dao={} while schedules table has data; skip reverse-index fallback",
                account_id
            );
            Vec::new()
        }
        Ok((false, _)) => {
            log::info!(
                "[ft-lockup] schedules table empty, fallback to reverse index dao={}",
                account_id
            );
            let instance_ids = fetch_ft_lockup_instance_ids(state).await?;
            if instance_ids.is_empty() {
                log::info!("[ft-lockup] no instances configured");
                return Ok(Vec::new());
            }

            let dao_instance_index =
                fetch_ft_lockup_dao_instance_index(state, &instance_ids).await?;
            let dao_account_key = account_id.to_string();
            let ids = dao_instance_index
                .get(&dao_account_key)
                .cloned()
                .unwrap_or_default();
            log::info!(
                "[ft-lockup] matched instances from reverse-index dao={} count={}",
                account_id,
                ids.len()
            );
            ids
        }
        Err(e) => {
            log::warn!(
                "[ft-lockup] db lookup failed for dao={}, fallback to reverse index: {}",
                account_id,
                e
            );
            let instance_ids = fetch_ft_lockup_instance_ids(state).await?;
            if instance_ids.is_empty() {
                log::info!("[ft-lockup] no instances configured");
                return Ok(Vec::new());
            }

            let dao_instance_index =
                fetch_ft_lockup_dao_instance_index(state, &instance_ids).await?;
            let dao_account_key = account_id.to_string();
            let ids = dao_instance_index
                .get(&dao_account_key)
                .cloned()
                .unwrap_or_default();
            log::info!(
                "[ft-lockup] matched instances from reverse-index dao={} count={}",
                account_id,
                ids.len()
            );
            ids
        }
    };

    let mut positions = Vec::new();

    for instance_id in matched_instance_ids {
        let account_data =
            match fetch_ft_lockup_account_data(state, &instance_id, account_id).await? {
                Some(data) => data,
                None => continue,
            };
        let metadata = match fetch_ft_lockup_contract_metadata(state, &instance_id).await {
            Ok(m) => m,
            Err(_) => continue,
        };

        let deposited_amount = parse_u128_amount(&account_data.deposited_amount);
        let claimed_amount = parse_u128_amount(&account_data.claimed_amount);
        let unclaimed_amount = parse_u128_amount(&account_data.unclaimed_amount);

        if deposited_amount == 0 || claimed_amount >= deposited_amount {
            log::info!(
                "[ft-lockup] skip instance={} dao={} deposited={} claimed={}",
                instance_id,
                account_id,
                deposited_amount,
                claimed_amount
            );
            continue;
        }

        positions.push(FtLockupPosition {
            instance_id: instance_id.clone(),
            token_account_id: metadata.token_account_id,
            deposited_amount,
            claimed_amount,
            unclaimed_amount,
            start_timestamp: account_data.start_timestamp,
            session_interval: account_data.session_interval,
            session_num: account_data.session_num,
            last_claim_session: account_data.last_claim_session,
        });
    }

    log::info!(
        "[ft-lockup] positions ready dao={} count={}",
        account_id,
        positions.len()
    );
    Ok(positions)
}

fn build_intents_tokens(
    tokens_with_balances: Vec<(String, String)>,
    metadata_map: &HashMap<String, TokenMetadataResponse>,
) -> Vec<(SimplifiedToken, U128)> {
    tokens_with_balances
        .into_iter()
        .filter_map(|(token_id, balance)| {
            let metadata = if token_id == "nep141:wrap.near" {
                metadata_map.get("near")
            } else {
                metadata_map.get(&format!("intents.near:{}", token_id))
            }?;
            let balance_raw: U128 = balance.parse::<u128>().unwrap_or(0).into();

            let unified_id = find_unified_asset_id(&token_id)
                .map(|s| s.to_string())
                .unwrap_or_else(|| metadata.symbol.to_lowercase());
            Some((
                SimplifiedToken {
                    id: unified_id,
                    contract_id: Some(token_id),
                    lockup_instance_id: None,
                    ft_lockup_schedule: None,
                    decimals: metadata.decimals,
                    balance: Balance::Standard {
                        total: balance_raw.0.to_string(),
                        locked: "0".to_string(),
                    },
                    price: metadata
                        .price
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| "0".to_string()),
                    symbol: metadata.symbol.clone(),
                    name: metadata.name.clone(),
                    icon: metadata.icon.clone(),
                    network: metadata.network.clone().unwrap_or_default(),
                    residency: TokenResidency::Intents,
                    chain_icons: metadata.chain_icons.clone(),
                    chain_name: metadata.chain_name.clone().unwrap_or(metadata.name.clone()),
                },
                balance_raw,
            ))
        })
        .collect()
}

pub async fn fetch_near_balance(
    state: &Arc<AppState>,
    account_id: &AccountId,
) -> Result<TokenBalanceResponse, (StatusCode, String)> {
    crate::handlers::user::balance::fetch_near_balance(state, account_id.clone())
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch NEAR balance: {}", e),
            )
        })
}

pub async fn compute_user_assets(
    state: &Arc<AppState>,
    account: &AccountId,
) -> Result<Vec<SimplifiedToken>, (StatusCode, String)> {
    // Fetch REF Finance data
    let ref_data_future = async {
        let tokens_future = fetch_whitelisted_tokens(state);
        let balances_future = fetch_user_balances(state, account);
        let near_balance = fetch_near_balance(state, account);
        let lockup_balance = fetch_lockup_balance_of_account(state, account);
        let staking_balance = fetch_staking_balances(state, account);

        let (whitelist_set, user_balances, near_balance, lockup_balance, staking_balance) = tokio::try_join!(
            tokens_future,
            balances_future,
            near_balance,
            lockup_balance,
            staking_balance
        )?;

        let ft_lockup_positions = fetch_ft_lockup_positions(state, account).await?;

        Ok::<_, (StatusCode, String)>((
            whitelist_set,
            user_balances,
            near_balance,
            lockup_balance,
            staking_balance,
            ft_lockup_positions,
        ))
    };

    // Fetch intents balances
    let intents_data_future = async {
        let owned_token_ids = fetch_intents_owned_tokens(state, account).await?;
        if owned_token_ids.is_empty() {
            return Ok::<_, (StatusCode, String)>(Vec::new());
        }

        let balances = fetch_intents_balances(state, account, &owned_token_ids).await?;

        // Filter to only tokens with non-zero balances
        let tokens_with_balances: Vec<(String, String)> = owned_token_ids
            .into_iter()
            .zip(balances.into_iter())
            .filter(|(_, balance)| balance.parse::<u128>().unwrap_or(0) > 0)
            .collect();

        Ok(tokens_with_balances)
    };

    // Fetch all data concurrently
    let (ref_data_result, intents_data_result) = tokio::join!(ref_data_future, intents_data_future);

    // Get whitelisted tokens and user balances
    let (
        whitelist_set,
        user_balances,
        near_balance,
        lockup_balance,
        staking_balance,
        ft_lockup_positions,
    ) = ref_data_result?;

    // Get intents balances (already filtered to non-zero)
    let intents_balances = intents_data_result.unwrap_or_else(|e| {
        eprintln!("Warning: Failed to fetch intents tokens: {:?}", e);
        Vec::new()
    });

    // Build balance map and filter REF Finance tokens to only those with positive balances
    let balance_map = build_balance_map(&user_balances);
    let ref_tokens_with_balances: Vec<(String, U128)> = whitelist_set
        .into_iter()
        .filter_map(|token_id| {
            let balance = balance_map
                .get(&token_id)
                .cloned()
                .unwrap_or_else(|| U128::from(0));
            if balance != U128::from(0) {
                Some((token_id, balance))
            } else {
                None
            }
        })
        .collect();

    let mut token_ids_to_fetch: Vec<String> = ref_tokens_with_balances
        .iter()
        .map(|(id, _)| id.clone())
        .collect();
    token_ids_to_fetch.extend(
        intents_balances
            .iter()
            .map(|(id, _)| format!("intents.near:{}", id)),
    );
    token_ids_to_fetch.extend(
        ft_lockup_positions
            .iter()
            .map(|p| p.token_account_id.clone()),
    );
    token_ids_to_fetch.push("near".to_string());

    // Fetch metadata for only tokens with positive balances in a single batch request
    let metadata_map = if !token_ids_to_fetch.is_empty() {
        fetch_tokens_with_defuse_extension(state, &token_ids_to_fetch).await
    } else {
        HashMap::new()
    };

    // Build a map keyed by defuse asset ID for O(1) lookups
    // Find wrap.near metadata explicitly instead of assuming it's last
    let near_token_meta = metadata_map.get("near").cloned().unwrap_or_else(|| {
        eprintln!("[User Assets] Warning: wrap.near metadata not found, using fallback");
        TokenMetadataResponse::create_near_metadata(None, None)
    });

    // Build simplified tokens for REF Finance tokens.
    // REF token IDs are bare (e.g. "wrap.near"); metadata is keyed as "nep141:wrap.near".
    let mut all_simplified_tokens: Vec<(SimplifiedToken, U128)> = ref_tokens_with_balances
        .into_iter()
        .filter_map(|(token_id, balance)| {
            let (token_meta, unified_id) =
                resolve_token_meta_and_unified_id(&token_id, &metadata_map, &near_token_meta)?;

            let price = token_meta.price.unwrap_or(0.0).to_string();

            Some((
                SimplifiedToken {
                    id: unified_id,
                    contract_id: Some(token_id),
                    lockup_instance_id: None,
                    ft_lockup_schedule: None,
                    decimals: token_meta.decimals,
                    balance: Balance::Standard {
                        total: balance.0.to_string(),
                        locked: "0".to_string(),
                    },
                    price,
                    symbol: token_meta.symbol.clone(),
                    name: token_meta.name.clone(),
                    icon: token_meta.icon.clone(),
                    network: "near".to_string(),
                    residency: TokenResidency::Ft,
                    chain_icons: token_meta.chain_icons.clone(),
                    chain_name: token_meta
                        .chain_name
                        .clone()
                        .unwrap_or_else(|| "Near Protocol".to_string()),
                },
                balance.clone(),
            ))
        })
        .collect();

    all_simplified_tokens.extend(build_intents_tokens(intents_balances, &metadata_map));

    // Add FT lockup balances as standard token balances with a locked portion.
    // Note: the same FT token contract can be deposited in multiple lockup sessions
    // (different ft-lockup instances), so we keep each session as its own row.
    // total   = deposited - claimed
    // locked  = unreleased = deposited - claimed - unclaimed
    // available = total - locked = unclaimed
    for position in ft_lockup_positions {
        let Some((token_meta, unified_id)) = resolve_token_meta_and_unified_id(
            &position.token_account_id,
            &metadata_map,
            &near_token_meta,
        ) else {
            continue;
        };

        let total_raw = position
            .deposited_amount
            .saturating_sub(position.claimed_amount);
        if total_raw == 0 {
            continue;
        }

        let locked_raw = position
            .deposited_amount
            .saturating_sub(position.claimed_amount)
            .saturating_sub(position.unclaimed_amount);

        all_simplified_tokens.push((
            SimplifiedToken {
                id: unified_id,
                contract_id: Some(position.token_account_id),
                lockup_instance_id: Some(position.instance_id),
                ft_lockup_schedule: Some(FtLockupSchedule {
                    start_timestamp: position.start_timestamp,
                    session_interval: position.session_interval,
                    session_num: position.session_num,
                    last_claim_session: position.last_claim_session,
                }),
                decimals: token_meta.decimals,
                balance: Balance::Standard {
                    total: total_raw.to_string(),
                    locked: locked_raw.to_string(),
                },
                price: token_meta.price.unwrap_or(0.0).to_string(),
                symbol: token_meta.symbol.clone(),
                name: token_meta.name.clone(),
                icon: token_meta.icon.clone(),
                network: token_meta.network.clone().unwrap_or_default(),
                residency: TokenResidency::Ft,
                chain_icons: token_meta.chain_icons.clone(),
                chain_name: token_meta
                    .chain_name
                    .clone()
                    .unwrap_or_else(|| "Near Protocol".to_string()),
            },
            total_raw.into(),
        ));
    }

    // Add lockup balance if exists
    if let Some(lockup) = lockup_balance {
        let total = lockup.total.as_yoctonear().into();
        all_simplified_tokens.push((
            SimplifiedToken {
                id: "near".to_string(),
                contract_id: None,
                lockup_instance_id: None,
                ft_lockup_schedule: None,
                decimals: near_token_meta.decimals,
                balance: Balance::Vested(lockup),
                price: near_token_meta.price.unwrap_or(0.0).to_string(),
                symbol: near_token_meta.symbol.clone(),
                name: near_token_meta.name.clone(),
                icon: near_token_meta.icon.clone(),
                network: near_token_meta.network.clone().unwrap_or_default(),
                residency: TokenResidency::Lockup,
                chain_name: near_token_meta
                    .chain_name
                    .clone()
                    .unwrap_or(near_token_meta.name.clone()),
                chain_icons: near_token_meta.chain_icons.clone(),
            },
            total,
        ));
    }

    // Add staking balance if exists
    if let Some(staking) = staking_balance {
        let total: U128 = staking
            .staked_balance
            .saturating_add(staking.unstaked_balance)
            .as_yoctonear()
            .into();
        all_simplified_tokens.push((
            SimplifiedToken {
                id: "near".to_string(),
                contract_id: None,
                lockup_instance_id: None,
                ft_lockup_schedule: None,
                decimals: near_token_meta.decimals,
                balance: Balance::Staked(staking),
                price: near_token_meta.price.unwrap_or(0.0).to_string(),
                symbol: near_token_meta.symbol.clone(),
                name: near_token_meta.name.clone(),
                icon: near_token_meta.icon.clone(),
                network: near_token_meta.network.clone().unwrap_or_default(),
                residency: TokenResidency::Staked,
                chain_name: near_token_meta
                    .chain_name
                    .clone()
                    .unwrap_or(near_token_meta.name.clone()),
                chain_icons: near_token_meta.chain_icons.clone(),
            },
            total,
        ));
    }

    all_simplified_tokens.push((
        SimplifiedToken {
            id: "near".to_string(),
            contract_id: None,
            lockup_instance_id: None,
            ft_lockup_schedule: None,
            decimals: near_token_meta.decimals,
            balance: Balance::Standard {
                total: near_balance.balance.0.to_string(),
                locked: "0".to_string(),
            },
            price: near_token_meta.price.unwrap_or(0.0).to_string(),
            symbol: near_token_meta.symbol.clone(),
            name: near_token_meta.name.clone(),
            icon: near_token_meta.icon.clone(),
            network: near_token_meta.network.clone().unwrap_or_default(),
            residency: TokenResidency::Near,
            chain_name: near_token_meta
                .chain_name
                .clone()
                .unwrap_or(near_token_meta.name.clone()),
            chain_icons: near_token_meta.chain_icons.clone(),
        },
        near_balance.balance,
    ));

    // Sort combined list by balance (highest first)
    all_simplified_tokens = all_simplified_tokens
        .into_iter()
        .filter(|(_, balance)| balance.0 > 0)
        .collect::<Vec<(SimplifiedToken, U128)>>();
    all_simplified_tokens.sort_by(|(_, a_balance), (_, b_balance)| {
        b_balance
            .0
            .partial_cmp(&a_balance.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(all_simplified_tokens
        .into_iter()
        .map(|(token, _)| token)
        .collect())
}

pub async fn get_user_assets(
    State(state): State<Arc<AppState>>,
    Query(params): Query<UserAssetsQuery>,
) -> Result<Json<Vec<SimplifiedToken>>, (StatusCode, String)> {
    let account = params.account_id.clone();
    let cache_key = format!("{}-user-assets", account);
    let state_clone = state.clone();
    let account_clone = account.clone();

    let all_simplified_tokens = state
        .cache
        .cached(CacheTier::ShortTerm, cache_key, async move {
            compute_user_assets(&state_clone, &account_clone).await
        })
        .await?;

    Ok(Json(all_simplified_tokens))
}

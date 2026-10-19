//! Token contracts the sponsor may pay a NEP-141 `storage_deposit` on.
//!
//! A proposal names the token contract. On an approving vote the sponsor used
//! to call `storage_deposit` on that contract unconditionally, so a proposal
//! whose token is an attacker-controlled account drains the sponsor (the
//! contract keeps the 0.00125 NEAR instead of refunding it).
//!
//! The sponsor now pays only for contracts on this list: Ref Finance's
//! whitelist, NEP-141 contracts from the bridge supported-token list, plus a
//! few contracts we always trust (`wrap.near` and [`NEAR_FT_WHITELIST`]).
//! Anything else is left for the proposal itself to pay — see the frontend
//! builders, which prepend a `storage_deposit` action on the same
//! `FunctionCall`.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::sync::{Mutex, RwLock};

use crate::{
    AppState,
    constants::near_ft_whitelist::NEAR_FT_WHITELIST,
    handlers::{
        intents::supported_tokens::fetch_supported_tokens_data,
        user::assets::fetch_whitelisted_tokens,
    },
};

const REFRESH_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// `near_deposit` registers the treasury on this contract. It is not always
/// present in the Ref list, and skipping it makes the wrap spend 0.00125 NEAR
/// of the attached deposit on first-time registration.
const WRAP_NEAR: &str = "wrap.near";

#[derive(Default, Clone)]
struct CacheState {
    /// Last successful bridge supported-token extraction.
    bridge: HashSet<String>,
    /// Last successful Ref Finance whitelist.
    ref_tokens: HashSet<String>,
    last_refresh_attempt: Option<Instant>,
}

static CACHE: LazyLock<RwLock<CacheState>> = LazyLock::new(|| RwLock::new(CacheState::default()));
/// One refresh at a time. A second caller waits, then reads the list the first
/// refresh stored, instead of writing an older fetch over it.
static REFRESH_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// `None` means that source failed and the previous set must be kept.
struct FetchOutcome {
    bridge: Option<HashSet<String>>,
    ref_tokens: Option<HashSet<String>>,
}

pub(crate) fn extract_intents_whitelist_contracts(supported_tokens: &Value) -> HashSet<String> {
    let mut contracts = HashSet::new();
    let Some(tokens) = supported_tokens.get("tokens").and_then(Value::as_array) else {
        return contracts;
    };

    for token in tokens {
        let standard = token.get("standard").and_then(Value::as_str).unwrap_or("");
        // A nep245 intents row still names the underlying NEP-141 contract in
        // defuse_asset_identifier. Only nep141: ids are contracts the sponsor
        // may call storage_deposit on; nep245:intents.near:* is not one.
        for field in ["intents_token_id", "defuse_asset_identifier"] {
            let Some(asset_id) = token.get(field).and_then(Value::as_str) else {
                continue;
            };
            let Some(contract_id) = asset_id.strip_prefix("nep141:") else {
                continue;
            };
            if !contract_id.is_empty() && !contract_id.contains(':') {
                contracts.insert(contract_id.to_string());
            }
        }
        // Some nep141 rows omit the prefix and put the account in near_token_id.
        // nep245 rows use that field for the multi-token contract (intents.near,
        // v2_1.omni.hot.tg), which must not receive a sponsored storage_deposit.
        if standard == "nep141"
            && let Some(near_token_id) = token.get("near_token_id").and_then(Value::as_str)
            && !near_token_id.is_empty()
            && !near_token_id.contains(':')
        {
            contracts.insert(near_token_id.to_string());
        }
    }
    contracts
}

fn always_allowed() -> HashSet<String> {
    let mut contracts = HashSet::new();
    contracts.insert(WRAP_NEAR.to_string());
    for contract_id in NEAR_FT_WHITELIST {
        contracts.insert((*contract_id).to_string());
    }
    contracts
}

async fn fetch_external(state: &Arc<AppState>) -> FetchOutcome {
    let (intents_result, ref_result) = tokio::join!(
        fetch_supported_tokens_data(state),
        fetch_whitelisted_tokens(state)
    );

    let bridge = match intents_result {
        Ok(supported_tokens) => Some(extract_intents_whitelist_contracts(&supported_tokens)),
        Err((_, message)) => {
            tracing::warn!(
                "failed to fetch bridge token list for storage_deposit allowlist: {message}"
            );
            None
        }
    };
    let ref_tokens = match ref_result {
        Ok(whitelist) => Some(whitelist),
        Err((_, message)) => {
            tracing::warn!(
                "failed to fetch Ref whitelist for storage_deposit allowlist: {message}"
            );
            None
        }
    };

    FetchOutcome { bridge, ref_tokens }
}

/// Replace only the sources that succeeded. A failed source keeps its previous
/// set, so one outage does not drop the other list.
fn apply_fetch(cache: &mut CacheState, outcome: FetchOutcome) {
    match outcome.bridge {
        Some(bridge) => cache.bridge = bridge,
        None if !cache.bridge.is_empty() => {
            tracing::warn!("using stale bridge token list for storage_deposit allowlist");
        }
        None => {
            tracing::warn!("bridge token list unavailable and no cached copy exists");
        }
    }
    match outcome.ref_tokens {
        Some(ref_tokens) => cache.ref_tokens = ref_tokens,
        None if !cache.ref_tokens.is_empty() => {
            tracing::warn!("using stale Ref whitelist for storage_deposit allowlist");
        }
        None => {
            tracing::warn!("Ref whitelist unavailable and no cached copy exists");
        }
    }
}

fn from_cache(cache: &CacheState) -> HashSet<String> {
    let mut allowed = always_allowed();
    allowed.extend(cache.bridge.iter().cloned());
    allowed.extend(cache.ref_tokens.iter().cloned());
    allowed
}

async fn needs_refresh() -> bool {
    let cache = CACHE.read().await;
    cache
        .last_refresh_attempt
        .map(|last| last.elapsed() >= REFRESH_INTERVAL)
        .unwrap_or(true)
}

/// Contracts the sponsor may call `storage_deposit` on. Always includes
/// [`always_allowed`]. Each upstream list is cached on its own: a failed
/// refresh keeps that source's last successful set. With no successful fetch
/// yet, only [`always_allowed`] is returned.
pub(crate) async fn allowed_storage_contracts(state: &Arc<AppState>) -> HashSet<String> {
    if !needs_refresh().await {
        return from_cache(&*CACHE.read().await);
    }

    let _refresh = REFRESH_GATE.lock().await;
    if !needs_refresh().await {
        return from_cache(&*CACHE.read().await);
    }

    let outcome = fetch_external(state).await;
    let mut cache = CACHE.write().await;
    cache.last_refresh_attempt = Some(Instant::now());
    apply_fetch(&mut cache, outcome);
    from_cache(&cache)
}

pub(crate) async fn sponsor_may_register_token(state: &Arc<AppState>, token_id: &str) -> bool {
    allowed_storage_contracts(state).await.contains(token_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_nep141_contracts_from_either_field() {
        let supported = json!({
            "tokens": [
                {
                    "standard": "nep141",
                    "intents_token_id": "nep141:usdc.near",
                    "defuse_asset_identifier": "nep141:usdc.near"
                },
                {
                    "standard": "nep245",
                    "intents_token_id": "nep245:intents.near:usdt",
                    "defuse_asset_identifier": "nep141:usdt.tether-token.near",
                    "near_token_id": "intents.near"
                },
                {
                    "standard": "nep141",
                    "intents_token_id": "sol-0x4629.omdep.near",
                    "near_token_id": "sol-0x4629.omdep.near"
                },
                { "standard": "nep141", "intents_token_id": "not-an-asset" }
            ]
        });
        let contracts = extract_intents_whitelist_contracts(&supported);
        assert!(contracts.contains("usdc.near"));
        assert!(contracts.contains("usdt.tether-token.near"));
        assert!(contracts.contains("sol-0x4629.omdep.near"));
        assert!(!contracts.contains("intents.near"));
        assert_eq!(contracts.len(), 3);
    }

    #[test]
    fn always_includes_wrap_near() {
        assert!(always_allowed().contains(WRAP_NEAR));
    }

    #[test]
    fn failed_source_keeps_its_previous_list() {
        let mut cache = CacheState {
            bridge: HashSet::from(["usdc.near".to_string()]),
            ref_tokens: HashSet::from(["ref-token.near".to_string()]),
            last_refresh_attempt: None,
        };
        apply_fetch(
            &mut cache,
            FetchOutcome {
                bridge: None,
                ref_tokens: Some(HashSet::from(["new-ref.near".to_string()])),
            },
        );
        assert!(cache.bridge.contains("usdc.near"));
        assert!(cache.ref_tokens.contains("new-ref.near"));
        assert!(!cache.ref_tokens.contains("ref-token.near"));

        let allowed = from_cache(&cache);
        assert!(allowed.contains("usdc.near"));
        assert!(allowed.contains("new-ref.near"));
        assert!(allowed.contains(WRAP_NEAR));
    }

    #[test]
    fn failed_sources_on_an_empty_cache_return_only_builtins() {
        let mut cache = CacheState::default();
        apply_fetch(
            &mut cache,
            FetchOutcome {
                bridge: None,
                ref_tokens: None,
            },
        );
        assert_eq!(from_cache(&cache), always_allowed());
    }

    #[test]
    fn successful_sources_are_merged_with_builtins() {
        let mut cache = CacheState::default();
        apply_fetch(
            &mut cache,
            FetchOutcome {
                bridge: Some(HashSet::from(["bridge-token.near".to_string()])),
                ref_tokens: Some(HashSet::from(["ref-token.near".to_string()])),
            },
        );
        let mut expected = always_allowed();
        expected.insert("bridge-token.near".to_string());
        expected.insert("ref-token.near".to_string());
        assert_eq!(from_cache(&cache), expected);
    }
}

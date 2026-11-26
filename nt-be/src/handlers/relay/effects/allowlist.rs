//! Token contracts the sponsor may pay a NEP-141 `storage_deposit` on.
//!
//! A proposal names the token contract. On an approving vote the sponsor used
//! to call `storage_deposit` on that contract unconditionally, so a proposal
//! whose token is an attacker-controlled account drains the sponsor (the
//! contract keeps the 0.00125 NEAR instead of refunding it).
//!
//! The sponsor now pays only for contracts on this list: Ref Finance's
//! whitelist, NEP-141 contracts from the 1Click `/v0/tokens` list, plus a
//! few contracts we always trust (`wrap.near` and [`NEAR_FT_WHITELIST`]).
//! Anything else is left for the proposal itself to pay — see the frontend
//! builders, which prepend a `storage_deposit` action on the same
//! `FunctionCall`.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, RwLock};

use crate::{
    AppState,
    constants::near_ft_whitelist::NEAR_FT_WHITELIST,
    handlers::user::assets::fetch_whitelisted_tokens,
    services::oneclick_tokens::{OneClickToken, fetch_oneclick_tokens},
};

const REFRESH_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// How often a list that has never loaded is asked for again.
const MISSING_LIST_RETRY: Duration = Duration::from_secs(30);
/// `near_deposit` registers the treasury on this contract. It is not always
/// present in the Ref list, and skipping it makes the wrap spend 0.00125 NEAR
/// of the attached deposit on first-time registration.
const WRAP_NEAR: &str = "wrap.near";

#[derive(Default, Clone)]
struct CacheState {
    /// Last successful 1Click token-list extraction; `None` until the first
    /// one.
    bridge: Option<HashSet<String>>,
    /// Last successful Ref Finance whitelist; `None` until the first one.
    ref_tokens: Option<HashSet<String>>,
    last_refresh_attempt: Option<Instant>,
}

impl CacheState {
    /// Both upstream lists have loaded at least once.
    fn is_complete(&self) -> bool {
        self.bridge.is_some() && self.ref_tokens.is_some()
    }

    fn refresh_interval(&self) -> Duration {
        if self.is_complete() {
            REFRESH_INTERVAL
        } else {
            MISSING_LIST_RETRY
        }
    }
}

/// The contracts the sponsor registers on, and whether that set is final.
pub(crate) struct StorageAllowlist {
    contracts: HashSet<String>,
    complete: bool,
}

impl StorageAllowlist {
    /// Whether the sponsor pays `storage_deposit` on `token_id`. An error
    /// while a list that could still name it has never loaded: answering "no"
    /// then would skip a registration the sponsor owes.
    pub(crate) fn sponsors(&self, token_id: &str) -> Result<bool, String> {
        if self.contracts.contains(token_id) {
            return Ok(true);
        }
        if self.complete {
            return Ok(false);
        }
        Err(format!(
            "storage_deposit allowlist is not fully loaded; cannot decide for {token_id}"
        ))
    }
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

/// NEP-141 contracts among the 1Click tokens. `nep245:` and `1cs_v1:` ids
/// are not contracts the sponsor may call `storage_deposit` on.
pub(crate) fn extract_intents_whitelist_contracts(tokens: &[OneClickToken]) -> HashSet<String> {
    tokens
        .iter()
        .filter_map(|token| token.asset_id.strip_prefix("nep141:"))
        .filter(|contract_id| !contract_id.is_empty() && !contract_id.contains(':'))
        .map(str::to_string)
        .collect()
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
        fetch_oneclick_tokens(state),
        fetch_whitelisted_tokens(state)
    );

    let bridge = match intents_result {
        Ok(tokens) => Some(extract_intents_whitelist_contracts(&tokens)),
        Err((_, message)) => {
            tracing::warn!(
                "failed to fetch 1Click token list for storage_deposit allowlist: {message}"
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
        Some(bridge) => cache.bridge = Some(bridge),
        None if cache.bridge.is_some() => {
            tracing::warn!("using stale bridge token list for storage_deposit allowlist");
        }
        None => {
            tracing::warn!("bridge token list unavailable and no cached copy exists");
        }
    }
    match outcome.ref_tokens {
        Some(ref_tokens) => cache.ref_tokens = Some(ref_tokens),
        None if cache.ref_tokens.is_some() => {
            tracing::warn!("using stale Ref whitelist for storage_deposit allowlist");
        }
        None => {
            tracing::warn!("Ref whitelist unavailable and no cached copy exists");
        }
    }
}

/// A total miss on an empty cache does not start a wait, so the next check
/// tries the lists again. Otherwise the next refresh waits the hour, or
/// [`MISSING_LIST_RETRY`] while one list has never loaded.
fn remember_refresh(cache: &mut CacheState, outcome: FetchOutcome, now: Instant) {
    apply_fetch(cache, outcome);
    if cache.bridge.is_some() || cache.ref_tokens.is_some() {
        cache.last_refresh_attempt = Some(now);
    }
}

fn from_cache(cache: &CacheState) -> HashSet<String> {
    let mut allowed = always_allowed();
    allowed.extend(cache.bridge.iter().flatten().cloned());
    allowed.extend(cache.ref_tokens.iter().flatten().cloned());
    allowed
}

async fn needs_refresh() -> bool {
    let cache = CACHE.read().await;
    cache
        .last_refresh_attempt
        .map(|last| last.elapsed() >= cache.refresh_interval())
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
    remember_refresh(&mut cache, outcome, Instant::now());
    from_cache(&cache)
}

/// [`allowed_storage_contracts`] with whether both upstream lists stand
/// behind it, for a caller that must not mistake "not loaded" for "not
/// allowed".
pub(crate) async fn storage_allowlist(state: &Arc<AppState>) -> StorageAllowlist {
    let contracts = allowed_storage_contracts(state).await;
    StorageAllowlist {
        contracts,
        complete: CACHE.read().await.is_complete(),
    }
}

pub(crate) async fn sponsor_may_register_token(state: &Arc<AppState>, token_id: &str) -> bool {
    allowed_storage_contracts(state).await.contains(token_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn token(asset_id: &str) -> OneClickToken {
        serde_json::from_value(json!({
            "assetId": asset_id,
            "decimals": 6,
            "blockchain": "near",
            "symbol": "T"
        }))
        .expect("valid 1Click token")
    }

    #[test]
    fn extracts_only_nep141_contracts() {
        let contracts = extract_intents_whitelist_contracts(&[
            token("nep141:usdc.near"),
            token("nep141:sol-0x4629.omft.near"),
            token("nep245:v2_1.omni.hot.tg:56_11111111111111111111"),
            token("1cs_v1:sol:spl:Abc"),
            token("nep141:"),
        ]);
        assert!(contracts.contains("usdc.near"));
        assert!(contracts.contains("sol-0x4629.omft.near"));
        assert!(!contracts.contains("v2_1.omni.hot.tg"));
        assert_eq!(contracts.len(), 2);
    }

    #[test]
    fn always_includes_wrap_near() {
        assert!(always_allowed().contains(WRAP_NEAR));
    }

    #[test]
    fn failed_source_keeps_its_previous_list() {
        let mut cache = CacheState {
            bridge: Some(HashSet::from(["usdc.near".to_string()])),
            ref_tokens: Some(HashSet::from(["ref-token.near".to_string()])),
            last_refresh_attempt: None,
        };
        apply_fetch(
            &mut cache,
            FetchOutcome {
                bridge: None,
                ref_tokens: Some(HashSet::from(["new-ref.near".to_string()])),
            },
        );
        assert!(cache.bridge.as_ref().unwrap().contains("usdc.near"));
        let ref_tokens = cache.ref_tokens.as_ref().unwrap();
        assert!(ref_tokens.contains("new-ref.near"));
        assert!(!ref_tokens.contains("ref-token.near"));

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

    #[test]
    fn empty_cache_retries_when_both_sources_fail() {
        let mut cache = CacheState::default();
        remember_refresh(
            &mut cache,
            FetchOutcome {
                bridge: None,
                ref_tokens: None,
            },
            Instant::now(),
        );
        assert!(cache.last_refresh_attempt.is_none());
    }

    #[test]
    fn saved_list_waits_when_both_sources_fail() {
        let mut cache = CacheState {
            bridge: Some(HashSet::from(["usdc.near".to_string()])),
            ref_tokens: None,
            last_refresh_attempt: None,
        };
        remember_refresh(
            &mut cache,
            FetchOutcome {
                bridge: None,
                ref_tokens: None,
            },
            Instant::now(),
        );
        assert!(cache.last_refresh_attempt.is_some());
        assert!(cache.bridge.as_ref().unwrap().contains("usdc.near"));
    }

    #[test]
    fn a_list_that_never_loaded_is_retried_soon_and_leaves_the_answer_open() {
        let mut cache = CacheState::default();
        remember_refresh(
            &mut cache,
            FetchOutcome {
                bridge: Some(HashSet::from(["usdc.near".to_string()])),
                ref_tokens: None,
            },
            Instant::now(),
        );
        assert!(!cache.is_complete());
        assert_eq!(cache.refresh_interval(), MISSING_LIST_RETRY);

        let partial = StorageAllowlist {
            contracts: from_cache(&cache),
            complete: cache.is_complete(),
        };
        assert_eq!(partial.sponsors("usdc.near"), Ok(true));
        assert_eq!(partial.sponsors(WRAP_NEAR), Ok(true));
        assert!(
            partial.sponsors("only-on-ref.near").is_err(),
            "the missing list could still name it"
        );

        remember_refresh(
            &mut cache,
            FetchOutcome {
                bridge: None,
                ref_tokens: Some(HashSet::new()),
            },
            Instant::now(),
        );
        assert!(cache.is_complete(), "an empty list is still a loaded list");
        assert_eq!(cache.refresh_interval(), REFRESH_INTERVAL);
        let full = StorageAllowlist {
            contracts: from_cache(&cache),
            complete: cache.is_complete(),
        };
        assert_eq!(full.sponsors("only-on-ref.near"), Ok(false));
        assert_eq!(
            full.sponsors("usdc.near"),
            Ok(true),
            "a failed refresh keeps the list"
        );
    }
}

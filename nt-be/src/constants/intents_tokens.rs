use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::constants::nearcom_ranking::is_stablecoin;

/// Represents the root of the vendored token catalog JSON.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokensJson {
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
    pub tokens: Vec<TokenInfo>,
}

/// Represents either a unified token or a base token
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum TokenInfo {
    Unified(UnifiedTokenInfo),
    Base(BaseTokenInfo),
}

/// A virtual aggregation of the same token across multiple blockchains
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedTokenInfo {
    pub unified_asset_id: String,
    pub symbol: String,
    pub name: String,
    pub icon: String,
    pub grouped_tokens: Vec<BaseTokenInfo>,
    pub tags: Option<Vec<String>>,
}

/// One token recognized by NEAR Intents
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BaseTokenInfo {
    pub defuse_asset_id: String,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub icon: String,
    pub origin_chain_name: String,
    pub deployments: Vec<TokenDeployment>,
    pub tags: Option<Vec<String>>,
}

/// Represents a deployment of a token on a specific chain
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum TokenDeployment {
    Native {
        #[serde(rename = "type")]
        kind: String, // "native"
        decimals: u8,
        #[serde(rename = "chainName")]
        chain_name: String,
        bridge: String,
    },
    Fungible {
        address: String,
        decimals: u8,
        #[serde(rename = "chainName")]
        chain_name: String,
        bridge: String,
        #[serde(rename = "stellarCode")]
        stellar_code: Option<String>,
    },
}

/// Static map of unified tokens loaded from `nearcom-tokens.json` for fast lookup
static TOKENS_MAP_CELL: OnceLock<HashMap<String, UnifiedTokenInfo>> = OnceLock::new();

/// Static map of base tokens by defuseAssetId for fast lookup
static DEFUSE_TOKENS_MAP_CELL: OnceLock<HashMap<String, BaseTokenInfo>> = OnceLock::new();

/// Static map of defuse_asset_id -> unified_asset_id for reverse lookup
static DEFUSE_TO_UNIFIED_MAP_CELL: OnceLock<HashMap<String, String>> = OnceLock::new();

/// Static map of unified tokens by lowercase symbol for fast lookup
static SYMBOL_TOKENS_MAP_CELL: OnceLock<HashMap<String, UnifiedTokenInfo>> = OnceLock::new();

/// Static multi-map of base tokens by defuseAssetId (preserves duplicates)
static DEFUSE_TOKENS_MULTI_MAP_CELL: OnceLock<HashMap<String, Vec<BaseTokenInfo>>> =
    OnceLock::new();

/// Get the map of unified tokens, loading from JSON if not already loaded
pub fn get_tokens_map() -> &'static HashMap<String, UnifiedTokenInfo> {
    TOKENS_MAP_CELL.get_or_init(|| {
        let tokens = load_tokens_from_json().unwrap_or_else(|e| {
            eprintln!("Failed to load tokens from JSON: {}", e);
            vec![]
        });
        tokens
            .into_iter()
            .map(|t| (t.unified_asset_id.to_lowercase(), t))
            .collect()
    })
}

/// Get the map of base tokens by defuseAssetId, loading from JSON if not already loaded
pub fn get_defuse_tokens_map() -> &'static HashMap<String, BaseTokenInfo> {
    DEFUSE_TOKENS_MAP_CELL.get_or_init(|| {
        let tokens = load_tokens_from_json().unwrap_or_else(|e| {
            eprintln!("Failed to load tokens from JSON: {}", e);
            vec![]
        });

        let mut map = HashMap::new();
        for unified_token in tokens {
            for base_token in unified_token.grouped_tokens {
                // or_insert so unified tokens (processed first) take priority
                // over synthetic standalone duplicates (e.g. "AURORA" wins over
                // "AURORA (omni)" when both share the same defuseAssetId).
                map.entry(base_token.defuse_asset_id.clone())
                    .or_insert(base_token);
            }
        }
        map
    })
}

/// Get the map of unified tokens by lowercase symbol, loading from JSON if not already loaded
pub fn get_symbol_tokens_map() -> &'static HashMap<String, UnifiedTokenInfo> {
    SYMBOL_TOKENS_MAP_CELL.get_or_init(|| {
        let tokens = load_tokens_from_json().unwrap_or_else(|e| {
            eprintln!("Failed to load tokens from JSON: {}", e);
            vec![]
        });
        tokens
            .into_iter()
            .map(|t| (t.symbol.to_lowercase(), t))
            .collect()
    })
}

/// Find a token by its lowercase symbol
pub fn find_token_by_symbol(symbol: &str) -> Option<UnifiedTokenInfo> {
    get_symbol_tokens_map().get(&symbol.to_lowercase()).cloned()
}

/// Find a base token by its defuseAssetId (e.g., "nep141:wrap.near" or "nep245:v2_1.omni.hot.tg:137_...")
pub fn find_token_by_defuse_asset_id(defuse_asset_id: &str) -> Option<&'static BaseTokenInfo> {
    get_defuse_tokens_map().get(defuse_asset_id)
}

/// Find all base tokens sharing the same defuseAssetId.
pub fn find_tokens_by_defuse_asset_id(defuse_asset_id: &str) -> Vec<&'static BaseTokenInfo> {
    get_defuse_tokens_multi_map()
        .get(defuse_asset_id)
        .map(|v| v.iter().collect())
        .unwrap_or_default()
}

/// Find the best base token for a defuseAssetId by matching deployment address.
///
/// If multiple entries share a defuseAssetId, this uses deployment addresses to disambiguate.
/// Falls back to the first entry when no address matches.
pub fn find_token_by_defuse_asset_id_and_address(
    defuse_asset_id: &str,
    address_candidates: &[String],
) -> Option<&'static BaseTokenInfo> {
    let tokens = get_defuse_tokens_multi_map().get(defuse_asset_id)?;
    if tokens.is_empty() {
        return None;
    }
    if address_candidates.is_empty() {
        return tokens.first();
    }

    for token in tokens {
        for deployment in &token.deployments {
            if let TokenDeployment::Fungible { address, .. } = deployment
                && address_candidates
                    .iter()
                    .any(|candidate| candidate.eq_ignore_ascii_case(address))
            {
                return Some(token);
            }
        }
    }

    tokens.first()
}

/// Get the map of defuse_asset_id -> unified_asset_id for reverse lookup
pub fn get_defuse_to_unified_map() -> &'static HashMap<String, String> {
    DEFUSE_TO_UNIFIED_MAP_CELL.get_or_init(|| {
        let tokens = load_tokens_from_json().unwrap_or_else(|e| {
            eprintln!("Failed to load tokens from JSON: {}", e);
            vec![]
        });

        let mut map = HashMap::new();
        for unified_token in tokens {
            for base_token in &unified_token.grouped_tokens {
                // or_insert so unified tokens (processed first) take priority
                // over synthetic entries from standalone base tokens
                map.entry(base_token.defuse_asset_id.clone())
                    .or_insert_with(|| unified_token.unified_asset_id.clone());
            }
        }
        map
    })
}

/// Get the multimap of defuseAssetId -> all matching base tokens.
pub fn get_defuse_tokens_multi_map() -> &'static HashMap<String, Vec<BaseTokenInfo>> {
    DEFUSE_TOKENS_MULTI_MAP_CELL.get_or_init(|| {
        let tokens = load_tokens_from_json().unwrap_or_else(|e| {
            eprintln!("Failed to load tokens from JSON: {}", e);
            vec![]
        });

        let mut map: HashMap<String, Vec<BaseTokenInfo>> = HashMap::new();
        for unified_token in tokens {
            for base_token in unified_token.grouped_tokens {
                map.entry(base_token.defuse_asset_id.clone())
                    .or_default()
                    .push(base_token);
            }
        }
        map
    })
}

/// Find the unified_asset_id for a given defuse_asset_id
pub fn find_unified_asset_id(defuse_asset_id: &str) -> Option<&'static str> {
    get_defuse_to_unified_map()
        .get(defuse_asset_id)
        .map(|s| s.as_str())
}

/// Load tokens from the vendored near.com catalog (`nearcom-tokens.json`).
/// Unified tokens are processed first so they take priority over standalone base tokens
/// that share the same defuse_asset_id.
fn load_tokens_from_json() -> Result<Vec<UnifiedTokenInfo>, Box<dyn std::error::Error>> {
    let json_str = include_str!("../../data/nearcom-tokens.json");
    let tokens_json: TokensJson = serde_json::from_str(json_str)?;

    let mut unified_tokens = Vec::new();
    let mut base_tokens = Vec::new();

    for token_info in tokens_json.tokens {
        match token_info {
            TokenInfo::Unified(unified) => unified_tokens.push(unified),
            TokenInfo::Base(base) => base_tokens.push(base),
        }
    }

    // Unified tokens first so their defuse_asset_id mappings take priority
    let mut result: Vec<UnifiedTokenInfo> = unified_tokens;

    for base in base_tokens {
        let unified = UnifiedTokenInfo {
            unified_asset_id: base.symbol.to_lowercase(),
            symbol: base.symbol.clone(),
            name: base.name.clone(),
            icon: base.icon.clone(),
            tags: base.tags.clone(),
            grouped_tokens: vec![base],
        };
        result.push(unified);
    }

    Ok(result)
}

/// Lowercased catalog keys that identify a stablecoin: defuse ids, bare
/// NEP-141 contracts (native NEAR USDC/USDT), and on-chain deployment
/// addresses used by `1cs_v1:` destination ids.
static STABLECOIN_KEYS_CELL: OnceLock<HashSet<String>> = OnceLock::new();

fn stablecoin_lookup_keys() -> &'static HashSet<String> {
    STABLECOIN_KEYS_CELL.get_or_init(|| {
        let mut keys = HashSet::new();
        for unified in get_tokens_map().values() {
            let unified_stable = unified.tags.as_deref().is_some_and(is_stablecoin);
            for base in &unified.grouped_tokens {
                if !unified_stable && !base.tags.as_deref().is_some_and(is_stablecoin) {
                    continue;
                }
                insert_stablecoin_asset_keys(&mut keys, &base.defuse_asset_id);
                for deployment in &base.deployments {
                    if let TokenDeployment::Fungible { address, .. } = deployment {
                        keys.insert(address.to_ascii_lowercase());
                    }
                }
            }
        }
        keys
    })
}

fn insert_stablecoin_asset_keys(keys: &mut HashSet<String>, defuse_asset_id: &str) {
    let lower = defuse_asset_id.to_ascii_lowercase();
    keys.insert(lower.clone());
    if let Some(rest) = lower.strip_prefix("nep141:") {
        keys.insert(rest.to_string());
    } else if let Some(rest) = lower.strip_prefix("nep245:") {
        keys.insert(rest.to_string());
    }
}

fn normalize_quote_asset_id(asset_id: &str) -> String {
    let trimmed = asset_id.trim();
    if let Some(stripped) = trimmed.strip_prefix("intents.near:") {
        return normalize_quote_asset_id(stripped);
    }
    trimmed.to_ascii_lowercase()
}

/// True when a 1Click / Intents / native-NEAR asset id is a catalog stablecoin.
///
/// Native NEAR USDC (`17208628…`) and USDT (`usdt.tether-token.near`) match
/// the same catalog row as their `nep141:` Intents ids.
pub fn is_stablecoin_asset(asset_id: &str) -> bool {
    let keys = stablecoin_lookup_keys();
    let normalized = normalize_quote_asset_id(asset_id);
    if keys.contains(&normalized) {
        return true;
    }
    if let Some(addr) = normalized.rsplit(':').next()
        && !addr.is_empty()
        && keys.contains(addr)
    {
        return true;
    }
    false
}

/// Skip the 1Click app fee when both legs are catalog stablecoins (USDC→USDT,
/// native NEAR USDC→ETH USDC, etc.). Payments and same-asset quotes already
/// skip independently.
pub fn is_stablecoin_to_stablecoin(origin_asset: &str, destination_asset: &str) -> bool {
    is_stablecoin_asset(origin_asset) && is_stablecoin_asset(destination_asset)
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC_NEAR: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
    const USDC_NEAR_NEP141: &str =
        "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
    const USDT_NEAR: &str = "usdt.tether-token.near";
    const USDT_NEAR_NEP141: &str = "nep141:usdt.tether-token.near";
    const ETH_USDC_1CS: &str = "1cs_v1:eth:erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const ETH_USDC_OMFT: &str = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";

    #[test]
    fn native_near_usdc_matches_with_or_without_nep141() {
        assert!(is_stablecoin_asset(USDC_NEAR), "bare native USDC");
        assert!(is_stablecoin_asset(USDC_NEAR_NEP141), "intents USDC");
        assert!(
            is_stablecoin_asset(&format!("intents.near:{USDC_NEAR_NEP141}")),
            "prefixed intents USDC"
        );
    }

    #[test]
    fn native_near_usdt_matches_with_or_without_nep141() {
        assert!(is_stablecoin_asset(USDT_NEAR), "bare native USDT");
        assert!(is_stablecoin_asset(USDT_NEAR_NEP141), "intents USDT");
    }

    #[test]
    fn cross_chain_usdc_ids_are_stablecoins() {
        assert!(is_stablecoin_asset(ETH_USDC_1CS), "1cs ETH USDC");
        assert!(is_stablecoin_asset(ETH_USDC_OMFT), "omft ETH USDC");
    }

    #[test]
    fn wrap_near_is_not_a_stablecoin() {
        assert!(!is_stablecoin_asset("nep141:wrap.near"));
        assert!(!is_stablecoin_asset("wrap.near"));
        assert!(!is_stablecoin_asset("near"));
    }

    #[test]
    fn both_legs_stable_skips_fee() {
        assert!(is_stablecoin_to_stablecoin(USDC_NEAR, ETH_USDC_1CS));
        assert!(is_stablecoin_to_stablecoin(USDC_NEAR_NEP141, USDT_NEAR));
        assert!(!is_stablecoin_to_stablecoin(
            "nep141:wrap.near",
            USDT_NEAR_NEP141
        ));
        assert!(!is_stablecoin_to_stablecoin(
            USDC_NEAR_NEP141,
            "nep141:wrap.near"
        ));
    }
}

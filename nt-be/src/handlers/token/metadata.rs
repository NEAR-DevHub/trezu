use std::{collections::HashMap, sync::Arc};

use axum::{
    Json,
    extract::{Query, State},
};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    AppState,
    constants::{
        NEAR_ICON, WRAP_NEAR_ICON,
        intents_chains::{ChainIcons, get_chain_metadata_by_name},
        intents_tokens::find_token_by_defuse_asset_id,
    },
    handlers::proposals::scraper::fetch_ft_metadata,
    handlers::proxy::external::fetch_proxy_api,
    utils::cache::{Cache, CacheKey, CacheTier},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenMetadataQuery {
    pub token_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenMetadata {
    pub token_id: String,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_icons: Option<ChainIcons>,
}

impl TokenMetadata {
    /// Creates NEAR token metadata with consistent values across the codebase.
    ///
    /// # Arguments
    /// * `price` - Optional USD price for NEAR
    /// * `price_updated_at` - Optional timestamp when price was updated
    ///
    /// # Returns
    /// TokenMetadata with standardized NEAR token information
    pub fn create_near_metadata(price: Option<f64>, price_updated_at: Option<String>) -> Self {
        Self {
            token_id: "near".to_string(),
            name: "NEAR".to_string(),
            symbol: "NEAR".to_string(),
            decimals: 24,
            icon: Some(NEAR_ICON.to_string()),
            price,
            price_updated_at,
            network: Some("near".to_string()),
            chain_name: Some("Near Protocol".to_string()),
            chain_icons: get_chain_metadata_by_name("near").map(|m| m.icon),
        }
    }

    /// Creates wrap.near (Wrapped NEAR) token metadata with consistent values.
    ///
    /// # Arguments
    /// * `price` - Optional USD price for wrap.near (typically same as NEAR)
    /// * `price_updated_at` - Optional timestamp when price was updated
    ///
    /// # Returns
    /// TokenMetadata with standardized wrap.near token information
    pub fn create_wrap_near_metadata(price: Option<f64>, price_updated_at: Option<String>) -> Self {
        Self {
            token_id: "wrap.near".to_string(),
            name: "Wrapped NEAR fungible token".to_string(),
            symbol: "NEAR".to_string(),
            decimals: 24,
            icon: Some(WRAP_NEAR_ICON.to_string()),
            price,
            price_updated_at,
            network: Some("near".to_string()),
            chain_name: Some("Near Protocol".to_string()),
            chain_icons: get_chain_metadata_by_name("near").map(|m| m.icon),
        }
    }
}

/// This is the response from the Ref SDK API.
///
/// Sometimes it contains both camelCase and snake_case fields or only one of them.
/// We need to handle both cases. :)
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RefSdkToken {
    pub defuse_asset_id: Option<String>,
    #[serde(rename = "defuse_asset_id")]
    pub defuse_asset_id_snake_case: Option<String>,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub decimals: Option<u8>,
    pub icon: Option<String>,
    pub price: Option<f64>,
    pub price_updated_at: Option<String>,
    #[serde(rename = "price_updated_at")]
    pub price_updated_at_snake_case: Option<String>,
    pub chain_name: Option<String>,
    pub chain_name_snake_case: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NearBlocksTokenResponse {
    tokens: Vec<NearBlocksToken>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct NearBlocksToken {
    contract: String,
    name: String,
    symbol: String,
    decimals: u8,
    icon: Option<String>,
    reference: Option<String>,
    price: Option<String>,
    total_supply: Option<String>,
    onchain_market_cap: Option<String>,
    change_24: Option<String>,
    market_cap: Option<String>,
    volume_24h: Option<String>,
}

/// Fetches token metadata from Ref SDK API by defuse asset IDs
///
/// # Arguments
/// * `state` - Application state containing HTTP client and cache
/// * `defuse_asset_ids` - List of defuse asset IDs to fetch (supports batch)
///
/// # Returns
/// * `Ok(Vec<TokenMetadata>)` - List of token metadata with chain information
/// * `Err((StatusCode, String))` - Error with status code and message
pub async fn fetch_tokens_metadata(
    state: &Arc<AppState>,
    defuse_asset_ids: &[String],
) -> Result<Vec<TokenMetadata>, (StatusCode, String)> {
    if defuse_asset_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Join asset IDs with commas for batch request
    let mut sorted_ids = defuse_asset_ids.to_vec();
    sorted_ids.sort();
    let asset_ids_param = sorted_ids.join(",");

    // Prepare query parameters for the Ref SDK API
    let mut query_params = HashMap::new();
    query_params.insert("defuseAssetId".to_string(), asset_ids_param.clone());

    let cache_key = CacheKey::new("ref-tokens-metadata")
        .with(&asset_ids_param)
        .build();

    let state_clone = state.clone();
    let response = state
        .cache
        .cached(CacheTier::LongTerm, cache_key, async move {
            // Fetch token data from Ref SDK API
            fetch_proxy_api(
                &state_clone.http_client,
                &state_clone.env_vars.ref_sdk_base_url,
                "token-by-defuse-asset-id",
                &query_params,
            )
            .await
        })
        .await?;

    // Parse as array of objects first
    let tokens: Vec<RefSdkToken> = serde_json::from_value(response).map_err(|e| {
        eprintln!("Failed to parse token response: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to parse token metadata response".to_string(),
        )
    })?;

    // Map RefSdkToken to TokenMetadata with chain metadata, using fallback for errors
    let mut metadata_responses: Vec<TokenMetadata> = Vec::new();

    for (idx, token) in tokens.iter().enumerate() {
        // Handle error entries with fallback
        if token.error.is_some() {
            eprintln!("Token has error, trying fallback: {:?}", token.error);

            // Get the original token ID from input to use for fallback
            if let Some(original_id) = defuse_asset_ids.get(idx) {
                // Extract the contract ID from defuse asset ID (format: "nep141:contract.near")
                let contract_id = original_id.split(':').nth(1).unwrap_or(original_id);

                if let Ok(account_id) = contract_id.parse::<near_api::AccountId>() {
                    match fetch_ft_metadata(&state.cache, &state.network, &account_id).await {
                        Ok(ft_metadata) => {
                            metadata_responses.push(TokenMetadata {
                                token_id: original_id.clone(),
                                name: ft_metadata.name,
                                symbol: ft_metadata.symbol,
                                decimals: ft_metadata.decimals,
                                icon: ft_metadata.icon,
                                price: None,
                                price_updated_at: None,
                                network: Some("near".to_string()),
                                chain_name: Some("Near Protocol".to_string()),
                                chain_icons: get_chain_metadata_by_name("near").map(|m| m.icon),
                            });
                            continue;
                        }
                        Err(e) => {
                            eprintln!(
                                "Fallback fetch_ft_metadata failed for {}: {:?}",
                                contract_id, e
                            );
                            continue;
                        }
                    }
                }
            }
            continue;
        }

        // Skip if missing required fields
        let Some(token_id) = token
            .defuse_asset_id
            .as_ref()
            .or(token.defuse_asset_id_snake_case.as_ref())
        else {
            continue;
        };
        let Some(name) = token.name.as_ref() else {
            continue;
        };
        let Some(symbol) = token.symbol.as_ref() else {
            continue;
        };
        let Some(decimals) = token.decimals else {
            continue;
        };
        let Some(chain_name_str) = token
            .chain_name
            .as_ref()
            .or(token.chain_name_snake_case.as_ref())
        else {
            continue;
        };

        let chain_metadata = get_chain_metadata_by_name(chain_name_str);
        let chain_name = chain_metadata.as_ref().map(|m| m.name.clone());
        let chain_icons = chain_metadata.map(|m| m.icon);

        // Special handling for wrap.near - if metadata is incomplete, use complete fallback
        // Check both "nep141:wrap.near" and "wrap.near" (Ref SDK can return either)
        let is_wrap_near = token_id == "wrap.near";
        if is_wrap_near && (token.icon.is_none() || token.price.is_none() || chain_icons.is_none())
        {
            eprintln!(
                "[Metadata] 🔧 {} has incomplete metadata from Ref SDK, using complete fallback",
                token_id
            );
            // Use the complete wrap.near metadata with all fields populated
            let wrap_near_meta = TokenMetadata::create_wrap_near_metadata(
                token.price,
                token
                    .price_updated_at
                    .as_ref()
                    .or(token.price_updated_at_snake_case.as_ref())
                    .cloned(),
            );
            metadata_responses.push(wrap_near_meta);
        } else {
            // Provide fallback icon: wrap.near → WRAP_NEAR_ICON, others → tokens.json static data
            let icon = if is_wrap_near && token.icon.is_none() {
                Some(WRAP_NEAR_ICON.to_string())
            } else if token.icon.is_none() {
                find_token_by_defuse_asset_id(token_id).map(|t| t.icon.clone())
            } else {
                token.icon.clone()
            };

            metadata_responses.push(TokenMetadata {
                token_id: token_id.clone(),
                name: name.clone(),
                symbol: symbol.clone(),
                decimals,
                icon,
                price: token.price,
                price_updated_at: token
                    .price_updated_at
                    .as_ref()
                    .or(token.price_updated_at_snake_case.as_ref())
                    .cloned(),
                network: Some(chain_name_str.clone()),
                chain_name,
                chain_icons,
            });
        }
    }

    Ok(metadata_responses)
}

/// Fetches FT metadata from NearBlocks API
///
/// # Arguments
/// * `cache` - Application cache
/// * `http_client` - HTTP client for making requests
/// * `nearblocks_api_key` - API key for NearBlocks
/// * `token_id` - Token contract ID (e.g., "wrap.near", "usdt.tether-token.near")
///
/// # Returns
/// * `Ok(TokenMetadata)` - Token metadata with price information
/// * `Err((StatusCode, String))` - Error with status code and message
async fn fetch_nearblocks_ft_metadata(
    cache: &Cache,
    http_client: &reqwest::Client,
    nearblocks_api_key: &str,
    token_id: &str,
) -> Result<TokenMetadata, (StatusCode, String)> {
    let cache_key = CacheKey::new("nearblocks-ft-metadata")
        .with(token_id.to_string())
        .build();

    // Clone needed values for the async block
    let http_client = http_client.clone();
    let nearblocks_api_key = nearblocks_api_key.to_string();
    let token_id_str = token_id.to_string();

    let result = cache
        .cached_json(CacheTier::LongTerm, cache_key, async move {
            // For "near" token, search for wrap.near to get price
            let search_query = if token_id_str == "near" {
                "wrap.near"
            } else {
                &token_id_str
            };

            let url = format!("https://api.nearblocks.io/v1/fts/?search={}", search_query);

            let response = http_client
                .get(&url)
                .header("accept", "application/json")
                .header("Authorization", format!("Bearer {}", nearblocks_api_key))
                .send()
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to fetch from NearBlocks: {}", e),
                    )
                })?;

            if !response.status().is_success() {
                return Err((
                    StatusCode::from_u16(response.status().as_u16())
                        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                    format!("NearBlocks API error: {}", response.status()),
                ));
            }

            let data: NearBlocksTokenResponse = response.json().await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to parse NearBlocks response: {}", e),
                )
            })?;

            let token = data.tokens.into_iter().next().ok_or((
                StatusCode::NOT_FOUND,
                "No token found in NearBlocks response".to_string(),
            ))?;

            let price = token.price.as_ref().and_then(|p| p.parse::<f64>().ok());

            // If searching for "near", return NEAR metadata with wrap.near's price
            let metadata = if token_id_str == "near" || token_id_str == "wrap.near" {
                TokenMetadata::create_near_metadata(
                    price,
                    price.map(|_| chrono::Utc::now().to_rfc3339()),
                )
            } else {
                TokenMetadata {
                    token_id: token_id_str.clone(),
                    name: token.name,
                    symbol: token.symbol,
                    decimals: token.decimals,
                    icon: token.icon,
                    price,
                    price_updated_at: price.map(|_| chrono::Utc::now().to_rfc3339()),
                    network: Some("near".to_string()),
                    chain_name: Some("Near Protocol".to_string()),
                    chain_icons: get_chain_metadata_by_name("near").map(|m| m.icon),
                }
            };

            Ok(metadata)
        })
        .await;

    match result {
        Ok((_status, json)) => {
            // Deserialize from Json<Value> to TokenMetadata
            serde_json::from_value(json.0).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to deserialize token metadata: {}", e),
                )
            })
        }
        Err((_cache_err, err_string)) => Err((StatusCode::INTERNAL_SERVER_ERROR, err_string)),
    }
}

/// Fetch token metadata from counterparties table (cached in database)
///
/// This is the fast path for fetching metadata - it queries the local database
/// instead of making external API calls. Returns only metadata for tokens
/// that exist in the counterparties table.
///
/// Special handling: "near" → looks up "wrap.near" but returns token_id="near"
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `token_ids` - List of token IDs to fetch
///
/// # Returns
/// * `HashMap<String, TokenMetadata>` - Map of found tokens (may be incomplete)
pub async fn fetch_metadata_from_counterparties(
    pool: &PgPool,
    token_ids: &[String],
) -> HashMap<String, TokenMetadata> {
    if token_ids.is_empty() {
        return HashMap::new();
    }

    // Create mapping: original_token_id -> db_lookup_id
    // For "near", we need to look up "wrap.near" in the database
    let mut token_id_mapping: HashMap<String, String> = HashMap::new();
    let mut db_lookup_ids: Vec<String> = Vec::new();

    for token_id in token_ids {
        let lookup_id = if token_id == "near" {
            "wrap.near".to_string()
        } else {
            token_id.clone()
        };
        token_id_mapping.insert(lookup_id.clone(), token_id.clone());
        db_lookup_ids.push(lookup_id);
    }

    let rows = match sqlx::query!(
        r#"
        SELECT 
            account_id,
            token_symbol,
            token_name,
            token_decimals,
            token_icon
        FROM counterparties
        WHERE account_id = ANY($1)
          AND account_type = 'ft_token'
          AND token_symbol IS NOT NULL
        "#,
        &db_lookup_ids
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("Failed to fetch metadata from counterparties: {}", e);
            return HashMap::new();
        }
    };

    rows.into_iter()
        .filter_map(|row| {
            let db_token_id = row.account_id;

            // Map back: wrap.near → near (if that's what was requested)
            let original_token_id = token_id_mapping
                .get(&db_token_id)
                .cloned()
                .unwrap_or_else(|| db_token_id.clone());

            let symbol = row.token_symbol?;
            let name = row.token_name.unwrap_or_else(|| symbol.clone());
            let decimals = row.token_decimals.map(|d| d as u8).unwrap_or(24);

            // Special case: Override metadata for native NEAR
            if original_token_id == "near" {
                return Some((
                    original_token_id.clone(),
                    TokenMetadata::create_near_metadata(None, None),
                ));
            }

            Some((
                original_token_id.clone(),
                TokenMetadata {
                    token_id: original_token_id, // Use the original requested ID (e.g., "near" not "wrap.near")
                    name,
                    symbol,
                    decimals,
                    icon: row.token_icon,
                    price: None, // Prices fetched separately
                    price_updated_at: None,
                    network: None,
                    chain_name: None,
                    chain_icons: None,
                },
            ))
        })
        .collect()
}

/// Fetches token metadata with automatic fallback strategy
///
/// This function handles both defuse asset IDs (prefixed with "nep141:", "intents.near:")
/// and regular NEAR FT contract IDs. It uses multiple sources in order:
/// 1. **Counterparties table** (fastest, cached in DB)
/// 2. Defuse API for tokens with prefixes (for missing tokens only)
/// 3. NearBlocks API for regular FT contracts (for missing tokens only)
/// 4. Generic fallback if all fail
///
/// # Arguments
/// * `state` - Application state
/// * `token_ids` - List of token IDs (can be mixed defuse IDs and FT contract IDs)
///
/// # Returns
/// * `HashMap<String, TokenMetadata>` - Map of token ID to metadata
pub async fn fetch_tokens_with_fallback(
    state: &Arc<AppState>,
    token_ids: &[String],
    include_chain_metadata: bool,
) -> HashMap<String, TokenMetadata> {
    if token_ids.is_empty() {
        return HashMap::new();
    }

    // Remove duplicates using HashSet
    let unique_tokens: std::collections::HashSet<String> = token_ids.iter().cloned().collect();
    let token_ids_vec: Vec<String> = unique_tokens.iter().cloned().collect();

    let mut result: HashMap<String, TokenMetadata>;
    let missing_tokens: Vec<String>;

    // If chain metadata is required, skip counterparties table because it doesn't have chain data
    if include_chain_metadata {
        log::debug!(
            "Chain metadata requested, skipping counterparties and fetching {} tokens from API",
            token_ids_vec.len()
        );
        result = HashMap::new();
        missing_tokens = token_ids_vec.clone();
    } else {
        // Step 1: Check counterparties table first (fast path!)
        log::debug!(
            "Fetching metadata for {} tokens, checking counterparties first",
            token_ids_vec.len()
        );
        result = fetch_metadata_from_counterparties(&state.db_pool, &token_ids_vec).await;

        log::debug!("Found {} tokens in counterparties table", result.len());

        // Step 2: Identify missing tokens that need API fetching
        missing_tokens = unique_tokens
            .iter()
            .filter(|id| !result.contains_key(*id))
            .cloned()
            .collect();

        if missing_tokens.is_empty() {
            log::debug!("All tokens found in counterparties, no API calls needed");
            return result;
        }
    }

    log::debug!(
        "Need to fetch {} tokens from APIs: {:?}",
        missing_tokens.len(),
        missing_tokens
    );

    // Step 3: Separate missing tokens by source
    // Tokens with prefixes (intents.near:, nep141:) - fetch from Defuse API
    // Regular token contract IDs - fetch from NearBlocks API
    let mut api_tokens = Vec::new();
    let mut direct_tokens = Vec::new();

    for token_id in &missing_tokens {
        if token_id == "near"
            || token_id.starts_with("intents.near:")
            || token_id.starts_with("nep141:")
            || token_id.starts_with("nep245:")
        {
            api_tokens.push(token_id.clone());
        } else {
            direct_tokens.push(token_id.clone());
        }
    }

    // Step 4: Fetch missing tokens from appropriate APIs
    if !api_tokens.is_empty() {
        let transform_to_defuse = |token_id: &str| -> String {
            if token_id == "near" {
                "nep141:wrap.near".to_string()
            } else if let Some(stripped) = token_id.strip_prefix("intents.near:") {
                stripped.to_string()
            } else if token_id.starts_with("nep141:") || token_id.starts_with("nep245:") {
                token_id.to_string()
            } else {
                format!("nep141:{}", token_id)
            }
        };

        let defuse_ids: Vec<String> = api_tokens
            .iter()
            .map(|id| transform_to_defuse(id))
            .collect();

        match fetch_tokens_metadata(state, &defuse_ids).await {
            Ok(metadata_from_api) => {
                let metadata_map: HashMap<String, TokenMetadata> = metadata_from_api
                    .into_iter()
                    .map(|meta| (meta.token_id.clone(), meta))
                    .collect();

                for token_id in &api_tokens {
                    let lookup_key = transform_to_defuse(token_id);
                    if let Some(meta) = metadata_map.get(&lookup_key) {
                        // Special case: If this is "near", we fetched wrap.near's metadata
                        if token_id == "near" {
                            result.insert(
                                token_id.clone(),
                                TokenMetadata::create_near_metadata(
                                    meta.price,
                                    meta.price_updated_at.clone(),
                                ),
                            );
                        } else {
                            result.insert(token_id.clone(), meta.clone());
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to fetch metadata from Defuse API: {:?}", e);
            }
        }
    }

    // Fetch regular FT contracts from NearBlocks API
    if !direct_tokens.is_empty() {
        if let Some(nearblocks_api_key) = state.env_vars.nearblocks_api_key.as_ref() {
            for token_id in &direct_tokens {
                match fetch_nearblocks_ft_metadata(
                    &state.cache,
                    &state.http_client,
                    nearblocks_api_key,
                    token_id,
                )
                .await
                {
                    Ok(metadata) => {
                        result.insert(token_id.clone(), metadata);
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to fetch metadata from NearBlocks for {}: {:?}, using fallback",
                            token_id,
                            e
                        );
                        // Use generic fallback
                        let symbol = token_id
                            .split('.')
                            .next()
                            .unwrap_or(token_id)
                            .to_uppercase();
                        result.insert(
                            token_id.clone(),
                            TokenMetadata {
                                token_id: token_id.to_string(),
                                name: symbol.clone(),
                                symbol,
                                decimals: 18,
                                icon: None,
                                price: None,
                                price_updated_at: None,
                                network: Some("near".to_string()),
                                chain_name: Some("Near Protocol".to_string()),
                                chain_icons: get_chain_metadata_by_name("near").map(|m| m.icon),
                            },
                        );
                    }
                }
            }
        } else {
            // No NearBlocks API key, use generic fallback for all direct tokens
            for token_id in &direct_tokens {
                let symbol = token_id
                    .split('.')
                    .next()
                    .unwrap_or(token_id)
                    .to_uppercase();
                result.insert(
                    token_id.clone(),
                    TokenMetadata {
                        token_id: token_id.to_string(),
                        name: symbol.clone(),
                        symbol,
                        decimals: 18,
                        icon: None,
                        price: None,
                        price_updated_at: None,
                        network: Some("near".to_string()),
                        chain_name: Some("Near Protocol".to_string()),
                        chain_icons: get_chain_metadata_by_name("near").map(|m| m.icon),
                    },
                );
            }
        }
    }

    // Step 5: Final fallback: For any token that STILL doesn't have metadata, add generic fallback
    for token_id in &unique_tokens {
        if !result.contains_key(token_id) {
            let symbol = token_id
                .split('.')
                .next()
                .unwrap_or(token_id)
                .to_uppercase();
            result.insert(
                token_id.clone(),
                TokenMetadata {
                    token_id: token_id.to_string(),
                    name: symbol.clone(),
                    symbol,
                    decimals: 18,
                    icon: None,
                    price: None,
                    price_updated_at: None,
                    network: Some("near".to_string()),
                    chain_name: Some("Near Protocol".to_string()),
                    chain_icons: get_chain_metadata_by_name("near").map(|m| m.icon),
                },
            );
        }
    }

    result
}

/// Like [`fetch_tokens_with_fallback`] but also enriches every result with live prices from the
/// Defuse / Ref SDK API.
///
/// `fetch_tokens_with_fallback` uses the counterparties table as a fast path which never carries
/// price information. This wrapper runs the same metadata resolution and then makes a **single**
/// batch call to `fetch_tokens_metadata` (Defuse/Ref SDK) to attach `price` and
/// `price_updated_at` to every token that supports it.
///
/// Tokens that the Defuse API does not know about keep `price: None` (same behavior as before).
///
/// # Arguments
/// * `state` - Application state
/// * `token_ids` - List of token IDs (can be mixed defuse IDs and FT contract IDs)
///
/// # Returns
/// * `HashMap<String, TokenMetadata>` - Map of token ID to metadata with prices attached
pub async fn fetch_tokens_with_defuse_extension(
    state: &Arc<AppState>,
    token_ids: &[String],
) -> HashMap<String, TokenMetadata> {
    let mut result = fetch_tokens_with_fallback(state, token_ids, false).await;

    if result.is_empty() {
        return result;
    }

    // Build defuse asset IDs for all tokens so we can fetch prices in one batch.
    // Mapping: defuse_id -> original token_id (so we can put the price back).
    let transform_to_defuse = |token_id: &str| -> String {
        if token_id == "near" {
            "nep141:wrap.near".to_string()
        } else if let Some(stripped) = token_id.strip_prefix("intents.near:") {
            stripped.to_string()
        } else if token_id.starts_with("nep141:") || token_id.starts_with("nep245:") {
            token_id.to_string()
        } else {
            format!("nep141:{}", token_id)
        }
    };

    // Build reverse map: defuse_id -> all original token IDs.
    // Multiple aliases can map to the same defuse asset ID (e.g. bare ID and intents.near: prefixed ID),
    // and all of them should receive enrichment.
    let mut defuse_to_originals: HashMap<String, Vec<String>> = HashMap::new();
    for id in result.keys() {
        let defuse_id = transform_to_defuse(id);
        defuse_to_originals
            .entry(defuse_id)
            .or_default()
            .push(id.clone());
    }
    let defuse_ids: Vec<String> = defuse_to_originals.keys().cloned().collect();

    // Pre-fetch latest DB prices for all tokens (single query) as fallback
    let all_token_ids: Vec<String> = result.keys().cloned().collect();
    let db_prices = state
        .price_service
        .get_cached_tokens_latest_price(&all_token_ids)
        .await
        .unwrap_or_default();

    match fetch_tokens_metadata(state, &defuse_ids).await {
        Ok(price_metadata) => {
            for meta in price_metadata {
                if let Some(original_ids) = defuse_to_originals.get(&meta.token_id) {
                    for original_id in original_ids {
                        if let Some(entry) = result.get_mut(original_id) {
                            // Enrich chain fields even when Defuse has no price for the token.
                            // This fixes counterparties-sourced rows that carry network/chain as None.
                            if meta.network.is_some() {
                                entry.network = meta.network.clone();
                            }
                            if meta.chain_name.is_some() {
                                entry.chain_name = meta.chain_name.clone();
                            }
                            if meta.chain_icons.is_some() {
                                entry.chain_icons = meta.chain_icons.clone();
                            }

                            if let Some(price) = meta.price
                                && price > 0f64
                            {
                                entry.price = meta.price;
                                entry.price_updated_at = meta.price_updated_at.clone();
                            } else if let Some(&db_price) = db_prices.get(original_id)
                                && db_price > 0.0
                            {
                                entry.price = Some(db_price);
                            }
                        }
                    }
                }
            }
        }
        Err(e) => {
            log::warn!("fetch_tokens_with_prices: price enrichment failed: {:?}", e);
            // Defuse failed entirely — fall back to DB prices for all tokens
            for (token_id, &price) in &db_prices {
                if price > 0.0
                    && let Some(entry) = result.get_mut(token_id)
                    && entry.price.is_none()
                {
                    entry.price = Some(price);
                }
            }
        }
    }

    result
}

pub async fn get_token_metadata(
    State(state): State<Arc<AppState>>,
    Query(mut params): Query<TokenMetadataQuery>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, String)> {
    let cache_key = format!("token-metadata:{}", params.token_id);
    let state_clone = state.clone();

    state
        .cache
        .cached_json(CacheTier::LongTerm, cache_key, async move {
            let is_near =
                params.token_id.eq_ignore_ascii_case("near") || params.token_id.is_empty();
            if is_near {
                params.token_id = "near".to_string();
            } else {
                params.token_id = format!("intents.near:{}", params.token_id);
            }

            // Fetch token metadata using the reusable function
            let tokens =
                fetch_tokens_with_defuse_extension(&state_clone, &[params.token_id.clone()]).await;

            let wrap_metadata = tokens.get(&params.token_id).ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    format!("Token not found: {}", params.token_id),
                )
            })?;

            let metadata = if is_near {
                // Use helper to create NEAR metadata with wrap.near's price and icon
                TokenMetadata::create_near_metadata(
                    wrap_metadata.price,
                    wrap_metadata.price_updated_at.clone(),
                )
            } else {
                wrap_metadata.clone()
            };

            Ok::<_, (StatusCode, String)>(metadata)
        })
        .await
}

/// NearBlocks FT search response
#[derive(Deserialize, Debug)]
struct NearBlocksSearchResponse {
    tokens: Vec<NearBlocksToken>,
}

/// Search for FT token contract addresses by symbol using NearBlocks API
///
/// Returns a list of token contract addresses that exactly match the symbol (case-insensitive)
/// sorted by onchain_market_cap (descending).
///
/// **Important:** This function filters to EXACT symbol matches only, excluding tokens with
/// the same symbol on different networks/chains. For example, searching for "USDC" returns only:
/// - eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near (USDC on Ethereum)
/// - base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near (USDC on Base)
/// - arbitrum-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near (USDC on Arbitrum)
///
/// All of these are returned because they all have the exact symbol "USDC". This allows the
/// caller to decide whether to use all versions or filter further. The results are sorted by
/// onchain_market_cap (descending), so the most liquid version appears first.
///
/// **Special case for "NEAR" and "WNEAR":** When searching for "NEAR" or "WNEAR", the function
/// returns hardcoded values `["wrap.near", "near"]` without making an API call, since native NEAR
/// is not an FT token and these are the canonical NEAR token addresses. Both symbols refer to the
/// same underlying tokens.
pub async fn search_token_by_symbol(
    state: &Arc<AppState>,
    symbol: &str,
) -> Result<Vec<String>, (StatusCode, String)> {
    let symbol_upper = symbol.to_uppercase();

    // Special case for NEAR
    if symbol_upper == "NEAR" || symbol_upper == "WNEAR" {
        return Ok(vec!["wrap.near".to_string(), "near".to_string()]);
    }

    // Step 1: Check counterparties table first (fast path, no API call)
    let db_results = match sqlx::query!(
        r#"
        SELECT account_id
        FROM counterparties
        WHERE UPPER(token_symbol) = UPPER($1)
          AND account_type = 'ft_token'
        ORDER BY discovered_at DESC
        "#,
        symbol
    )
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(rows) => rows.into_iter().map(|r| r.account_id).collect::<Vec<_>>(),
        Err(e) => {
            log::warn!(
                "Failed to search counterparties table for {}: {}",
                symbol,
                e
            );
            vec![]
        }
    };

    // If found in database, return immediately (skip NearBlocks API)
    if !db_results.is_empty() {
        log::debug!(
            "Found {} tokens in counterparties for symbol '{}': {:?}",
            db_results.len(),
            symbol,
            db_results
        );
        return Ok(db_results);
    }

    // Step 2: Fallback to NearBlocks API only if not in database
    log::debug!(
        "Symbol '{}' not in counterparties, falling back to NearBlocks API",
        symbol
    );

    let cache_key = format!("search-token-{}", symbol.to_lowercase());

    state
        .cache
        .cached(CacheTier::LongTerm, cache_key, async move {
            let url = format!("https://api.nearblocks.io/v1/fts/?search={}", symbol);

            let response = state
                .http_client
                .get(&url)
                .header(
                    "Authorization",
                    format!(
                        "Bearer {}",
                        std::env::var("NEARBLOCKS_API_KEY").unwrap_or_default()
                    ),
                )
                .send()
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to search token: {}", e),
                    )
                })?;

            let search_response: NearBlocksSearchResponse = response.json().await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to parse search response: {}", e),
                )
            })?;

            // Sort tokens: exact match first, then by market cap
            let mut tokens = search_response.tokens;
            let symbol_upper = symbol.to_uppercase();

            // Filter to only exact symbol matches (case-insensitive)
            tokens.retain(|t| t.symbol.to_uppercase() == symbol_upper);

            // Sort filtered tokens by market cap (descending)
            tokens.sort_by(|a, b| {
                let a_cap = a
                    .onchain_market_cap
                    .as_ref()
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let b_cap = b
                    .onchain_market_cap
                    .as_ref()
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0);
                b_cap
                    .partial_cmp(&a_cap)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

            // Return all contract addresses that exactly match the symbol
            let contract_addresses: Vec<String> =
                tokens.iter().map(|t| t.contract.clone()).collect();

            Ok::<_, (StatusCode, String)>(contract_addresses)
        })
        .await
}

//! NEAR Intents Multi-Token Balance Queries
//!
//! Functions to query NEAR Intents multi-token balances at specific block heights via RPC.

use near_api::{Contract, NetworkConfig, Reference};
use sqlx::PgPool;
use std::str::FromStr;

use crate::handlers::balance_changes::counterparty::{
    convert_raw_to_decimal, ensure_ft_metadata, ensure_nep245_token_decimals,
};
use crate::handlers::balance_changes::utils::with_transport_retry;

/// Query NEAR Intents multi-token balance at a specific block height
///
/// Returns an error if the block doesn't exist (UnknownBlock). The caller (binary search)
/// is responsible for skipping non-existing blocks.
///
/// Also ensures FT metadata for the underlying token is cached in the counterparties table.
///
/// # Arguments
/// * `pool` - Database connection pool for storing/retrieving token metadata
/// * `network` - The NEAR network configuration (use archival network for historical queries)
/// * `account_id` - The NEAR account to query
/// * `token_id` - Full token identifier in format "contract:token_id"
/// * `block_height` - The block height to query at
///
/// # Returns
/// The balance as a BigDecimal (for arbitrary precision with proper decimal places)
pub async fn get_balance_at_block(
    pool: &PgPool,
    network: &NetworkConfig,
    account_id: &str,
    token_id: &str,
    block_height: u64,
) -> Result<bigdecimal::BigDecimal, Box<dyn std::error::Error>> {
    // Parse token_id format: "contract:token_id" (split on first colon only)
    // Example: "intents.near:nep141:btc.omft.near" -> contract="intents.near", token="nep141:btc.omft.near"
    let parts: Vec<&str> = token_id.splitn(2, ':').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid Intents token format: {}", token_id).into());
    }
    let (contract_str, token) = (parts[0], parts[1]);

    // Resolve decimals for the token.
    // - intents.near tokens: use the token registry via ensure_ft_metadata (full token_id as key)
    // - Other NEP-245 contracts (e.g. v2_1.omni.hot.tg): query mt_metadata_base_by_token_id
    let decimals = if contract_str == "intents.near" {
        ensure_ft_metadata(pool, network, token_id).await?
    } else {
        ensure_nep245_token_decimals(pool, network, token_id, contract_str, token).await?
    };

    let contract_id = near_api::types::AccountId::from_str(contract_str)?;
    let contract = Contract(contract_id);

    let balance = with_transport_retry("intents_balance", || {
        contract
            .call_function(
                "mt_balance_of",
                serde_json::json!({
                    "account_id": account_id,
                    "token_id": token
                }),
            )
            .read_only()
            .at(Reference::AtBlock(block_height))
            .fetch_from(network)
    })
    .await?;

    let raw_balance: String = balance.data;
    let decimal_balance = convert_raw_to_decimal(&raw_balance, decimals)?;

    Ok(decimal_balance)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::test_utils::init_test_state;

    /// Verifies that balance queries for non-intents.near NEP-245 contracts work end-to-end:
    /// - decimals are fetched via mt_metadata_base_by_token_id (not ft_metadata)
    /// - balance is fetched via mt_balance_of with account_id + token_id parameters
    ///
    /// Token: GNK (GONKA), 9 decimals. Raw balance 4305864173000 / 10^9 = 4305.864173
    #[tokio::test]
    async fn test_query_v2_omni_hot_tg_balance() {
        use bigdecimal::BigDecimal;
        use std::str::FromStr;

        let state = init_test_state().await;

        let balance = get_balance_at_block(
            &state.db_pool,
            &state.archival_network,
            "hot-dao.sputnik-dao.near",
            "v2_1.omni.hot.tg:4444119_wyixUKCL",
            188090254,
        )
        .await
        .unwrap();

        assert_eq!(balance, BigDecimal::from_str("4305.864173").unwrap());
    }
}

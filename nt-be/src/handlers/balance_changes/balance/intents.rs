//! NEAR Intents Multi-Token Balance Queries
//!
//! Functions to query NEAR Intents multi-token balances at specific block heights via RPC.

use near_api::{Contract, NetworkConfig, Reference};
use sqlx::PgPool;
use std::str::FromStr;

use crate::handlers::balance_changes::counterparty::{convert_raw_to_decimal, ensure_ft_metadata};
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
    // Ensure FT metadata is cached for this intents token
    // This will extract the actual FT contract and query its metadata
    let decimals = ensure_ft_metadata(pool, network, token_id).await?;
    // Parse token_id format: "contract:token_id" (split on first colon only)
    // Example: "intents.near:nep141:btc.omft.near" -> contract="intents.near", token="nep141:btc.omft.near"
    let parts: Vec<&str> = token_id.splitn(2, ':').collect();
    if parts.len() != 2 {
        return Err(format!("Invalid Intents token format: {}", token_id).into());
    }
    let (contract_str, token) = (parts[0], parts[1]);

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

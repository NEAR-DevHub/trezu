//! Fungible Token (NEP-141) Balance Queries
//!
//! Functions to query FT token balances at specific block heights via RPC.
//! Returns decimal-adjusted balance values for storage and display.

use near_api::types::json::U128;
use near_api::{AccountId, Contract, NetworkConfig, Reference};
use sqlx::PgPool;
use std::str::FromStr;

use crate::handlers::balance_changes::counterparty::{convert_raw_to_decimal, ensure_ft_metadata};
use crate::handlers::balance_changes::utils::with_transport_retry;

/// Query fungible token balance at a specific block height
///
/// Returns an error if the block doesn't exist (UnknownBlock). The caller (binary search)
/// is responsible for skipping non-existing blocks.
///
/// # Arguments
/// * `pool` - Database connection pool for storing/retrieving token metadata
/// * `network` - The NEAR network configuration (use archival network for historical queries)
/// * `account_id` - The NEAR account to query
/// * `token_contract` - The FT contract address
/// * `block_height` - The block height to query at
///
/// # Returns
/// The decimal-adjusted balance as a BigDecimal (e.g., "2.5" for 2.5 tokens with 6 decimals)
pub async fn get_balance_at_block(
    pool: &PgPool,
    network: &NetworkConfig,
    account_id: &str,
    token_contract: &str,
    block_height: u64,
) -> Result<bigdecimal::BigDecimal, Box<dyn std::error::Error>> {
    // Ensure metadata is cached and get decimals for conversion
    let decimals = ensure_ft_metadata(pool, network, token_contract).await?;

    let token_contract_obj = AccountId::from_str(token_contract)?;

    let data: near_api::Data<U128> = with_transport_retry("ft_balance", || {
        Contract(token_contract_obj.clone())
            .call_function(
                "ft_balance_of",
                serde_json::json!({
                    "account_id": account_id
                }),
            )
            .read_only()
            .at(Reference::AtBlock(block_height))
            .fetch_from(network)
    })
    .await?;

    let raw_balance = data.data;
    let decimal_balance = convert_raw_to_decimal(&raw_balance.0.to_string(), decimals)?;

    Ok(decimal_balance)
}

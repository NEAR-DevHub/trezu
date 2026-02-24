//! NEAR Native Token Balance Queries
//!
//! Functions to query NEAR native token balances at specific block heights via RPC.
//! Balances are returned as human-readable NEAR strings (e.g., "11.1002" not "11100211126630537100000000")
//! using 24 decimals, consistent with FT token decimal conversion.

use bigdecimal::ToPrimitive;
use near_api::{AccountId, NetworkConfig, Reference, Tokens};
use sqlx::PgPool;
use std::str::FromStr;

use crate::handlers::balance_changes::counterparty::convert_raw_to_decimal;
use crate::handlers::balance_changes::utils::with_transport_retry;
use crate::handlers::user::balance::MIN_NEAR_DISPLAY_BALANCE;

/// Query NEAR native token balance at a specific block height, converted to human-readable format
///
/// Returns an error if the block doesn't exist (UnknownBlock). The caller (binary search)
/// is responsible for skipping non-existing blocks.
///
/// # Arguments
/// * `pool` - Database pool for fetching paid_near
/// * `network` - The NEAR network configuration (use archival network for historical queries)
/// * `account_id` - The NEAR account to query
/// * `block_height` - The block height to query at
///
/// # Returns
/// The balance as a BigDecimal (e.g., "11.1002" for 11.1002 NEAR)
pub async fn get_balance_at_block(
    pool: &PgPool,
    network: &NetworkConfig,
    account_id: &str,
    block_height: u64,
) -> Result<bigdecimal::BigDecimal, Box<dyn std::error::Error>> {
    let account_id = AccountId::from_str(account_id)?;

    let balance_future = with_transport_retry("near_balance", || {
        Tokens::account(account_id.clone())
            .near_balance()
            .at(Reference::AtBlock(block_height))
            .fetch_from(network)
    });

    let paid_near_future = sqlx::query_scalar::<_, bigdecimal::BigDecimal>(
        "SELECT paid_near FROM monitored_accounts WHERE account_id = $1",
    )
    .bind(account_id.as_str())
    .fetch_optional(pool);

    let (balance_result, paid_near_result) = tokio::join!(balance_future, paid_near_future);

    match balance_result {
        Ok(balance) => {
            let paid_near_u128 = paid_near_result
                .ok()
                .flatten()
                .and_then(|v| v.to_u128())
                .unwrap_or(0);

            // We shouldn't show in activity tokens that sponsored by us
            let storage_locked = balance.storage_locked.as_yoctonear();
            let deduction = storage_locked.max(paid_near_u128);
            let total = balance.total.as_yoctonear();
            let available_raw = total.saturating_sub(deduction);
            let available = if available_raw < MIN_NEAR_DISPLAY_BALANCE.as_yoctonear() {
                0
            } else {
                available_raw
            };

            let decimal_near = convert_raw_to_decimal(&available.to_string(), 24)?;
            Ok(decimal_near)
        }
        Err(e) => {
            let err_str = e.to_string();
            // Account doesn't exist at this block - balance is 0
            if err_str.contains("UnknownAccount") {
                log::debug!(
                    "Account {} does not exist at block {} - returning balance 0",
                    account_id,
                    block_height
                );
                return Ok(bigdecimal::BigDecimal::from(0));
            }
            Err(e.into())
        }
    }
}

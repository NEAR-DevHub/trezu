//! Neutral application seam for authoritative public balance reads.
//!
//! The underlying readers predate the public snapshot projection. Keeping the
//! routing here lets the new projection depend on balance-reading behavior,
//! rather than on any legacy persistence model.

use bigdecimal::BigDecimal;
use near_api::NetworkConfig;
use sqlx::PgPool;

pub use crate::handlers::balance_changes::history::{
    BalanceSnapshot, ChartMeta, ChartResponse, ChartStatus, Interval,
};
pub use crate::handlers::balance_changes::utils::with_transport_retry;
use crate::utils::contract_read_error::{is_method_not_found, is_unknown_account};

pub fn is_proven_nonexistence(message: &str) -> bool {
    is_unknown_account(message) || message.contains("Contract account does not exist")
}

fn is_definitive_non_staking_contract(message: &str) -> bool {
    is_method_not_found(message)
        || is_unknown_account(message)
        || message
            .to_ascii_lowercase()
            .contains("contract account does not exist")
}

/// Validate that a candidate implements the staking-pool balance interface at
/// an exact block. A missing contract/method is a definitive non-pool; RPC,
/// transport and response-decoding failures remain errors so discovery cannot
/// silently publish an incomplete inventory.
pub async fn validate_staking_pool_at_block(
    network: &NetworkConfig,
    account_id: &str,
    pool_id: &str,
    block_height: u64,
) -> Result<bool, String> {
    match crate::handlers::balance_changes::balance::staking::get_staking_balance_at_exact_block(
        network,
        account_id,
        pool_id,
        block_height,
    )
    .await
    {
        Ok(_) => Ok(true),
        Err(error) if is_definitive_non_staking_contract(&error.to_string()) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

/// Gross native balance (`total`, storage stake NOT subtracted) at an exact
/// block. The bronze-derived ledger tracks the account's total owned NEAR,
/// so verification must compare against the same quantity — the display
/// reader's `total - storage_locked` would show storage-sized phantom drift.
pub async fn get_public_gross_native_balance_at_block(
    network: &NetworkConfig,
    account_id: &str,
    block_height: u64,
) -> Result<BigDecimal, String> {
    Ok(
        get_gross_native_balance_if_exists_at_block(network, account_id, block_height)
            .await?
            .unwrap_or_else(|| BigDecimal::from(0)),
    )
}

/// The account's `amount` at a block — its gross balance with the storage
/// reserve included, exactly the field the dashboard's lockup builder adds
/// to the pool position — or `None` when the account provably did not exist
/// at that block (as opposed to a transport failure, which is `Err`).
pub async fn get_gross_native_balance_if_exists_at_block(
    network: &NetworkConfig,
    account_id: &str,
    block_height: u64,
) -> Result<Option<BigDecimal>, String> {
    use near_api::{AccountId, Reference, Tokens};
    use std::str::FromStr;

    let account_id = AccountId::from_str(account_id).map_err(|error| error.to_string())?;
    match with_transport_retry("near_gross_balance", || {
        Tokens::account(account_id.clone())
            .near_balance()
            .at(Reference::AtBlock(block_height))
            .fetch_from(network)
    })
    .await
    {
        Ok(balance) => {
            let yocto = BigDecimal::from_str(&balance.total.as_yoctonear().to_string())
                .map_err(|error| error.to_string())?;
            Ok(Some(
                yocto / BigDecimal::from_str("1000000000000000000000000").expect("1e24"),
            ))
        }
        Err(error) if is_proven_nonexistence(&error.to_string()) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// A lockup contract's holdings at a block, valued exactly as the dashboard
/// card's `LockupBalance.total` (`handlers::user::lockup`): the lockup
/// account's `amount` (storage reserve included, nothing subtracted) plus
/// its staked and unstaked position in its pool. `exists == false` is a zero
/// reading for a boundary before the lockup account was created.
#[derive(Debug, Clone)]
pub struct LockupReadingAtBlock {
    pub exists: bool,
    /// `view_account.amount` of the lockup account.
    pub account_balance: BigDecimal,
    pub pool_account_id: Option<String>,
    /// Staked + unstaked in `pool_account_id`; zero without a pool.
    pub pool_total: BigDecimal,
}

impl LockupReadingAtBlock {
    pub fn total(&self) -> BigDecimal {
        &self.account_balance + &self.pool_total
    }
}

pub async fn get_lockup_reading_at_block(
    network: &NetworkConfig,
    lockup_account_id: &str,
    block_height: u64,
) -> Result<LockupReadingAtBlock, String> {
    let Some(account_balance) =
        get_gross_native_balance_if_exists_at_block(network, lockup_account_id, block_height)
            .await?
    else {
        return Ok(LockupReadingAtBlock {
            exists: false,
            account_balance: BigDecimal::from(0),
            pool_account_id: None,
            pool_total: BigDecimal::from(0),
        });
    };
    let pool_account_id =
        get_lockup_staking_pool_at_block(network, lockup_account_id, block_height).await?;
    let pool_total = match &pool_account_id {
        Some(pool) => {
            let result = crate::handlers::balance_changes::balance::staking::get_staking_balance_at_exact_block(
                network,
                lockup_account_id,
                pool,
                block_height,
            )
            .await;
            match result {
                Ok(balance) => balance,
                Err(error) if is_proven_nonexistence(&error.to_string()) => BigDecimal::from(0),
                Err(error) => return Err(error.to_string()),
            }
        }
        None => BigDecimal::from(0),
    };
    Ok(LockupReadingAtBlock {
        exists: true,
        account_balance,
        pool_account_id,
        pool_total,
    })
}

/// The pool a lockup had selected at a block (`get_staking_pool_account_id`),
/// read at that block so a later pool switch cannot produce a phantom dip.
/// An account that exists but carries no lockup code yet reads as unstaked.
async fn get_lockup_staking_pool_at_block(
    network: &NetworkConfig,
    lockup_account_id: &str,
    block_height: u64,
) -> Result<Option<String>, String> {
    use near_api::{AccountId, Contract, Reference};
    use std::str::FromStr;

    let account_id = AccountId::from_str(lockup_account_id).map_err(|error| error.to_string())?;
    let result: Result<near_api::Data<Option<AccountId>>, _> =
        with_transport_retry("lockup_staking_pool", || {
            Contract(account_id.clone())
                .call_function("get_staking_pool_account_id", ())
                .read_only()
                .at(Reference::AtBlock(block_height))
                .fetch_from(network)
        })
        .await;
    match result {
        Ok(data) => Ok(data.data.map(|pool| pool.to_string())),
        Err(error) if is_definitive_non_staking_contract(&error.to_string()) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub async fn get_public_balance_at_block(
    pool: &PgPool,
    network: &NetworkConfig,
    account_id: &str,
    asset: &str,
    block_height: u64,
) -> Result<BigDecimal, String> {
    if let Some(staking_pool) = asset.strip_prefix("staking:") {
        let result =
            crate::handlers::balance_changes::balance::staking::get_staking_balance_at_exact_block(
                network,
                account_id,
                staking_pool,
                block_height,
            )
            .await;
        return match result {
            Ok(balance) => Ok(balance),
            Err(error) if is_proven_nonexistence(&error.to_string()) => Ok(BigDecimal::from(0)),
            Err(error) => Err(error.to_string()),
        };
    }
    if let Some(lockup_account_id) = asset.strip_prefix("lockup:") {
        return get_lockup_reading_at_block(network, lockup_account_id, block_height)
            .await
            .map(|reading| reading.total());
    }

    let result = crate::handlers::balance_changes::balance::get_balance_at_block(
        pool,
        network,
        account_id,
        asset,
        block_height,
    )
    .await;
    match result {
        Ok(balance) => Ok(balance),
        Err(error) if is_proven_nonexistence(&error.to_string()) => Ok(BigDecimal::from(0)),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::is_definitive_non_staking_contract;

    #[test]
    fn staking_validation_only_suppresses_definitive_non_pool_errors() {
        assert!(is_definitive_non_staking_contract(
            "MethodResolveError(MethodNotFound)"
        ));
        assert!(is_definitive_non_staking_contract(
            "Contract account does not exist"
        ));
        assert!(!is_definitive_non_staking_contract("429 Too Many Requests"));
        assert!(!is_definitive_non_staking_contract(
            "failed to parse return value as U128"
        ));
        assert!(!is_definitive_non_staking_contract(
            "transport connection reset"
        ));
    }
}

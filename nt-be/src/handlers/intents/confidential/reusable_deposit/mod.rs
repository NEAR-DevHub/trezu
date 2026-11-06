//! Reusable 1Click deposit address set for a confidential treasury.
//!
//! 1Click models a reusable address as one long-lived `ANY_INPUT` quote per
//! account: its `depositAddress` is the monitoring address and
//! `chainDepositAddresses` lists one funding address per blockchain, all
//! crediting the account's confidential balance. The set is discovered (or
//! created once) with the DAO JWT and cached on `monitored_accounts`, so the
//! deposit modal and share pages serve it without a 1Click round trip.
//! Mirrors near.com `features/deposit/server/rdaApi.ts`.

mod client;
mod minimum;
mod repository;
mod resolver;
#[cfg(test)]
mod tests;
mod types;

pub use client::{
    ReusableWithdrawal, ReusableWithdrawals, WITHDRAWALS_PAGE_LIMIT, WithdrawalsError,
};
pub use repository::{clear_cached, load_cached};
pub use resolver::ReusableDepositResolver;
pub use types::{
    ChainDepositAddress, REUSABLE_QUOTE_DEADLINE, ResolvedDepositAddress, ReusableDepositAddresses,
};

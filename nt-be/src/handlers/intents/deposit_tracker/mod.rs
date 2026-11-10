//! Deposit tracker: temporary "Processing" visibility for inbound deposits
//! between address display and permanent ledger projection.
//!
//! Public treasuries are polled through the bridge `recent_deposits` method,
//! coalesced per DAO. Confidential treasuries are polled through the payout
//! list of the DAO's reusable 1Click deposit set. Both normalise into
//! `in_process_deposits`, which the recent-activity read path unions ahead of
//! ledger rows until an exact ledger match retires them.
//!
//! The tracker owns temporary deposit progress; the ledger owns history.

pub mod activity;
pub mod api;
pub mod bridge;
pub mod store;
pub mod worker;

use chrono::{Duration, Utc};
use sqlx::PgPool;

pub use store::{DepositWatch, InProcessDeposit};

/// Fast polling window after a deposit address is shown (or re-shown).
pub const FAST_WINDOW: Duration = Duration::minutes(10);
/// Active discovery stops this long after activation when nothing arrived.
pub const DISCOVERY_WINDOW: Duration = Duration::minutes(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchKind {
    Public,
    Confidential,
}

impl WatchKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Confidential => "confidential",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "public" => Some(Self::Public),
            "confidential" => Some(Self::Confidential),
            _ => None,
        }
    }

    /// Prefix of the `actionKind` the activity feed derives status from.
    fn action_kind_prefix(self) -> &'static str {
        match self {
            Self::Public => "PublicDeposit",
            Self::Confidential => "ConfidentialDeposit",
        }
    }
}

/// Generic tracker state. Provider-specific statuses are kept alongside in
/// `provider_status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepositStatus {
    /// Provider supplied real deposit evidence; settlement still in progress.
    Detected,
    /// Provider confirmed settlement; waiting for the ledger to carry the row.
    Finalized,
    /// Permanent ledger row committed and linked; temporary row retired.
    LedgerConfirmed,
    /// Provider confirmed a terminal unsuccessful outcome.
    Failed,
}

impl DepositStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Detected => "detected",
            Self::Finalized => "finalized",
            Self::LedgerConfirmed => "ledger_confirmed",
            Self::Failed => "failed",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "detected" => Some(Self::Detected),
            "finalized" => Some(Self::Finalized),
            "ledger_confirmed" => Some(Self::LedgerConfirmed),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::LedgerConfirmed | Self::Failed)
    }

    /// Status suffix the activity feed understands (`...:pending`, `...:failed`).
    fn activity_suffix(self) -> Option<&'static str> {
        match self {
            Self::Detected | Self::Finalized => Some("pending"),
            Self::Failed => Some("failed"),
            Self::LedgerConfirmed => None,
        }
    }
}

/// Activation scope captured from the deposit modal.
#[derive(Debug, Clone)]
pub struct WatchActivation {
    pub dao_id: String,
    pub chain: String,
    pub token_id: Option<String>,
}

impl WatchActivation {
    /// Public treasuries: one watch per DAO, renewed on every address display.
    /// Returns `Ok(false)` when the account is not monitored (nothing to track).
    pub async fn activate_public(&self, pool: &PgPool) -> Result<bool, sqlx::Error> {
        self.activate(pool, WatchKind::Public, None).await
    }

    /// Confidential treasuries: one watch per DAO on its reusable deposit
    /// set, keyed by the set's quote address and renewed on every display.
    pub async fn activate_confidential(
        &self,
        pool: &PgPool,
        quote_deposit_address: &str,
    ) -> Result<bool, sqlx::Error> {
        self.activate(pool, WatchKind::Confidential, Some(quote_deposit_address))
            .await
    }

    async fn activate(
        &self,
        pool: &PgPool,
        kind: WatchKind,
        quote_deposit_address: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now();
        store::upsert_watch(
            pool,
            &self.dao_id,
            kind,
            quote_deposit_address,
            &self.chain,
            self.token_id.as_deref(),
            now + FAST_WINDOW,
            now + DISCOVERY_WINDOW,
        )
        .await
    }
}

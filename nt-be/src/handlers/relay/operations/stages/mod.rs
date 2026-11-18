//! The stages a relay operation moves through. Each stage does one thing and
//! answers [`StageResult`]; it keeps nothing between calls, so the next cycle,
//! or another process, can call it again from the row alone.
//!
//! - [`authorize`]: DAO policy, deposit limit, credit reservation.
//! - [`storage_top_up`]: sponsor transfer for the storage the action adds.
//! - [`registrations`]: token `storage_deposit`s for approving votes.
//! - [`relay`]: sends the user's action.
//! - [`settle`]: reads the landed outcome and decides the result.
//! - [`transaction`]: sign, broadcast, reconcile; shared by the chain stages.

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::Utc;
use serde_json::Value;
use tokio::sync::OwnedSemaphorePermit;

use crate::AppState;

use super::{
    models::{FailureCode, OperationLease, OperationOutcome, OperationStage, RelayOperation},
    plan::RelayPlan,
    rpc::RelayRpc,
    store::{RelayStore, RelayStoreError},
};

pub mod authorize;
pub mod registrations;
pub mod relay;
pub mod settle;
pub mod storage_top_up;
pub mod transaction;

#[cfg(test)]
mod tests;

/// An operation with nothing sent this long after creation is ended as not
/// sent. It never applies while a transaction may still land.
const OPERATION_MAX_AGE: chrono::Duration = chrono::Duration::minutes(30);

pub struct StageContext<'a> {
    pub state: &'a Arc<AppState>,
    pub rpc: &'a RelayRpc,
    pub lease: &'a OperationLease,
    pub operation: &'a RelayOperation,
    pub plan: &'a RelayPlan,
    /// The relay outcome when it landed in this run, so `settle` does not
    /// read it back by hash. Empty after a restart.
    pub landed_relay: &'a Mutex<Option<Value>>,
    /// This run's place in the line for a sponsor lane, held from signing a
    /// transaction until that transaction is final.
    pub lane_turn: &'a Mutex<Option<OwnedSemaphorePermit>>,
}

impl StageContext<'_> {
    pub fn store(&self) -> RelayStore<'_> {
        RelayStore::new(&self.state.db_pool)
    }

    pub fn has_lane_turn(&self) -> bool {
        self.lane_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some()
    }

    pub fn hold_lane_turn(&self, turn: OwnedSemaphorePermit) {
        *self
            .lane_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(turn);
    }

    /// Let the next signer in line go: this run's transaction is final.
    pub fn end_lane_turn(&self) {
        self.lane_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }

    /// Ends the operation when nothing new may be signed for it any more: it
    /// is too old, or the user's delegate action is within `margin_blocks` of
    /// its expiry. Call only while none of its transactions is in flight.
    pub async fn unsendable(
        &self,
        margin_blocks: u64,
    ) -> Result<Option<OperationOutcome>, StageError> {
        if Utc::now() - self.operation.created_at > OPERATION_MAX_AGE {
            return Ok(Some(OperationOutcome::Failed {
                failure_code: FailureCode::NotSent,
                reason: format!(
                    "not sent within {} minutes of submission",
                    OPERATION_MAX_AGE.num_minutes()
                ),
            }));
        }
        let Some(max_block_height) = self.plan.delegate_max_block_height else {
            return Ok(None);
        };
        let height = self
            .rpc
            .block_height()
            .await
            .map_err(StageError::Transient)?;
        if height + margin_blocks > max_block_height {
            return Ok(Some(OperationOutcome::Failed {
                failure_code: FailureCode::DelegateExpired,
                reason: format!(
                    "delegate action expires at block {max_block_height} (head {height}) before the relay could be sent"
                ),
            }));
        }
        Ok(None)
    }
}

/// A confidential intent whose `v1.signer` call the landed relay executed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutedIntent {
    pub payload_hash: String,
    pub proposal_id: u64,
    pub tx_hash: String,
}

/// A confidential intent whose proposal the landed relay created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedIntent {
    pub payload_hash: String,
    pub proposal_id: u64,
}

/// How an operation ends, with what must be written in the same commit.
pub struct Completion {
    pub outcome: OperationOutcome,
    pub executed_intents: Vec<ExecutedIntent>,
    pub proposed_intents: Vec<ProposedIntent>,
}

impl From<OperationOutcome> for Completion {
    fn from(outcome: OperationOutcome) -> Self {
        Self {
            outcome,
            executed_intents: Vec::new(),
            proposed_intents: Vec::new(),
        }
    }
}

pub enum StageResult {
    /// The stage is finished; move to the given stage.
    Advance(OperationStage),
    /// The stage already moved the row in a transaction of its own.
    Advanced(Box<RelayOperation>),
    /// Its input is not there yet; call the same stage again after the delay.
    NotReady(Duration, Option<String>),
    /// The operation ends here.
    Done(Completion),
}

impl StageResult {
    pub fn done(outcome: OperationOutcome) -> Self {
        Self::Done(outcome.into())
    }

    pub fn failed(failure_code: FailureCode, reason: impl Into<String>) -> Self {
        Self::done(OperationOutcome::Failed {
            failure_code,
            reason: reason.into(),
        })
    }

    /// Run the same stage again at once.
    pub fn again() -> Self {
        Self::NotReady(Duration::ZERO, None)
    }
}

#[derive(Debug)]
pub enum StageError {
    Store(RelayStoreError),
    /// Worth retrying: a provider or lookup failed.
    Transient(String),
    /// The rows contradict each other; the operation is parked.
    Invariant(String),
}

impl From<RelayStoreError> for StageError {
    fn from(error: RelayStoreError) -> Self {
        Self::Store(error)
    }
}

pub(crate) trait Stage {
    async fn run(&self, ctx: &StageContext<'_>) -> Result<StageResult, StageError>;
}

/// Run the stage the operation is in.
pub async fn run(ctx: &StageContext<'_>) -> Result<StageResult, StageError> {
    match ctx.operation.stage {
        OperationStage::Authorize => authorize::Authorize.run(ctx).await,
        OperationStage::StorageTopUp => storage_top_up::StorageTopUp.run(ctx).await,
        OperationStage::Registrations => registrations::Registrations.run(ctx).await,
        OperationStage::Relay => relay::Relay.run(ctx).await,
        OperationStage::Settle => settle::Settle.run(ctx).await,
    }
}

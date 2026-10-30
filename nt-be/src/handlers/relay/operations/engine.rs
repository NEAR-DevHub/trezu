//! Drives one `relay_operations` row to a terminal state: sign each step on a
//! free sponsor lane, commit the bytes, broadcast, reconcile by hash, and
//! finish with the credit, spend and metrics in one database transaction.
//!
//! The HTTP handler runs the engine first (it is the first worker of its own
//! operation); the `relay-submissions` job runs it for anything deferred,
//! crashed or left behind by a lost lease.

use std::{
    collections::{BTreeMap, HashSet},
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use base64::Engine as _;
use bigdecimal::{BigDecimal, Zero};
use borsh::BorshDeserialize;
use chrono::Utc;
use near_api::{AccountId, NearToken};
use near_primitives::{
    action::{
        Action as ProtocolAction, FunctionCallAction as ProtocolFunctionCall, TransferAction,
        delegate::SignedDelegateAction as ProtocolSignedDelegate,
    },
    hash::CryptoHash as ProtocolHash,
    transaction::{Transaction as ProtocolTransaction, TransactionV0},
    types::AccountId as ProtocolAccountId,
};
use rand::Rng;
use serde_json::Value;
use sqlx::PgConnection;

use crate::{
    AppState, error_event,
    error_event::ErrorCode,
    handlers::relay::{
        confidential,
        effects::{
            allowlist,
            registrations::{
                self, MAX_STORAGE_DEPOSITS, STORAGE_DEPOSIT_AMOUNT, STORAGE_DEPOSIT_GAS,
            },
        },
        parse::{RelayOperation as DaoOperation, RelaySubmission, parse_relay},
        post_quantum::{protocol_account, read_send_tx_result},
        sponsor::policy,
    },
    handlers::token::storage_deposit::is_registered::check_storage_deposit,
    services::platform_metrics::{self, PlatformMetric},
};

use super::{
    models::{
        FailureCode, OperationLease, OperationOutcome, PreparedTransaction, RelayOperation,
        RelaySubmissionStatus, RelayTransaction, StepKey, TransactionOutcome, TransactionState,
    },
    rpc::{RelayRpc, SendOutcome, StatusOutcome, is_expired_rejection},
    store::{RelayStore, RelayStoreError},
};

/// How long one holder may own an operation before another may reclaim it;
/// a running holder renews it every [`LEASE_RENEWAL`].
pub const OPERATION_LEASE: Duration = Duration::from_secs(60);
const LEASE_RENEWAL: Duration = Duration::from_secs(20);
/// How long the request path waits for its own operation before answering
/// `202`; the driver it started keeps going up to [`HANDLER_DRIVE_BUDGET`].
pub const HANDLER_RESPONSE_BUDGET: Duration = Duration::from_secs(12);
pub const HANDLER_DRIVE_BUDGET: Duration = Duration::from_secs(60);
const WORKER_BUDGET: Duration = Duration::from_secs(10);
/// An operation still unresolved this long after creation (only possible
/// when the user's action has no expiry of its own, or every provider is
/// down) is parked for an operator instead of spinning for the validity
/// window.
const OPERATION_MAX_AGE: chrono::Duration = chrono::Duration::minutes(30);
const ORPHAN_RECHECK: Duration = Duration::from_secs(30);
const CLAIM_BATCH: i64 = 32;
const ORPHAN_BATCH: i64 = 20;
/// Mainnet `transaction_validity_period`: a block hash older than this can no
/// longer anchor a transaction.
const TRANSACTION_VALIDITY_BLOCKS: u64 = 86_400;
const LANE_WAIT: Duration = Duration::from_millis(300);
const REGISTRATION_BATCH: usize = 50;
const STALL_ALERT_COOLDOWN: Duration = Duration::from_secs(600);
const RECONCILIATION_STALL: i64 = 600;
const QUEUE_STALL: Duration = Duration::from_secs(120);

pub struct RelayEngine {
    state: Arc<AppState>,
    rpc: RelayRpc,
}

/// The newest row after a run: terminal, or still pending with its lease
/// released (deferred, budget spent, or taken over by another holder).
pub enum RunOutcome {
    Terminal(RelayOperation),
    Pending(RelayOperation),
}

impl RunOutcome {
    pub fn into_operation(self) -> RelayOperation {
        match self {
            Self::Terminal(op) | Self::Pending(op) => op,
        }
    }
}

#[derive(Debug, Default)]
pub struct CycleSummary {
    pub claimed: usize,
    pub terminal: usize,
    pub pending: usize,
    pub orphans_settled: usize,
    pub health: String,
}

impl std::fmt::Display for CycleSummary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "claimed={} terminal={} pending={} orphans_settled={} {}",
            self.claimed, self.terminal, self.pending, self.orphans_settled, self.health
        )
    }
}

enum Step {
    Continue,
    Wait(Duration, Option<String>),
    Done(OperationOutcome, Option<String>),
}

enum EngineError {
    Store(RelayStoreError),
    Transient(String),
    Invariant(String),
}

impl From<RelayStoreError> for EngineError {
    fn from(error: RelayStoreError) -> Self {
        Self::Store(error)
    }
}

/// The parsed payload: everything the steps need, derived again from the
/// stored bytes on every run so nothing but the row has to survive a crash.
struct RelayPlan {
    treasury_id: AccountId,
    submission: RelaySubmission,
    dao_operation: DaoOperation,
    attached_deposit: NearToken,
    storage_cost: NearToken,
    delegate_max_block_height: Option<u64>,
}

impl RelayPlan {
    fn from_operation(operation: &RelayOperation) -> Result<Self, String> {
        let parsed = parse_relay(operation.treasury_id.clone(), &operation.submission_payload)?;
        let storage_cost = if parsed.proposal_storage_bytes > 0 {
            policy::proposal_storage_cost(parsed.proposal_storage_bytes)
        } else {
            NearToken::from_near(0)
        };
        let delegate_max_block_height = match &parsed.submission {
            RelaySubmission::MetaTransaction(_) => {
                delegate_max_block_height(&operation.submission_payload)
            }
            RelaySubmission::WalletContract(_) => None,
        };
        Ok(Self {
            treasury_id: parsed.treasury_id,
            submission: parsed.submission,
            dao_operation: parsed.operation,
            attached_deposit: parsed.attached_deposit,
            storage_cost,
            delegate_max_block_height,
        })
    }

    /// Receiver and actions of the final sponsor transaction.
    fn relay_transaction(
        &self,
        payload: &[u8],
    ) -> Result<(AccountId, Vec<ProtocolAction>), String> {
        match &self.submission {
            RelaySubmission::WalletContract(replay) => Ok((
                replay.wallet_account.clone(),
                protocol_actions(&replay.actions)?,
            )),
            RelaySubmission::MetaTransaction(_) => {
                let delegate = ProtocolSignedDelegate::try_from_slice(payload)
                    .map_err(|error| format!("stored delegate action: {error}"))?;
                let receiver = api_account(&delegate.delegate_action.sender_id)?;
                Ok((receiver, vec![ProtocolAction::Delegate(Box::new(delegate))]))
            }
        }
    }
}

/// `max_block_height` of a stored delegate action, whichever key type signed it.
pub fn delegate_max_block_height(payload: &[u8]) -> Option<u64> {
    ProtocolSignedDelegate::try_from_slice(payload)
        .ok()
        .map(|signed| signed.delegate_action.max_block_height)
}

fn api_account(id: &ProtocolAccountId) -> Result<AccountId, String> {
    id.as_str()
        .parse()
        .map_err(|error| format!("invalid account id '{id}': {error}"))
}

fn protocol_actions(actions: &[near_api::types::Action]) -> Result<Vec<ProtocolAction>, String> {
    actions
        .iter()
        .map(|action| match action {
            near_api::types::Action::FunctionCall(call) => Ok(ProtocolAction::FunctionCall(
                Box::new(ProtocolFunctionCall {
                    method_name: call.method_name.clone(),
                    args: call.args.clone(),
                    gas: near_primitives::gas::Gas::from_gas(call.gas.as_gas()),
                    deposit: call.deposit,
                }),
            )),
            near_api::types::Action::Transfer(transfer) => {
                Ok(ProtocolAction::Transfer(TransferAction {
                    deposit: transfer.deposit,
                }))
            }
            other => Err(format!("unsupported sponsored action: {other:?}")),
        })
        .collect()
}

/// Delay before looking at a pending transaction again: half its age, within
/// one second and thirty, with a little jitter so holders do not align.
fn reconcile_backoff(age: Duration) -> Duration {
    let base = (age.as_secs_f64() / 2.0).clamp(1.0, 30.0);
    let jitter = rand::rng().random_range(0.0..0.2);
    Duration::from_secs_f64(base * (1.0 + jitter))
}

static PROGRESS: AtomicU64 = AtomicU64::new(0);

struct StallState {
    last_progress_seen: u64,
    last_progress_at: Instant,
    last_reconciliation_alert: Option<Instant>,
    last_queue_alert: Option<Instant>,
}

static STALLS: LazyLock<Mutex<StallState>> = LazyLock::new(|| {
    Mutex::new(StallState {
        last_progress_seen: 0,
        last_progress_at: Instant::now(),
        last_reconciliation_alert: None,
        last_queue_alert: None,
    })
});

fn note_progress() {
    PROGRESS.fetch_add(1, Ordering::Relaxed);
}

impl RelayEngine {
    pub fn new(state: Arc<AppState>) -> Self {
        let rpc = RelayRpc::from_state(&state);
        Self { state, rpc }
    }

    fn store(&self) -> RelayStore<'_> {
        RelayStore::new(&self.state.db_pool)
    }

    /// Drive a claimed operation until it is terminal, has to wait on the
    /// network, or `budget` is spent.
    pub async fn run_operation(&self, operation: RelayOperation, budget: Duration) -> RunOutcome {
        let Some(lease) = operation.lease() else {
            return RunOutcome::Pending(operation);
        };
        let plan = match RelayPlan::from_operation(&operation) {
            Ok(plan) => plan,
            Err(error) => {
                error_event!(
                    ErrorCode::RelaySubmissionInvariantBroken,
                    submission_id = %operation.id,
                    treasury_id = %operation.treasury_id,
                    error = %error
                );
                return self
                    .finish(
                        &operation,
                        &lease,
                        OperationOutcome::ManualReview {
                            reason: format!("stored payload no longer parses: {error}"),
                        },
                        None,
                        None,
                    )
                    .await;
            }
        };
        let started = Instant::now();
        let mut lease_renewed_at = started;
        loop {
            if started.elapsed() >= budget {
                return self.release(&operation, &lease, Duration::ZERO, None).await;
            }
            if lease_renewed_at.elapsed() >= LEASE_RENEWAL {
                lease_renewed_at = Instant::now();
                if let Err(error) = self.store().extend_lease(&lease, OPERATION_LEASE).await {
                    tracing::warn!(submission_id = %operation.id, error = %error, "relay lease renewal failed");
                    return RunOutcome::Pending(self.reload(&operation).await);
                }
            }
            match self.step(&lease, &operation, &plan).await {
                Ok(Step::Continue) => note_progress(),
                Ok(Step::Wait(after, note)) => {
                    if started.elapsed() + after < budget {
                        tokio::time::sleep(after).await;
                    } else {
                        return self.release(&operation, &lease, after, note).await;
                    }
                }
                Ok(Step::Done(outcome, outcome_debug)) => {
                    return self
                        .finish(&operation, &lease, outcome, outcome_debug, Some(&plan))
                        .await;
                }
                Err(EngineError::Store(RelayStoreError::LeaseLost)) => {
                    return RunOutcome::Pending(self.reload(&operation).await);
                }
                Err(EngineError::Store(error)) => {
                    tracing::warn!(submission_id = %operation.id, error = %error, "relay store error; deferring");
                    return self
                        .release(
                            &operation,
                            &lease,
                            Duration::from_secs(2),
                            Some(error.to_string()),
                        )
                        .await;
                }
                Err(EngineError::Transient(error)) => {
                    tracing::warn!(submission_id = %operation.id, error = %error, "relay step hit a transient error; deferring");
                    return self
                        .release(&operation, &lease, Duration::from_secs(2), Some(error))
                        .await;
                }
                Err(EngineError::Invariant(error)) => {
                    error_event!(
                        ErrorCode::RelaySubmissionInvariantBroken,
                        submission_id = %operation.id,
                        treasury_id = %operation.treasury_id,
                        error = %error
                    );
                    return self
                        .finish(
                            &operation,
                            &lease,
                            OperationOutcome::ManualReview { reason: error },
                            None,
                            Some(&plan),
                        )
                        .await;
                }
            }
        }
    }

    /// One worker cycle: everything due, then the orphan sweep and the stall
    /// checks.
    pub async fn run_due(&self) -> Result<CycleSummary, RelayStoreError> {
        let store = self.store();
        let claimed = store
            .claim_due_operations(CLAIM_BATCH, OPERATION_LEASE)
            .await?;
        let mut summary = CycleSummary {
            claimed: claimed.len(),
            ..CycleSummary::default()
        };
        let runs = claimed
            .into_iter()
            .map(|operation| self.run_operation(operation, WORKER_BUDGET));
        for outcome in futures::future::join_all(runs).await {
            match outcome {
                RunOutcome::Terminal(_) => summary.terminal += 1,
                RunOutcome::Pending(_) => summary.pending += 1,
            }
        }
        summary.orphans_settled = self.sweep_orphans().await;
        let health = store.queue_health().await?;
        self.check_stalls(&health);
        summary.health = format!(
            "pending_operations={} pending_transactions={} oldest_pending_seconds={} manual_review={}",
            health.pending_operations,
            health.pending_transactions,
            health.oldest_pending_seconds.unwrap_or(0),
            health.manual_review_operations
        );
        Ok(summary)
    }

    async fn reload(&self, operation: &RelayOperation) -> RelayOperation {
        match self.store().operation(operation.id).await {
            Ok(Some(row)) => row,
            _ => operation.clone(),
        }
    }

    async fn release(
        &self,
        operation: &RelayOperation,
        lease: &OperationLease,
        after: Duration,
        note: Option<String>,
    ) -> RunOutcome {
        let next_attempt_at = Utc::now() + chrono::Duration::from_std(after).unwrap_or_default();
        if let Err(error) = self
            .store()
            .defer_operation(lease, next_attempt_at, note.as_deref())
            .await
        {
            tracing::warn!(submission_id = %operation.id, error = %error, "relay deferral failed");
        }
        RunOutcome::Pending(self.reload(operation).await)
    }

    async fn step(
        &self,
        lease: &OperationLease,
        operation: &RelayOperation,
        plan: &RelayPlan,
    ) -> Result<Step, EngineError> {
        let transactions = self.store().transactions_of(operation.id).await?;
        if let Some(tx) = transactions
            .iter()
            .find(|tx| tx.state == TransactionState::Prepared)
        {
            return self.broadcast(lease, plan, tx).await;
        }
        if let Some(tx) = transactions
            .iter()
            .find(|tx| tx.state == TransactionState::Pending)
        {
            return self.reconcile(lease, operation, plan, tx).await;
        }
        if let Some(relay) = transactions
            .iter()
            .find(|tx| tx.step_key.is_relay() && tx.state == TransactionState::Succeeded)
        {
            // The relay landed but the completion did not commit; read the
            // outcome back by hash.
            return match self.rpc.status(&self.state.signer_id, &relay.tx_hash).await {
                StatusOutcome::Landed(result) => {
                    self.settle_landed(lease, plan, relay, &result).await
                }
                StatusOutcome::Known(stage) => Ok(Step::Wait(
                    Duration::from_secs(1),
                    Some(format!("landed relay not final yet: {stage}")),
                )),
                StatusOutcome::Unknown { detail, .. } => Err(EngineError::Transient(format!(
                    "landed relay {} not readable: {detail}",
                    relay.tx_hash
                ))),
            };
        }

        // Nothing in flight: before signing anything new, make sure the
        // user's action can still succeed at all.
        if let Some(outcome) = self.expired_outcome(operation, plan, None).await? {
            return Ok(Step::Done(outcome, None));
        }
        let done: HashSet<StepKey> = transactions
            .iter()
            .filter(|tx| tx.state == TransactionState::Succeeded)
            .map(|tx| tx.step_key.clone())
            .collect();
        if plan.storage_cost.as_yoctonear() > 0 && !done.contains(&StepKey::StorageTopUp) {
            return self
                .sign_step(
                    lease,
                    StepKey::StorageTopUp,
                    plan.treasury_id.clone(),
                    vec![ProtocolAction::Transfer(TransferAction {
                        deposit: plan.storage_cost,
                    })],
                    plan.storage_cost,
                )
                .await;
        }
        match self.next_registration(plan, &done).await? {
            RegistrationPlan::Sign {
                step,
                token,
                accounts,
            } => {
                let actions = accounts
                    .iter()
                    .map(storage_deposit_action)
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(EngineError::Transient)?;
                let spend = STORAGE_DEPOSIT_AMOUNT.saturating_mul(accounts.len() as u128);
                return self.sign_step(lease, step, token, actions, spend).await;
            }
            RegistrationPlan::TooMany(count) => {
                return Ok(Step::Done(
                    OperationOutcome::Failed {
                        failure_code: FailureCode::SponsorStepFailed,
                        reason: format!(
                            "too many storage_deposit registrations required ({count} > {MAX_STORAGE_DEPOSITS})"
                        ),
                    },
                    None,
                ));
            }
            RegistrationPlan::None => {}
        }
        let (receiver, actions) = plan
            .relay_transaction(&operation.submission_payload)
            .map_err(EngineError::Invariant)?;
        self.sign_step(
            lease,
            StepKey::Relay,
            receiver,
            actions,
            plan.attached_deposit,
        )
        .await
    }

    async fn next_registration(
        &self,
        plan: &RelayPlan,
        done: &HashSet<StepKey>,
    ) -> Result<RegistrationPlan, EngineError> {
        let approve_ids = plan.dao_operation.vote_approve_ids();
        if approve_ids.is_empty() {
            return Ok(RegistrationPlan::None);
        }
        let mut targets = HashSet::new();
        for proposal_id in approve_ids {
            targets.extend(
                registrations::derive_targets_for_proposal(
                    &self.state,
                    &plan.treasury_id,
                    proposal_id,
                )
                .await,
            );
        }
        let allowed = allowlist::allowed_storage_contracts(&self.state).await;
        let mut by_token: BTreeMap<AccountId, Vec<AccountId>> = BTreeMap::new();
        for target in targets {
            if allowed.contains(target.token_id.as_str()) {
                by_token
                    .entry(target.token_id)
                    .or_default()
                    .push(target.account_id);
            }
        }
        let total: usize = by_token.values().map(Vec::len).sum();
        if total > MAX_STORAGE_DEPOSITS {
            return Ok(RegistrationPlan::TooMany(total));
        }
        for (token, mut accounts) in by_token {
            accounts.sort();
            for (index, chunk) in accounts.chunks(REGISTRATION_BATCH).enumerate() {
                let step = StepKey::Registration {
                    token: token.clone(),
                    chunk: index as u32,
                };
                if done.contains(&step) {
                    continue;
                }
                let mut unregistered = Vec::new();
                for account in chunk {
                    match check_storage_deposit(&self.state, account.clone(), token.clone()).await {
                        Ok(true) => {}
                        Ok(false) => unregistered.push(account.clone()),
                        Err((_, message)) => {
                            // Unverifiable: register anyway, `registration_only`
                            // refunds when it was already there.
                            tracing::warn!(account = %account, token = %token, error = %message, "registration check failed");
                            unregistered.push(account.clone());
                        }
                    }
                }
                if unregistered.is_empty() {
                    continue;
                }
                return Ok(RegistrationPlan::Sign {
                    step,
                    token,
                    accounts: unregistered,
                });
            }
        }
        Ok(RegistrationPlan::None)
    }

    /// Lock a free lane, sign with it, and commit the bytes as `prepared`.
    async fn sign_step(
        &self,
        lease: &OperationLease,
        step: StepKey,
        receiver: AccountId,
        actions: Vec<ProtocolAction>,
        spend: NearToken,
    ) -> Result<Step, EngineError> {
        let rotation = self.state.relay_lanes.rotation();
        let Some(claim) = self.store().claim_free_lane(&rotation).await? else {
            return Ok(Step::Wait(
                LANE_WAIT,
                Some("all sponsor lanes busy".to_owned()),
            ));
        };
        let lane = self
            .state
            .relay_lanes
            .get(&claim.public_key)
            .ok_or_else(|| EngineError::Invariant(format!("unknown lane {}", claim.public_key)))?;
        let snapshot = self
            .rpc
            .access_key(&self.state.signer_id, &lane.api_public_key)
            .await
            .map_err(EngineError::Transient)?;
        let floor = claim.nonce_floor.unwrap_or(0).max(0) as u64;
        let nonce = snapshot.nonce.max(floor) + 1;
        let transaction = ProtocolTransaction::V0(TransactionV0 {
            signer_id: protocol_account(&self.state.signer_id).map_err(EngineError::Invariant)?,
            public_key: lane.protocol_public_key(),
            nonce,
            receiver_id: protocol_account(&receiver).map_err(EngineError::Invariant)?,
            block_hash: ProtocolHash(snapshot.block_hash),
            actions,
        });
        let signed = lane.sign(transaction);
        let prepared = PreparedTransaction {
            step_key: step,
            public_key: claim.public_key.clone(),
            nonce: nonce as i64,
            valid_until_height: (snapshot.block_height + TRANSACTION_VALIDITY_BLOCKS) as i64,
            tx_hash: signed.get_hash().to_string(),
            signed_tx: borsh::to_vec(&signed)
                .map_err(|error| EngineError::Invariant(format!("serialize signed tx: {error}")))?,
            spend_yocto: BigDecimal::from(spend.as_yoctonear()),
        };
        match claim.commit_prepared(lease, prepared).await {
            Ok(_) => Ok(Step::Continue),
            Err(error) if error.is_unique_violation() => Err(EngineError::Invariant(format!(
                "nonce, hash or step already committed: {error}"
            ))),
            Err(error) => Err(error.into()),
        }
    }

    async fn broadcast(
        &self,
        lease: &OperationLease,
        plan: &RelayPlan,
        tx: &RelayTransaction,
    ) -> Result<Step, EngineError> {
        let store = self.store();
        store.mark_broadcast(lease, tx.id).await?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&tx.signed_tx);
        match self.rpc.send(&encoded).await {
            SendOutcome::Landed(result) => self.settle_landed(lease, plan, tx, &result).await,
            SendOutcome::Rejected(message) => {
                store
                    .settle_transaction(
                        lease,
                        tx.id,
                        &TransactionOutcome::Failed {
                            reason: message.clone(),
                        },
                    )
                    .await?;
                Ok(Step::Done(
                    OperationOutcome::Failed {
                        failure_code: FailureCode::NotSent,
                        reason: message,
                    },
                    None,
                ))
            }
            SendOutcome::Unknown(message) | SendOutcome::Unreachable(message) => {
                store
                    .record_transaction_error(lease, tx.id, &message)
                    .await?;
                Ok(Step::Wait(Duration::from_secs(1), Some(message)))
            }
        }
    }

    /// A pending transaction: look its hash up, resend the same bytes while
    /// nobody has them, and give up only on proof.
    async fn reconcile(
        &self,
        lease: &OperationLease,
        operation: &RelayOperation,
        plan: &RelayPlan,
        tx: &RelayTransaction,
    ) -> Result<Step, EngineError> {
        let store = self.store();
        let absent_votes = match self.rpc.status(&self.state.signer_id, &tx.tx_hash).await {
            StatusOutcome::Landed(result) => {
                return self.settle_landed(lease, plan, tx, &result).await;
            }
            StatusOutcome::Known(stage) => {
                return Ok(Step::Wait(Duration::from_secs(1), Some(stage)));
            }
            StatusOutcome::Unknown { absent_votes, .. } => absent_votes,
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(&tx.signed_tx);
        match self.rpc.send(&encoded).await {
            SendOutcome::Landed(result) => {
                return self.settle_landed(lease, plan, tx, &result).await;
            }
            SendOutcome::Rejected(message)
                if absent_votes > 0 && is_expired_rejection(&message) =>
            {
                store
                    .settle_transaction(
                        lease,
                        tx.id,
                        &TransactionOutcome::Superseded { reason: message },
                    )
                    .await?;
                return Ok(Step::Continue);
            }
            SendOutcome::Rejected(message)
            | SendOutcome::Unknown(message)
            | SendOutcome::Unreachable(message) => {
                store
                    .record_transaction_error(lease, tx.id, &message)
                    .await?;
            }
        }
        let height = self
            .rpc
            .block_height()
            .await
            .map_err(EngineError::Transient)?;
        if let Some(outcome) = self.expired_outcome(operation, plan, Some(height)).await? {
            return Ok(Step::Done(outcome, None));
        }
        if height as i64 > tx.valid_until_height && absent_votes >= self.rpc.absence_quorum() {
            store
                .settle_transaction(
                    lease,
                    tx.id,
                    &TransactionOutcome::Superseded {
                        reason: format!(
                            "validity window closed at block {} (head {height}); absent on {absent_votes} providers",
                            tx.valid_until_height
                        ),
                    },
                )
                .await?;
            return Ok(Step::Continue);
        }
        let age = tx
            .broadcast_at
            .map(|at| (Utc::now() - at).to_std().unwrap_or_default())
            .unwrap_or_default();
        Ok(Step::Wait(reconcile_backoff(age), None))
    }

    /// Terminal outcome when the operation can no longer succeed: the user's
    /// delegate action expired (any step; the relay would fail on chain), or
    /// the operation has been unresolved for longer than any step may take.
    async fn expired_outcome(
        &self,
        operation: &RelayOperation,
        plan: &RelayPlan,
        known_height: Option<u64>,
    ) -> Result<Option<OperationOutcome>, EngineError> {
        if let Some(max_block_height) = plan.delegate_max_block_height {
            let height = match known_height {
                Some(height) => height,
                None => self
                    .rpc
                    .block_height()
                    .await
                    .map_err(EngineError::Transient)?,
            };
            if height > max_block_height {
                return Ok(Some(OperationOutcome::Failed {
                    failure_code: FailureCode::DelegateExpired,
                    reason: format!(
                        "delegate action expired at block {max_block_height} (head {height}) before the relay was confirmed"
                    ),
                }));
            }
        }
        if Utc::now() - operation.created_at > OPERATION_MAX_AGE {
            return Ok(Some(OperationOutcome::ManualReview {
                reason: format!(
                    "unresolved {} minutes after submission",
                    OPERATION_MAX_AGE.num_minutes()
                ),
            }));
        }
        Ok(None)
    }

    async fn settle_landed(
        &self,
        lease: &OperationLease,
        plan: &RelayPlan,
        tx: &RelayTransaction,
        result: &Value,
    ) -> Result<Step, EngineError> {
        if let Some(landed_hash) = result.pointer("/transaction/hash").and_then(Value::as_str)
            && landed_hash != tx.tx_hash
        {
            return Err(EngineError::Invariant(format!(
                "outcome for {landed_hash} returned while reconciling {}",
                tx.tx_hash
            )));
        }
        let store = self.store();
        match read_send_tx_result(result, plan.treasury_id.as_str(), &tx.tx_hash) {
            Ok(outcome) => {
                if tx.state != TransactionState::Succeeded {
                    store
                        .settle_transaction(lease, tx.id, &TransactionOutcome::Succeeded)
                        .await?;
                }
                if tx.step_key.is_relay() {
                    Ok(Step::Done(
                        OperationOutcome::Succeeded {
                            proposal_ids: outcome
                                .proposal_ids
                                .iter()
                                .map(|id| *id as i64)
                                .collect(),
                        },
                        Some(outcome.debug),
                    ))
                } else {
                    Ok(Step::Continue)
                }
            }
            Err(failure) => {
                store
                    .settle_transaction(
                        lease,
                        tx.id,
                        &TransactionOutcome::Failed {
                            reason: failure.message.clone(),
                        },
                    )
                    .await?;
                let failure_code = if tx.step_key.is_relay() {
                    FailureCode::OnChain(failure.reason)
                } else {
                    FailureCode::SponsorStepFailed
                };
                Ok(Step::Done(
                    OperationOutcome::Failed {
                        failure_code,
                        reason: failure.message,
                    },
                    None,
                ))
            }
        }
    }

    /// Commit the terminal state with its accounting, then publish it.
    async fn finish(
        &self,
        operation: &RelayOperation,
        lease: &OperationLease,
        outcome: OperationOutcome,
        outcome_debug: Option<String>,
        plan: Option<&RelayPlan>,
    ) -> RunOutcome {
        let committed: Result<(), RelayStoreError> = async {
            let mut tx = self.state.db_pool.begin().await?;
            RelayStore::complete_operation(&mut tx, lease, &outcome).await?;
            self.account(&mut tx, operation, &outcome).await?;
            tx.commit().await?;
            Ok(())
        }
        .await;
        match committed {
            Ok(()) => {}
            Err(RelayStoreError::LeaseLost) => {
                return RunOutcome::Pending(self.reload(operation).await);
            }
            Err(error) => {
                error_event!(
                    ErrorCode::RelaySubmissionStateWriteFailed,
                    submission_id = %operation.id,
                    treasury_id = %operation.treasury_id,
                    state = %outcome.state(),
                    error = %error
                );
                return self
                    .release(
                        operation,
                        lease,
                        Duration::from_secs(2),
                        Some(format!("completion not committed: {error}")),
                    )
                    .await;
            }
        }
        note_progress();
        let updated = self.reload(operation).await;
        let transactions = self
            .store()
            .transactions_of(operation.id)
            .await
            .unwrap_or_default();
        let status = RelaySubmissionStatus::from_rows(&updated, &transactions);
        self.log_outcome(&updated, &outcome, &status);
        if let (OperationOutcome::Succeeded { .. }, Some(plan), Some(debug)) =
            (&outcome, plan, outcome_debug.as_deref())
        {
            confidential::spawn_auto_submit_intents(
                &self.state,
                updated.treasury_id.as_str(),
                plan.dao_operation.confidential_payloads_with_ids(),
                debug,
            );
        }
        self.state.publish_relay_submission_updated(status);
        RunOutcome::Terminal(updated)
    }

    /// Credit, sponsor spend and platform metrics, on the completion
    /// transaction so they happen exactly once.
    async fn account(
        &self,
        conn: &mut PgConnection,
        operation: &RelayOperation,
        outcome: &OperationOutcome,
    ) -> Result<(), RelayStoreError> {
        let treasury_id = operation.treasury_id.as_str();
        let succeeded = matches!(outcome, OperationOutcome::Succeeded { .. });
        if operation.credit_reserved && !succeeded {
            sqlx::query(
                r#"
                UPDATE monitored_accounts
                SET gas_covered_transactions = gas_covered_transactions + 1, updated_at = NOW()
                WHERE account_id = $1
                "#,
            )
            .bind(treasury_id)
            .execute(&mut *conn)
            .await?;
        }
        let spend = RelayStore::spend_of_succeeded(conn, operation.id).await?;
        if !spend.is_zero() {
            sqlx::query(
                r#"
                UPDATE monitored_accounts
                SET paid_near = paid_near + $2, updated_at = NOW()
                WHERE account_id = $1
                "#,
            )
            .bind(treasury_id)
            .bind(&spend)
            .execute(&mut *conn)
            .await?;
        }
        if succeeded {
            let metrics = relay_metrics(
                operation.proposal_type.as_deref(),
                operation.address_book_payment,
            );
            platform_metrics::record_events_on(&mut *conn, treasury_id, &metrics).await?;
        }
        Ok(())
    }

    fn log_outcome(
        &self,
        operation: &RelayOperation,
        outcome: &OperationOutcome,
        status: &RelaySubmissionStatus,
    ) {
        match outcome {
            OperationOutcome::Succeeded { proposal_ids } => tracing::info!(
                submission_id = %operation.id,
                treasury_id = %operation.treasury_id,
                tx_hash = ?status.tx_hash,
                proposal_ids = ?proposal_ids,
                "relay operation succeeded"
            ),
            OperationOutcome::Failed {
                failure_code,
                reason,
            } => {
                let api_error = failure_code.api_error(status.tx_hash.clone());
                if api_error.is_alertable() {
                    error_event!(
                        ErrorCode::RelayConfirmedUnexpectedFailure,
                        submission_id = %operation.id,
                        treasury_id = %operation.treasury_id,
                        failure_code = %failure_code.as_text(),
                        tx_hash = ?status.tx_hash,
                        error = %reason
                    );
                } else {
                    tracing::warn!(
                        submission_id = %operation.id,
                        treasury_id = %operation.treasury_id,
                        failure_code = %failure_code.as_text(),
                        tx_hash = ?status.tx_hash,
                        error = %reason,
                        "relay operation failed"
                    );
                }
            }
            OperationOutcome::ManualReview { reason } => error_event!(
                ErrorCode::RelaySubmissionManualReview,
                submission_id = %operation.id,
                treasury_id = %operation.treasury_id,
                tx_hash = ?status.tx_hash,
                error = %reason
            ),
        }
    }

    /// Pending transactions whose operation already ended: settle them once
    /// the chain says, book a late landing's spend, and look at each one no
    /// more than every [`ORPHAN_RECHECK`].
    async fn sweep_orphans(&self) -> usize {
        let store = self.store();
        let orphans = match store
            .orphan_pending_transactions(ORPHAN_BATCH, ORPHAN_RECHECK)
            .await
        {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!(error = %error, "relay orphan sweep could not read");
                return 0;
            }
        };
        let checks = orphans.iter().map(|tx| self.sweep_orphan(tx));
        futures::future::join_all(checks)
            .await
            .into_iter()
            .filter(|settled| *settled)
            .count()
    }

    async fn sweep_orphan(&self, tx: &RelayTransaction) -> bool {
        let outcome = match self.orphan_outcome(tx).await {
            Some(outcome) => outcome,
            None => {
                if let Err(error) = self.store().touch_orphan_transaction(tx.id).await {
                    tracing::warn!(tx_hash = %tx.tx_hash, error = %error, "relay orphan touch failed");
                }
                return false;
            }
        };
        match self.settle_orphan(tx, &outcome).await {
            Ok(()) => true,
            Err(error) => {
                tracing::warn!(tx_hash = %tx.tx_hash, error = %error, "relay orphan settle failed");
                false
            }
        }
    }

    async fn orphan_outcome(&self, tx: &RelayTransaction) -> Option<TransactionOutcome> {
        let landed = |result: &Value| match read_send_tx_result(result, "", &tx.tx_hash) {
            Ok(_) => TransactionOutcome::Succeeded,
            Err(failure) => TransactionOutcome::Failed {
                reason: failure.message,
            },
        };
        let absent_votes = match self.rpc.status(&self.state.signer_id, &tx.tx_hash).await {
            StatusOutcome::Landed(result) => return Some(landed(&result)),
            StatusOutcome::Known(_) => return None,
            StatusOutcome::Unknown { absent_votes, .. } => absent_votes,
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(&tx.signed_tx);
        match self.rpc.send(&encoded).await {
            SendOutcome::Landed(result) => Some(landed(&result)),
            SendOutcome::Rejected(message)
                if absent_votes > 0 && is_expired_rejection(&message) =>
            {
                Some(TransactionOutcome::Superseded { reason: message })
            }
            _ => {
                let past_validity = self
                    .rpc
                    .block_height()
                    .await
                    .is_ok_and(|height| height as i64 > tx.valid_until_height);
                (past_validity && absent_votes >= self.rpc.absence_quorum()).then(|| {
                    TransactionOutcome::Superseded {
                        reason: "validity window closed, absent everywhere".to_owned(),
                    }
                })
            }
        }
    }

    async fn settle_orphan(
        &self,
        tx: &RelayTransaction,
        outcome: &TransactionOutcome,
    ) -> Result<(), RelayStoreError> {
        let mut db = self.state.db_pool.begin().await?;
        sqlx::query(
            r#"
            UPDATE relay_transactions t
            SET state = $2, updated_at = NOW()
            FROM relay_operations o
            WHERE t.id = $1 AND o.id = t.operation_id AND o.state <> 'pending' AND t.state = 'pending'
            "#,
        )
        .bind(tx.id)
        .bind(outcome.state())
        .execute(&mut *db)
        .await?;
        if matches!(outcome, TransactionOutcome::Succeeded) && !tx.spend_yocto.is_zero() {
            sqlx::query(
                r#"
                UPDATE monitored_accounts m
                SET paid_near = m.paid_near + $2, updated_at = NOW()
                FROM relay_operations o
                WHERE o.id = $1 AND m.account_id = o.treasury_id
                "#,
            )
            .bind(tx.operation_id)
            .bind(&tx.spend_yocto)
            .execute(&mut *db)
            .await?;
        }
        db.commit().await?;
        Ok(())
    }

    fn check_stalls(&self, health: &super::models::RelayQueueHealth) {
        let now = Instant::now();
        let mut stalls = STALLS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let progress = PROGRESS.load(Ordering::Relaxed);
        if progress != stalls.last_progress_seen {
            stalls.last_progress_seen = progress;
            stalls.last_progress_at = now;
        }
        let cooled = |last: Option<Instant>| {
            last.is_none_or(|at| now.duration_since(at) >= STALL_ALERT_COOLDOWN)
        };
        if health.oldest_pending_seconds.unwrap_or(0) > RECONCILIATION_STALL
            && cooled(stalls.last_reconciliation_alert)
        {
            stalls.last_reconciliation_alert = Some(now);
            error_event!(
                ErrorCode::RelayReconciliationStalled,
                oldest_pending_seconds = health.oldest_pending_seconds.unwrap_or(0),
                pending_transactions = health.pending_transactions
            );
        }
        if health.pending_operations > 0
            && now.duration_since(stalls.last_progress_at) >= QUEUE_STALL
            && cooled(stalls.last_queue_alert)
        {
            stalls.last_queue_alert = Some(now);
            error_event!(
                ErrorCode::RelayQueueStalled,
                pending_operations = health.pending_operations,
                stalled_seconds = now.duration_since(stalls.last_progress_at).as_secs()
            );
        }
    }
}

enum RegistrationPlan {
    None,
    TooMany(usize),
    Sign {
        step: StepKey,
        token: AccountId,
        accounts: Vec<AccountId>,
    },
}

fn storage_deposit_action(account_id: &AccountId) -> Result<ProtocolAction, String> {
    let args = serde_json::to_vec(&serde_json::json!({
        "account_id": account_id,
        "registration_only": true,
    }))
    .map_err(|error| error.to_string())?;
    Ok(ProtocolAction::FunctionCall(Box::new(
        ProtocolFunctionCall {
            method_name: "storage_deposit".to_owned(),
            args,
            gas: near_primitives::gas::Gas::from_gas(STORAGE_DEPOSIT_GAS.as_gas()),
            deposit: STORAGE_DEPOSIT_AMOUNT,
        },
    )))
}

/// The same counters the inline path records on success.
pub fn relay_metrics(
    proposal_type: Option<&str>,
    address_book_payment: bool,
) -> Vec<PlatformMetric> {
    let mut metrics = vec![PlatformMetric::GasCoveredTransactions];
    match proposal_type {
        Some("swap") => metrics.push(PlatformMetric::SwapProposals),
        Some("payment") => metrics.push(PlatformMetric::PaymentProposals),
        Some("vote") => metrics.push(PlatformMetric::VotesCasted),
        Some(_) => metrics.push(PlatformMetric::OtherProposalsSubmitted),
        None => {}
    }
    if address_book_payment && proposal_type == Some("payment") {
        metrics.push(PlatformMetric::AddressBookPaymentProposals);
    }
    metrics
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_with_age_and_stays_bounded() {
        let young = reconcile_backoff(Duration::from_secs(1));
        assert!(young >= Duration::from_secs(1) && young < Duration::from_millis(1300));
        let old = reconcile_backoff(Duration::from_secs(600));
        assert!(old >= Duration::from_secs(30) && old < Duration::from_secs(37));
    }

    #[test]
    fn metrics_match_the_inline_path() {
        assert_eq!(
            relay_metrics(Some("payment"), true),
            vec![
                PlatformMetric::GasCoveredTransactions,
                PlatformMetric::PaymentProposals,
                PlatformMetric::AddressBookPaymentProposals
            ]
        );
        assert_eq!(
            relay_metrics(None, true),
            vec![PlatformMetric::GasCoveredTransactions]
        );
    }

    #[test]
    fn sponsored_actions_convert_to_protocol_actions() {
        let actions = vec![
            near_api::types::Action::FunctionCall(Box::new(
                near_api::types::transaction::actions::FunctionCallAction {
                    method_name: "w_execute_signed".to_owned(),
                    args: vec![1],
                    gas: near_api::NearGas::from_tgas(10),
                    deposit: NearToken::from_yoctonear(1),
                },
            )),
            near_api::types::Action::Transfer(
                near_api::types::transaction::actions::TransferAction {
                    deposit: NearToken::from_yoctonear(5),
                },
            ),
        ];
        let converted = protocol_actions(&actions).unwrap();
        assert!(
            matches!(&converted[0], ProtocolAction::FunctionCall(call) if call.method_name == "w_execute_signed")
        );
        assert!(
            matches!(&converted[1], ProtocolAction::Transfer(transfer) if transfer.deposit.as_yoctonear() == 5)
        );
    }
}

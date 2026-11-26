//! One sponsor transaction, from signature to proof: sign on a free lane and
//! commit the bytes, broadcast, look the hash up, resend the same bytes while
//! nobody has them, and replace it only once it is proven unable to land.

use std::{
    collections::HashSet,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use base64::Engine as _;
use bigdecimal::BigDecimal;
use chrono::Utc;
use near_api::{AccountId, NearToken};
use near_primitives::{
    action::Action as ProtocolAction,
    hash::CryptoHash as ProtocolHash,
    transaction::{Transaction as ProtocolTransaction, TransactionV0},
};
use rand::Rng;
use serde_json::Value;

use crate::{
    error_event,
    error_event::ErrorCode,
    handlers::relay::post_quantum::{protocol_account, read_send_tx_result},
};

use super::{
    super::{
        models::{
            FailureCode, PreparedTransaction, RelayTransaction, StepKey, TransactionOutcome,
            TransactionState,
        },
        rpc::{SendOutcome, StatusOutcome, is_expired_rejection},
    },
    StageContext, StageError, StageResult,
};

/// Mainnet `transaction_validity_period`: a block hash older than this can no
/// longer anchor a transaction.
const TRANSACTION_VALIDITY_BLOCKS: u64 = 86_400;
const LANE_WAIT: Duration = Duration::from_millis(300);
/// How long one stage call waits in line for a signing turn before it goes
/// back to the engine loop (which renews the lease) and lines up again.
const LANE_TURN_WAIT: Duration = Duration::from_secs(15);

/// Lanes already reported as missing their access key on chain.
static MISSING_LANES: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);

pub struct NewTransaction {
    pub step: StepKey,
    pub receiver: AccountId,
    pub actions: Vec<ProtocolAction>,
    pub spend: NearToken,
}

/// The chain's final word on a transaction.
pub enum Finality {
    Succeeded(Value),
    Failed { message: String },
}

/// Where a transaction is after one look at it.
pub enum TxProgress {
    Final(Finality),
    /// Every provider refused the bytes before any of them took them.
    NotSent(String),
    /// Proven unable to land; its step is free to be signed again.
    Superseded,
    /// The user's delegate action expired while a sponsor step was in flight.
    DelegateExpired(String),
    Wait(Duration, Option<String>),
}

impl TxProgress {
    /// The final outcome, or the stage result for everything short of one.
    pub fn finality(self) -> Result<Finality, StageResult> {
        match self {
            Self::Final(finality) => Ok(finality),
            Self::NotSent(reason) => Err(StageResult::failed(FailureCode::NotSent, reason)),
            Self::Superseded => Err(StageResult::again()),
            Self::DelegateExpired(reason) => {
                Err(StageResult::failed(FailureCode::DelegateExpired, reason))
            }
            Self::Wait(after, note) => Err(StageResult::NotReady(after, note)),
        }
    }
}

/// Delay before looking at a pending transaction again: half its age, within
/// one second and thirty, with a little jitter so holders do not align.
fn reconcile_backoff(age: Duration) -> Duration {
    let base = (age.as_secs_f64() / 2.0).clamp(1.0, 30.0);
    let jitter = rand::rng().random_range(0.0..0.2);
    Duration::from_secs_f64(base * (1.0 + jitter))
}

/// The step's transaction that is signed or sent and not yet final.
pub fn in_flight(
    transactions: &[RelayTransaction],
    is_step: impl Fn(&StepKey) -> bool,
) -> Option<&RelayTransaction> {
    transactions.iter().find(|tx| {
        is_step(&tx.step_key)
            && matches!(
                tx.state,
                TransactionState::Prepared | TransactionState::Pending
            )
    })
}

/// Sign `new` on a free lane and commit it as `prepared`. Chain reads happen
/// before the lane is locked, so no database transaction waits on a provider.
pub async fn sign(ctx: &StageContext<'_>, new: NewTransaction) -> Result<StageResult, StageError> {
    let store = ctx.store();
    let lanes = &ctx.state.relay_lanes;
    if !ctx.has_lane_turn() {
        match lanes.turn(LANE_TURN_WAIT).await {
            Some(turn) => ctx.hold_lane_turn(turn),
            None => {
                return Ok(StageResult::NotReady(
                    Duration::ZERO,
                    Some("waiting in line for a sponsor lane".to_owned()),
                ));
            }
        }
    }
    let candidates = store.free_lane_candidates(&lanes.rotation()).await?;
    let mut read_errors = Vec::new();
    let mut taken = candidates.is_empty();
    for public_key in candidates {
        let lane = lanes
            .get(&public_key)
            .ok_or_else(|| StageError::Invariant(format!("unknown lane {public_key}")))?;
        let snapshot = match ctx
            .rpc
            .access_key(&ctx.state.signer_id, &lane.api_public_key)
            .await
        {
            Ok(snapshot) => snapshot,
            Err(error) => {
                report_missing_lane(&public_key, &error);
                read_errors.push(error);
                continue;
            }
        };
        let Some(claim) = store.claim_lane(&public_key).await? else {
            taken = true;
            continue;
        };
        let floor = claim.nonce_floor.unwrap_or(0).max(0) as u64;
        let nonce = snapshot.nonce.max(floor) + 1;
        let transaction = ProtocolTransaction::V0(TransactionV0 {
            signer_id: protocol_account(&ctx.state.signer_id).map_err(StageError::Invariant)?,
            public_key: lane.protocol_public_key(),
            nonce,
            receiver_id: protocol_account(&new.receiver).map_err(StageError::Invariant)?,
            block_hash: ProtocolHash(snapshot.block_hash),
            actions: new.actions,
        });
        let signed = lane.sign(transaction);
        let prepared = PreparedTransaction {
            step_key: new.step,
            public_key,
            nonce: nonce as i64,
            valid_until_height: (snapshot.block_height + TRANSACTION_VALIDITY_BLOCKS) as i64,
            tx_hash: signed.get_hash().to_string(),
            signed_tx: borsh::to_vec(&signed)
                .map_err(|error| StageError::Invariant(format!("serialize signed tx: {error}")))?,
            spend_yocto: BigDecimal::from(new.spend.as_yoctonear()),
        };
        return match claim.commit_prepared(ctx.lease, prepared).await {
            Ok(_) => Ok(StageResult::again()),
            Err(error) if error.is_unique_violation() => Err(StageError::Invariant(format!(
                "nonce, hash or step already committed: {error}"
            ))),
            Err(error) => Err(error.into()),
        };
    }
    if taken || read_errors.is_empty() {
        return Ok(StageResult::NotReady(
            LANE_WAIT,
            Some("all sponsor lanes busy".to_owned()),
        ));
    }
    Err(StageError::Transient(read_errors.join("; ")))
}

/// A lane whose key is gone from the sponsor account can never sign; say so
/// once and let the other lanes carry on.
fn report_missing_lane(public_key: &str, error: &str) {
    let lowered = error.to_lowercase();
    if !(lowered.contains("unknownaccesskey") || lowered.contains("does not exist")) {
        return;
    }
    let first = MISSING_LANES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(public_key.to_owned());
    if first {
        error_event!(
            ErrorCode::RelaySubmissionInvariantBroken,
            lane = %public_key,
            error = %format!("sponsor lane key is not on the sponsor account: {error}")
        );
    }
}

/// Take a transaction that is `prepared` or `pending` one step further.
pub async fn drive(
    ctx: &StageContext<'_>,
    tx: &RelayTransaction,
) -> Result<TxProgress, StageError> {
    let progress = match tx.state {
        TransactionState::Prepared => broadcast(ctx, tx).await,
        _ => reconcile(ctx, tx).await,
    }?;
    if !matches!(progress, TxProgress::Wait(..)) {
        ctx.end_lane_turn();
    }
    Ok(progress)
}

async fn broadcast(
    ctx: &StageContext<'_>,
    tx: &RelayTransaction,
) -> Result<TxProgress, StageError> {
    let store = ctx.store();
    store.mark_broadcast(ctx.lease, tx.id).await?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&tx.signed_tx);
    match ctx.rpc.send(&encoded).await {
        SendOutcome::Landed(result) => landed(ctx, tx, result).await,
        SendOutcome::Rejected(message) => {
            store
                .settle_transaction(
                    ctx.lease,
                    tx.id,
                    &TransactionOutcome::Failed {
                        reason: message.clone(),
                    },
                )
                .await?;
            Ok(TxProgress::NotSent(message))
        }
        SendOutcome::Unknown(message) | SendOutcome::Unreachable(message) => {
            store
                .record_transaction_error(ctx.lease, tx.id, &message)
                .await?;
            Ok(TxProgress::Wait(Duration::from_secs(1), Some(message)))
        }
    }
}

/// A sent transaction ends only on proof. The user's delegate action expiring
/// ends a sponsor step, whose bytes the orphan sweep then accounts for; it
/// never ends the relay itself, which may already be in a block.
async fn reconcile(
    ctx: &StageContext<'_>,
    tx: &RelayTransaction,
) -> Result<TxProgress, StageError> {
    let store = ctx.store();
    let absent_votes = match ctx.rpc.status(&ctx.state.signer_id, &tx.tx_hash).await {
        StatusOutcome::Landed(result) => return landed(ctx, tx, result).await,
        StatusOutcome::Known(stage) => {
            return Ok(TxProgress::Wait(Duration::from_secs(1), Some(stage)));
        }
        StatusOutcome::Unknown { absent_votes, .. } => absent_votes,
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&tx.signed_tx);
    match ctx.rpc.send(&encoded).await {
        SendOutcome::Landed(result) => return landed(ctx, tx, result).await,
        SendOutcome::Rejected(message) if absent_votes > 0 && is_expired_rejection(&message) => {
            store
                .settle_transaction(
                    ctx.lease,
                    tx.id,
                    &TransactionOutcome::Superseded { reason: message },
                )
                .await?;
            return Ok(TxProgress::Superseded);
        }
        SendOutcome::Rejected(message)
        | SendOutcome::Unknown(message)
        | SendOutcome::Unreachable(message) => {
            store
                .record_transaction_error(ctx.lease, tx.id, &message)
                .await?;
        }
    }
    let height = ctx
        .rpc
        .block_height()
        .await
        .map_err(StageError::Transient)?;
    if !tx.step_key.is_relay()
        && let Some(max_block_height) = ctx.plan.delegate_max_block_height
        && height > max_block_height
    {
        return Ok(TxProgress::DelegateExpired(format!(
            "delegate action expired at block {max_block_height} (head {height}) before the relay was sent"
        )));
    }
    if height as i64 > tx.valid_until_height && absent_votes >= ctx.rpc.absence_quorum() {
        store
            .settle_transaction(
                ctx.lease,
                tx.id,
                &TransactionOutcome::Superseded {
                    reason: format!(
                        "validity window closed at block {} (head {height}); absent on {absent_votes} providers",
                        tx.valid_until_height
                    ),
                },
            )
            .await?;
        return Ok(TxProgress::Superseded);
    }
    let age = tx
        .broadcast_at
        .map(|at| (Utc::now() - at).to_std().unwrap_or_default())
        .unwrap_or_default();
    Ok(TxProgress::Wait(reconcile_backoff(age), None))
}

async fn landed(
    ctx: &StageContext<'_>,
    tx: &RelayTransaction,
    result: Value,
) -> Result<TxProgress, StageError> {
    verify_hash(tx, &result)?;
    let store = ctx.store();
    match read_send_tx_result(&result, ctx.plan.treasury_id.as_str()) {
        Ok(_) => {
            store
                .settle_transaction(ctx.lease, tx.id, &TransactionOutcome::Succeeded)
                .await?;
            Ok(TxProgress::Final(Finality::Succeeded(result)))
        }
        Err(failure) => {
            store
                .settle_transaction(
                    ctx.lease,
                    tx.id,
                    &TransactionOutcome::Failed {
                        reason: failure.message.clone(),
                    },
                )
                .await?;
            Ok(TxProgress::Final(Finality::Failed {
                message: failure.message,
            }))
        }
    }
}

/// An outcome is only ever attributed to the transaction it was asked for.
pub fn verify_hash(tx: &RelayTransaction, result: &Value) -> Result<(), StageError> {
    match result.pointer("/transaction/hash").and_then(Value::as_str) {
        Some(landed_hash) if landed_hash != tx.tx_hash => Err(StageError::Invariant(format!(
            "outcome for {landed_hash} returned while reconciling {}",
            tx.tx_hash
        ))),
        _ => Ok(()),
    }
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
}

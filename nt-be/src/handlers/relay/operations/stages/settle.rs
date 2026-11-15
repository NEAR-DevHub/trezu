//! Last stage: the relay transaction is final on chain. Read its outcome by
//! hash and decide how the operation ends. Nothing is signed here, so a crash
//! or a retry can only read again.

use serde_json::Value;

use crate::handlers::relay::{confidential, post_quantum::read_send_tx_result};

use super::{
    super::{
        models::{FailureCode, OperationOutcome, RelayTransaction, TransactionState},
        rpc::StatusOutcome,
    },
    Completion, ExecutedIntent, ProposedIntent, Stage, StageContext, StageError, StageResult,
    transaction::verify_hash,
};

pub struct Settle;

impl Settle {
    /// The relay outcome: the one this run just saw land, else read by hash.
    async fn outcome(
        ctx: &StageContext<'_>,
        relay: &RelayTransaction,
    ) -> Result<Result<Value, StageResult>, StageError> {
        let seen = ctx
            .landed_relay
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(result) = seen {
            return Ok(Ok(result));
        }
        match ctx.rpc.status(&ctx.state.signer_id, &relay.tx_hash).await {
            StatusOutcome::Landed(result) => Ok(Ok(result)),
            StatusOutcome::Known(stage) => Ok(Err(StageResult::NotReady(
                std::time::Duration::from_secs(1),
                Some(format!("landed relay not final yet: {stage}")),
            ))),
            // Refused before any provider took it, and the operation did not
            // end before the process stopped.
            StatusOutcome::Unknown { absent_votes, .. }
                if relay.state == TransactionState::Failed
                    && absent_votes >= ctx.rpc.absence_quorum() =>
            {
                Ok(Err(StageResult::failed(
                    FailureCode::NotSent,
                    relay
                        .last_error
                        .clone()
                        .unwrap_or_else(|| "relay was refused before broadcast".to_owned()),
                )))
            }
            StatusOutcome::Unknown { detail, .. } => Err(StageError::Transient(format!(
                "landed relay {} not readable: {detail}",
                relay.tx_hash
            ))),
        }
    }

    /// The voted confidential payloads whose sign call this transaction made.
    fn executed_intents(
        ctx: &StageContext<'_>,
        relay: &RelayTransaction,
        result: &Value,
    ) -> Vec<ExecutedIntent> {
        ctx.plan
            .dao_operation
            .confidential_payloads_with_ids()
            .into_iter()
            .filter(|(payload_hash, _)| {
                confidential::sign_call_in_transaction(result, payload_hash)
            })
            .map(|(payload_hash, proposal_id)| ExecutedIntent {
                payload_hash,
                proposal_id,
                tx_hash: relay.tx_hash.clone(),
            })
            .collect()
    }
}

impl Settle {
    /// Each confidential proposal this relay created, with the id the DAO gave
    /// it. Paired by position, so only when every proposal returned an id.
    fn proposed_intents(ctx: &StageContext<'_>, proposal_ids: &[u64]) -> Vec<ProposedIntent> {
        let hashes = ctx.plan.dao_operation.new_proposal_payload_hashes();
        if hashes.len() != proposal_ids.len() {
            return Vec::new();
        }
        hashes
            .into_iter()
            .zip(proposal_ids)
            .filter_map(|(payload_hash, proposal_id)| {
                payload_hash.map(|payload_hash| ProposedIntent {
                    payload_hash,
                    proposal_id: *proposal_id,
                })
            })
            .collect()
    }
}

impl Stage for Settle {
    async fn run(&self, ctx: &StageContext<'_>) -> Result<StageResult, StageError> {
        let transactions = ctx.store().transactions_of(ctx.operation.id).await?;
        let relay = transactions
            .iter()
            .find(|tx| {
                tx.step_key.is_relay()
                    && matches!(
                        tx.state,
                        TransactionState::Succeeded | TransactionState::Failed
                    )
            })
            .ok_or_else(|| {
                StageError::Invariant("settle reached without a final relay transaction".to_owned())
            })?;
        let result = match Self::outcome(ctx, relay).await? {
            Ok(result) => result,
            Err(stage_result) => return Ok(stage_result),
        };
        verify_hash(relay, &result)?;
        Ok(
            match read_send_tx_result(&result, ctx.plan.treasury_id.as_str()) {
                Ok(outcome) => StageResult::Done(Completion {
                    outcome: OperationOutcome::Succeeded {
                        proposal_ids: outcome.proposal_ids.iter().map(|id| *id as i64).collect(),
                    },
                    executed_intents: Self::executed_intents(ctx, relay, &result),
                    proposed_intents: Self::proposed_intents(ctx, &outcome.proposal_ids),
                }),
                Err(failure) => {
                    StageResult::failed(FailureCode::OnChain(failure.reason), failure.message)
                }
            },
        )
    }
}

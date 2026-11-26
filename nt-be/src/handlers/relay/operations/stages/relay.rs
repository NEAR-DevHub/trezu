//! Sends the user's signed action in a sponsor-paid transaction. The stage is
//! finished once that transaction is final on chain, whichever way it went;
//! `settle` reads the outcome.

use super::{
    super::models::{OperationStage, StepKey, TransactionState},
    Stage, StageContext, StageError, StageResult,
    transaction::{self, Finality, NewTransaction},
};

pub struct Relay;

impl Stage for Relay {
    async fn run(&self, ctx: &StageContext<'_>) -> Result<StageResult, StageError> {
        let transactions = ctx.store().transactions_of(ctx.operation.id).await?;
        if let Some(tx) = transaction::in_flight(&transactions, StepKey::is_relay) {
            return Ok(match transaction::drive(ctx, tx).await?.finality() {
                Ok(Finality::Succeeded(result)) => {
                    *ctx.landed_relay
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(result);
                    StageResult::Advance(OperationStage::Settle)
                }
                Ok(Finality::Failed { .. }) => StageResult::Advance(OperationStage::Settle),
                Err(result) => result,
            });
        }
        // Final already, and the advance did not commit.
        if transactions.iter().any(|tx| {
            tx.step_key.is_relay()
                && matches!(
                    tx.state,
                    TransactionState::Succeeded | TransactionState::Failed
                )
        }) {
            return Ok(StageResult::Advance(OperationStage::Settle));
        }
        if let Some(outcome) = ctx.unsendable(0).await? {
            return Ok(StageResult::done(outcome));
        }
        let (receiver, actions) = ctx
            .plan
            .relay_transaction(&ctx.operation.submission_payload)
            .map_err(StageError::Invariant)?;
        transaction::sign(
            ctx,
            NewTransaction {
                step: StepKey::Relay,
                receiver,
                actions,
                spend: ctx.plan.attached_deposit,
            },
        )
        .await
    }
}

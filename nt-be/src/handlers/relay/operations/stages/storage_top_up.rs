//! Sponsor transfer to the DAO contract for the storage the action adds.

use near_primitives::action::{Action as ProtocolAction, TransferAction};

use super::{
    super::models::{FailureCode, OperationStage, StepKey, TransactionState},
    Stage, StageContext, StageError, StageResult,
    transaction::{self, Finality, NewTransaction},
};

pub struct StorageTopUp;

impl Stage for StorageTopUp {
    async fn run(&self, ctx: &StageContext<'_>) -> Result<StageResult, StageError> {
        let next = ctx.plan.stage_after(OperationStage::StorageTopUp);
        if ctx.plan.storage_cost.as_yoctonear() == 0 {
            return Ok(StageResult::Advance(next));
        }
        let is_top_up = |step: &StepKey| *step == StepKey::StorageTopUp;
        let transactions = ctx.store().transactions_of(ctx.operation.id).await?;
        if let Some(tx) = transaction::in_flight(&transactions, is_top_up) {
            return Ok(match transaction::drive(ctx, tx).await?.finality() {
                Ok(Finality::Succeeded(_)) => StageResult::Advance(next),
                Ok(Finality::Failed { message, .. }) => {
                    StageResult::failed(FailureCode::SponsorStepFailed, message)
                }
                Err(result) => result,
            });
        }
        let settled = |state: TransactionState| {
            transactions
                .iter()
                .any(|tx| is_top_up(&tx.step_key) && tx.state == state)
        };
        if settled(TransactionState::Succeeded) {
            return Ok(StageResult::Advance(next));
        }
        if settled(TransactionState::Failed) {
            return Ok(StageResult::failed(
                FailureCode::SponsorStepFailed,
                "storage top-up failed",
            ));
        }
        if let Some(outcome) = ctx.unsendable(0).await? {
            return Ok(StageResult::done(outcome));
        }
        transaction::sign(
            ctx,
            NewTransaction {
                step: StepKey::StorageTopUp,
                receiver: ctx.plan.treasury_id.clone(),
                actions: vec![ProtocolAction::Transfer(TransferAction {
                    deposit: ctx.plan.storage_cost,
                })],
                spend: ctx.plan.storage_cost,
            },
        )
        .await
    }
}

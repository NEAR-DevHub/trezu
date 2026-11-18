//! Sponsor-paid NEP-141 `storage_deposit`s for the recipients of the
//! proposals an approving vote executes, one batch transaction at a time.

use std::collections::{BTreeMap, HashSet};

use near_api::AccountId;
use near_primitives::action::{Action as ProtocolAction, FunctionCallAction};

use crate::handlers::{
    relay::effects::{
        allowlist,
        registrations::{self, MAX_STORAGE_DEPOSITS, STORAGE_DEPOSIT_AMOUNT, STORAGE_DEPOSIT_GAS},
    },
    token::storage_deposit::is_registered::check_storage_deposit,
};

use super::{
    super::models::{FailureCode, OperationStage, StepKey, TransactionState},
    Stage, StageContext, StageError, StageResult,
    transaction::{self, Finality, NewTransaction},
};

const REGISTRATION_BATCH: usize = 50;

pub struct Registrations;

enum NextBatch {
    None,
    TooMany(usize),
    Sign {
        step: StepKey,
        token: AccountId,
        accounts: Vec<AccountId>,
    },
}

impl Registrations {
    /// The first batch that still has an unregistered account. A lookup that
    /// fails on the provider is an error: relaying the vote without knowing
    /// its recipients would let the payment fail on chain.
    async fn next_batch(
        ctx: &StageContext<'_>,
        done: &HashSet<StepKey>,
    ) -> Result<NextBatch, StageError> {
        let mut targets = HashSet::new();
        for proposal_id in ctx.plan.dao_operation.vote_approve_ids() {
            targets.extend(
                registrations::derive_targets_for_proposal(
                    ctx.state,
                    &ctx.plan.treasury_id,
                    proposal_id,
                )
                .await
                .map_err(|failed| StageError::Transient(failed.0))?,
            );
        }
        if targets.is_empty() {
            return Ok(NextBatch::None);
        }
        let allowlist = allowlist::storage_allowlist(ctx.state).await;
        let mut by_token: BTreeMap<AccountId, Vec<AccountId>> = BTreeMap::new();
        for target in targets {
            if allowlist
                .sponsors(target.token_id.as_str())
                .map_err(StageError::Transient)?
            {
                by_token
                    .entry(target.token_id)
                    .or_default()
                    .push(target.account_id);
            }
        }
        let total: usize = by_token.values().map(Vec::len).sum();
        if total > MAX_STORAGE_DEPOSITS {
            return Ok(NextBatch::TooMany(total));
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
                    match check_storage_deposit(ctx.state, account.clone(), token.clone()).await {
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
                return Ok(NextBatch::Sign {
                    step,
                    token,
                    accounts: unregistered,
                });
            }
        }
        Ok(NextBatch::None)
    }
}

fn storage_deposit_action(account_id: &AccountId) -> Result<ProtocolAction, String> {
    let args = serde_json::to_vec(&serde_json::json!({
        "account_id": account_id,
        "registration_only": true,
    }))
    .map_err(|error| error.to_string())?;
    Ok(ProtocolAction::FunctionCall(Box::new(FunctionCallAction {
        method_name: "storage_deposit".to_owned(),
        args,
        gas: near_primitives::gas::Gas::from_gas(STORAGE_DEPOSIT_GAS.as_gas()),
        deposit: STORAGE_DEPOSIT_AMOUNT,
    })))
}

impl Stage for Registrations {
    async fn run(&self, ctx: &StageContext<'_>) -> Result<StageResult, StageError> {
        let is_registration = |step: &StepKey| matches!(step, StepKey::Registration { .. });
        let transactions = ctx.store().transactions_of(ctx.operation.id).await?;
        if let Some(tx) = transaction::in_flight(&transactions, is_registration) {
            return Ok(match transaction::drive(ctx, tx).await?.finality() {
                Ok(Finality::Succeeded(_)) => StageResult::again(),
                Ok(Finality::Failed { message, .. }) => {
                    StageResult::failed(FailureCode::SponsorStepFailed, message)
                }
                Err(result) => result,
            });
        }
        if transactions
            .iter()
            .any(|tx| is_registration(&tx.step_key) && tx.state == TransactionState::Failed)
        {
            return Ok(StageResult::failed(
                FailureCode::SponsorStepFailed,
                "token registration failed",
            ));
        }
        // Nothing is in flight, so an operation that may no longer be sent
        // ends here instead of retrying its lookups for ever.
        if let Some(outcome) = ctx.unsendable(0).await? {
            return Ok(StageResult::done(outcome));
        }
        let done: HashSet<StepKey> = transactions
            .iter()
            .filter(|tx| tx.state == TransactionState::Succeeded)
            .map(|tx| tx.step_key.clone())
            .collect();
        match Self::next_batch(ctx, &done).await? {
            NextBatch::None => Ok(StageResult::Advance(
                ctx.plan.stage_after(OperationStage::Registrations),
            )),
            NextBatch::TooMany(count) => Ok(StageResult::failed(
                FailureCode::SponsorStepFailed,
                format!(
                    "too many storage_deposit registrations required ({count} > {MAX_STORAGE_DEPOSITS})"
                ),
            )),
            NextBatch::Sign {
                step,
                token,
                accounts,
            } => {
                let actions = accounts
                    .iter()
                    .map(storage_deposit_action)
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(StageError::Invariant)?;
                transaction::sign(
                    ctx,
                    NewTransaction {
                        step,
                        receiver: token,
                        actions,
                        spend: STORAGE_DEPOSIT_AMOUNT.saturating_mul(accounts.len() as u128),
                    },
                )
                .await
            }
        }
    }
}

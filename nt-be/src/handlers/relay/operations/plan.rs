//! The parsed payload of an operation: everything the stages need, derived
//! again from the stored bytes on every run so nothing but the row has to
//! survive a crash.

use borsh::BorshDeserialize;
use near_api::{AccountId, NearToken};
use near_primitives::{
    action::{
        Action as ProtocolAction, FunctionCallAction as ProtocolFunctionCall, TransferAction,
        delegate::SignedDelegateAction as ProtocolSignedDelegate,
    },
    types::AccountId as ProtocolAccountId,
};

use crate::handlers::relay::{
    parse::{RelayOperation as DaoOperation, RelaySubmission, parse_relay},
    sponsor::policy,
};

use super::models::{OperationStage, RelayOperation};

pub struct RelayPlan {
    pub treasury_id: AccountId,
    pub submission: RelaySubmission,
    pub dao_operation: DaoOperation,
    pub attached_deposit: NearToken,
    pub storage_cost: NearToken,
    pub delegate_max_block_height: Option<u64>,
}

impl RelayPlan {
    pub fn from_operation(operation: &RelayOperation) -> Result<Self, String> {
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

    /// The next stage after `stage` that has work for this payload.
    pub fn stage_after(&self, stage: OperationStage) -> OperationStage {
        let owes_storage = self.storage_cost.as_yoctonear() > 0;
        let approves = !self.dao_operation.vote_approve_ids().is_empty();
        match stage {
            OperationStage::Authorize if owes_storage => OperationStage::StorageTopUp,
            OperationStage::Authorize | OperationStage::StorageTopUp if approves => {
                OperationStage::Registrations
            }
            OperationStage::Authorize
            | OperationStage::StorageTopUp
            | OperationStage::Registrations => OperationStage::Relay,
            OperationStage::Relay | OperationStage::Settle => OperationStage::Settle,
        }
    }

    /// Receiver and actions of the transaction that carries the user's action.
    pub fn relay_transaction(
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::relay::parse::{ActProposal, ProposalInput, WalletReplay};

    fn plan(dao_operation: DaoOperation, storage_cost: NearToken) -> RelayPlan {
        RelayPlan {
            treasury_id: "dao.sputnik-dao.near".parse().unwrap(),
            submission: RelaySubmission::WalletContract(WalletReplay {
                wallet_account: "alice.near".parse().unwrap(),
                actions: Vec::new(),
            }),
            dao_operation,
            attached_deposit: NearToken::from_yoctonear(0),
            storage_cost,
            delegate_max_block_height: None,
        }
    }

    fn vote(action: &str) -> DaoOperation {
        DaoOperation::Votes(vec![ActProposal {
            id: 7,
            action: action.to_owned(),
            kind: None,
        }])
    }

    #[test]
    fn stages_without_work_are_skipped() {
        let add = plan(
            DaoOperation::AddProposals(vec![ProposalInput {
                description: String::new(),
                kind: serde_json::json!({}),
            }]),
            NearToken::from_millinear(1),
        );
        assert_eq!(
            add.stage_after(OperationStage::Authorize),
            OperationStage::StorageTopUp
        );
        assert_eq!(
            add.stage_after(OperationStage::StorageTopUp),
            OperationStage::Relay,
            "adding a proposal registers nobody"
        );

        let approve = plan(vote("VoteApprove"), NearToken::from_millinear(1));
        assert_eq!(
            approve.stage_after(OperationStage::StorageTopUp),
            OperationStage::Registrations
        );
        assert_eq!(
            approve.stage_after(OperationStage::Registrations),
            OperationStage::Relay
        );

        let reject = plan(vote("VoteReject"), NearToken::from_yoctonear(0));
        assert_eq!(
            reject.stage_after(OperationStage::Authorize),
            OperationStage::Relay,
            "nothing owed and nothing approved goes straight to the relay"
        );
        assert_eq!(
            reject.stage_after(OperationStage::Relay),
            OperationStage::Settle
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

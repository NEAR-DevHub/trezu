//! The relayer's signing identity and the sponsor-signed transactions it sends.
//!
//! Every method centralizes retry policy by idempotency class, so retry-safety is a
//! property of the method you call rather than something each call site re-decides:
//!
//! - [`Sponsor::call_idempotent`], [`Sponsor::relay_meta_tx`], [`Sponsor::replay_actions`]
//!   are safe to retry — registrations refund, and meta / `w_execute_signed`
//!   transactions carry on-chain nonces that reject a replay that already landed.
//! - [`Sponsor::transfer_once`] is a bare value transfer with no replay protection,
//!   so it is never retried after broadcast.

pub mod policy;
pub mod retry;

use std::{fmt::Display, future::Future, sync::Arc};

use near_api::{
    AccountId, CryptoHash, NearGas, NearToken, NetworkConfig, Signer, Tokens, Transaction,
    advanced::{ExecuteSignedTransaction, TransactionableOrSigned},
    errors::{ExecuteTransactionError, RetryError, SendRequestError},
    types::{
        Action,
        transaction::{
            actions::FunctionCallAction, delegate_action::SignedDelegateAction,
            result::ExecutionFinalResult,
        },
    },
};
use near_openapi_types::RpcTransactionError;

use crate::{
    AppState,
    utils::api_error::{ApiError, TxFailureReason},
};

use self::retry::{RetryPolicy, retry};

/// The debug string of a transaction's execution outcome, mined later for MPC
/// signatures by `confidential`.
pub type OutcomeDebug = String;

#[derive(Clone)]
pub struct Sponsor {
    signer_id: AccountId,
    signer: Arc<Signer>,
    network: NetworkConfig,
}

impl Sponsor {
    pub fn from_state(state: &AppState) -> Self {
        Self {
            signer_id: state.signer_id.clone(),
            signer: state.signer.clone(),
            network: state.network.clone(),
        }
    }

    /// Send an idempotent function call (e.g. `storage_deposit` with
    /// `registration_only`), retrying transient send failures.
    pub async fn call_idempotent(
        &self,
        receiver: &AccountId,
        method_name: &str,
        args: Vec<u8>,
        gas: NearGas,
        deposit: NearToken,
    ) -> Result<(), String> {
        let outcome = self
            .send_retried("function call", || async {
                Transaction::construct(self.signer_id.clone(), receiver.clone())
                    .add_action(Action::FunctionCall(Box::new(FunctionCallAction {
                        method_name: method_name.to_owned(),
                        args: args.clone(),
                        gas,
                        deposit,
                    })))
                    .with_signer(self.signer.clone())
                    .send_to(&self.network)
                    .await
            })
            .await?;
        outcome
            .into_result()
            .map_err(|e| format!("execution failed: {}", e))?;
        Ok(())
    }

    /// Relay a NEP-366 meta-transaction: wrap the signed delegate action and send it
    /// to its `sender_id`. Safe to retry — the delegate nonce rejects a double-land.
    pub async fn relay_meta_tx(
        &self,
        signed: SignedDelegateAction,
    ) -> Result<ExecutionFinalResult, RelayFailure> {
        let outer_receiver = signed.delegate_action.sender_id.clone();
        self.send_replay_protected("relay meta-tx", || {
            Transaction::construct(self.signer_id.clone(), outer_receiver.clone())
                .add_action(Action::Delegate(Box::new(signed.clone())))
                .with_signer(self.signer.clone())
        })
        .await
    }

    /// Replay the sponsor's prepared actions directly to the user's wallet contract.
    /// Safe to retry — the wallet request nonce rejects a double-land.
    pub async fn replay_actions(
        &self,
        receiver: &AccountId,
        actions: Vec<Action>,
    ) -> Result<ExecutionFinalResult, RelayFailure> {
        self.send_replay_protected("replay w_execute_signed", || {
            let mut transaction = Transaction::construct(self.signer_id.clone(), receiver.clone());
            for action in &actions {
                transaction = transaction.add_action(action.clone());
            }
            transaction.with_signer(self.signer.clone())
        })
        .await
    }

    /// Transfer NEAR to `receiver`. NOT retried after broadcast: a bare transfer has
    /// no replay protection, so a re-send that already landed would double-pay.
    pub async fn transfer_once(
        &self,
        receiver: &AccountId,
        amount: NearToken,
    ) -> Result<(), String> {
        Tokens::account(self.signer_id.clone())
            .send_to(receiver.clone())
            .near(amount)
            .with_signer(self.signer.clone())
            .send_to(&self.network)
            .await
            .map_err(|e| e.to_string())?
            .into_result()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Retry a send-producing future under the RPC policy, stringifying the error.
    async fn send_retried<O, E, Fut>(
        &self,
        label: &str,
        send: impl FnMut() -> Fut,
    ) -> Result<O, String>
    where
        Fut: Future<Output = Result<O, E>>,
        E: Display,
    {
        retry(RetryPolicy::rpc(), label, send)
            .await
            .map_err(|e| e.to_string())
    }

    /// Send a user's relayed transaction under the RPC retry policy, keeping what
    /// is known about its fate. Each attempt is signed before it is sent so its
    /// hash survives a lost response; once any attempt may have been broadcast,
    /// the relay can no longer be reported as "never sent".
    async fn send_replay_protected(
        &self,
        label: &str,
        build: impl Fn() -> ExecuteSignedTransaction,
    ) -> Result<ExecutionFinalResult, RelayFailure> {
        let policy = RetryPolicy::rpc();
        let mut maybe_broadcast: Option<CryptoHash> = None;
        let mut last_error = String::new();

        for attempt in 1..=policy.max_attempts {
            if attempt > 1 {
                tokio::time::sleep(policy.delay).await;
            }
            let send_error = match build().presign_with(&self.network).await {
                Err(sign_error) => sign_error,
                Ok(presigned) => {
                    let tx_hash = signed_tx_hash(&presigned);
                    match presigned.send_to(&self.network).await {
                        Ok(outcome) => return landed_result(outcome, maybe_broadcast),
                        Err(send_error) => {
                            if !was_never_broadcast(&send_error) {
                                maybe_broadcast = maybe_broadcast.or(tx_hash);
                            }
                            send_error
                        }
                    }
                }
            };
            tracing::warn!(
                "{label} attempt {attempt}/{} failed: {send_error}",
                policy.max_attempts
            );
            last_error = send_error.to_string();
        }

        Err(match maybe_broadcast {
            Some(tx_hash) => RelayFailure::StatusUnknown {
                tx_hash: Some(tx_hash),
                message: last_error,
            },
            None => RelayFailure::NotSent {
                message: last_error,
            },
        })
    }
}

/// How a relayed transaction failed, by what is known about the user's funds.
#[derive(Debug)]
pub enum RelayFailure {
    /// No attempt can have reached the network.
    NotSent { message: String },
    /// An attempt may have been broadcast and its outcome was never read.
    StatusUnknown {
        tx_hash: Option<CryptoHash>,
        message: String,
    },
    /// The transaction landed and failed.
    FailedOnChain {
        tx_hash: CryptoHash,
        reason: TxFailureReason,
        message: String,
    },
}

impl RelayFailure {
    pub fn message(&self) -> &str {
        match self {
            Self::NotSent { message }
            | Self::StatusUnknown { message, .. }
            | Self::FailedOnChain { message, .. } => message,
        }
    }
}

impl From<&RelayFailure> for ApiError {
    fn from(failure: &RelayFailure) -> Self {
        match failure {
            RelayFailure::NotSent { .. } => ApiError::rpc_unavailable(),
            RelayFailure::StatusUnknown { tx_hash, .. } => {
                ApiError::tx_status_unknown(tx_hash.map(|hash| hash.to_string()))
            }
            RelayFailure::FailedOnChain {
                tx_hash, reason, ..
            } => ApiError::tx_failed(tx_hash.to_string(), *reason),
        }
    }
}

fn signed_tx_hash(presigned: &ExecuteSignedTransaction) -> Option<CryptoHash> {
    match &presigned.transaction {
        TransactionableOrSigned::Signed((signed, _)) => Some(signed.get_hash()),
        TransactionableOrSigned::Transactionable(_) => None,
    }
}

/// Whether a send error proves the transaction never reached the network:
/// it failed before signing, could not connect, or the RPC refused it outright.
/// Anything else (timeouts, dropped responses) may have been broadcast.
fn was_never_broadcast(error: &ExecuteTransactionError) -> bool {
    let send_error = match error {
        ExecuteTransactionError::TransactionError(
            RetryError::Critical(send_error) | RetryError::RetriesExhausted(send_error),
        ) => send_error,
        ExecuteTransactionError::TransactionError(_) => return true,
        ExecuteTransactionError::DataConversionError(_) => return false,
        _ => return true,
    };
    match send_error {
        SendRequestError::RequestCreationError(_) | SendRequestError::RequestValidationError(_) => {
            true
        }
        SendRequestError::ServerError(rpc_error) => matches!(
            rpc_error,
            RpcTransactionError::InvalidTransaction { .. } | RpcTransactionError::DoesNotTrackShard
        ),
        SendRequestError::TransportError(near_openapi_client::Error::CommunicationError(
            transport,
        )) => transport.is_connect(),
        _ => false,
    }
}

/// Turn a landed outcome into the relay result. A landed failure after an
/// earlier attempt may have been broadcast is a nonce replay of that attempt,
/// so the user's transaction is reported as unknown rather than failed.
fn landed_result(
    outcome: ExecutionFinalResult,
    maybe_broadcast: Option<CryptoHash>,
) -> Result<ExecutionFinalResult, RelayFailure> {
    let Some(message) = landed_failure_message(&outcome) else {
        return Ok(outcome);
    };
    Err(match maybe_broadcast {
        Some(earlier_tx_hash) => RelayFailure::StatusUnknown {
            tx_hash: Some(earlier_tx_hash),
            message,
        },
        None => RelayFailure::FailedOnChain {
            tx_hash: outcome.transaction().get_hash(),
            reason: TxFailureReason::classify(&message),
            message,
        },
    })
}

/// Describe why a landed transaction failed, if it did.
///
/// `ExecutionFinalResult::into_result()` inspects only the transaction's
/// top-level `FinalExecutionStatus`. Sputnik's `act_proposal` schedules a
/// `FunctionCall` proposal's cross-contract call as an independent promise
/// with no callback that re-raises its failure, so if that call runs out of
/// gas ("Exceeded the prepaid gas") the receipt fails while the top-level
/// status stays `Success`. Scan every receipt so such failures surface to the
/// caller instead of being silently swallowed.
fn landed_failure_message(outcome: &ExecutionFinalResult) -> Option<String> {
    if let Some(receipt_failure) = receipt_failure_message(outcome) {
        return Some(receipt_failure);
    }
    outcome
        .clone()
        .into_result()
        .err()
        .map(|failure| format!("Execution failed: {failure}"))
}

pub(crate) fn receipt_failure_message(outcome: &ExecutionFinalResult) -> Option<String> {
    let failures = outcome.receipt_failures();
    if failures.is_empty() {
        return None;
    }
    let details = failures
        .iter()
        .map(|failure| format!("{:?}", failure))
        .collect::<Vec<_>>()
        .join("; ");
    Some(format!(
        "Relayed transaction landed but {} receipt(s) failed on-chain: {}",
        failures.len(),
        details
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::api_error::{ApiErrorCode, FundsState};

    fn rpc_error(error: RpcTransactionError) -> ExecuteTransactionError {
        ExecuteTransactionError::TransactionError(RetryError::RetriesExhausted(
            SendRequestError::ServerError(error),
        ))
    }

    #[test]
    fn a_timeout_may_have_been_broadcast() {
        assert!(!was_never_broadcast(&rpc_error(
            RpcTransactionError::TimeoutError
        )));
    }

    #[test]
    fn a_refused_transaction_was_never_broadcast() {
        assert!(was_never_broadcast(&rpc_error(
            RpcTransactionError::InvalidTransaction(Default::default())
        )));
        assert!(was_never_broadcast(
            &ExecuteTransactionError::TransactionError(RetryError::NoRpcEndpoints)
        ));
    }

    #[test]
    fn failures_map_to_the_funds_state_they_prove() {
        let not_sent = ApiError::from(&RelayFailure::NotSent {
            message: String::new(),
        });
        assert_eq!(not_sent.code, ApiErrorCode::RpcUnavailable);
        assert_eq!(not_sent.funds_state, FundsState::NotSent);
        assert!(not_sent.retryable);

        let unknown = ApiError::from(&RelayFailure::StatusUnknown {
            tx_hash: Some(CryptoHash::default()),
            message: String::new(),
        });
        assert_eq!(unknown.code, ApiErrorCode::TxStatusUnknown);
        assert!(!unknown.retryable);
        assert!(unknown.details.tx_hash.is_some());

        let failed = ApiError::from(&RelayFailure::FailedOnChain {
            tx_hash: CryptoHash::default(),
            reason: TxFailureReason::AlreadyVoted,
            message: String::new(),
        });
        assert_eq!(failed.funds_state, FundsState::FailedOnchain);
        assert_eq!(failed.details.reason, Some(TxFailureReason::AlreadyVoted));
    }
}

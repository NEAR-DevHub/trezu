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
            SignedTransaction, actions::FunctionCallAction, delegate_action::SignedDelegateAction,
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

    /// Relay an ML-DSA-65 meta-transaction. The user's signed bytes are embedded
    /// as-is; this signs only the outer transaction with the sponsor key.
    /// Safe to retry — the delegate nonce rejects a double-land.
    pub async fn relay_post_quantum_meta_tx(
        &self,
        http: &reqwest::Client,
        signer_key: &near_api::SecretKey,
        sender_id: &AccountId,
        treasury_id: &AccountId,
        delegate_bytes: &[u8],
    ) -> Result<crate::handlers::relay::post_quantum::ProtocolRelayOutcome, RelayFailure> {
        use borsh::BorshDeserialize;
        use near_primitives::action::delegate::SignedDelegateAction as ProtocolSigned;

        use crate::handlers::relay::post_quantum::{
            self, read_send_tx_result, rpc_rejected_before_broadcast,
        };

        let secret = post_quantum::sponsor_secret(signer_key)
            .map_err(|message| RelayFailure::NotSent { message })?;
        let delegate = ProtocolSigned::try_from_slice(delegate_bytes).map_err(|error| {
            RelayFailure::NotSent {
                message: format!("Invalid delegate action: {error}"),
            }
        })?;
        let policy = RetryPolicy::rpc();
        let mut signed_tx: Option<(String, CryptoHash)> = None;
        let mut last_error = String::new();
        let mut maybe_broadcast = false;

        for attempt in 1..=policy.max_attempts {
            if attempt > 1 {
                tokio::time::sleep(policy.delay).await;
            }
            let (tx_base64, tx_hash) = if let Some(signed) = &signed_tx {
                signed.clone()
            } else {
                let public_key = secret.public_key();
                let api_public_key =
                    public_key
                        .to_string()
                        .parse()
                        .map_err(|error| RelayFailure::NotSent {
                            message: format!("sponsor public key: {error}"),
                        })?;
                let (nonce, block_hash, _) = match self
                    .signer
                    .fetch_tx_nonce(self.signer_id.clone(), api_public_key, &self.network)
                    .await
                {
                    Ok(nonce) => nonce,
                    Err(error) => {
                        tracing::warn!(
                            "relay post-quantum attempt {attempt}/{} failed to fetch nonce: {error}",
                            policy.max_attempts
                        );
                        last_error = error.to_string();
                        continue;
                    }
                };
                let transaction = match post_quantum::unsigned_relay_transaction(
                    &self.signer_id,
                    &public_key,
                    nonce,
                    sender_id,
                    block_hash.0,
                    delegate.clone(),
                ) {
                    Ok(transaction) => transaction,
                    Err(message) => return Err(RelayFailure::NotSent { message }),
                };
                let signed = post_quantum::sign_transaction(&secret, transaction);
                let tx_hash = CryptoHash(signed.get_hash().0);
                let tx_base64 = post_quantum::signed_tx_base64(&signed);
                signed_tx = Some((tx_base64.clone(), tx_hash));
                (tx_base64, tx_hash)
            };

            for (index, endpoint) in self.network.rpc_endpoints.iter().enumerate() {
                match Self::send_once(http, endpoint, &tx_base64).await {
                    Ok(result) => {
                        return read_send_tx_result(
                            &result,
                            treasury_id.as_str(),
                            &tx_hash.to_string(),
                        )
                        .map_err(|failure| RelayFailure::FailedOnChain {
                            tx_hash,
                            reason: failure.reason,
                            message: failure.message,
                        });
                    }
                    Err(send_error) => {
                        let rejected = send_error
                            .rpc_error
                            .as_ref()
                            .is_some_and(rpc_rejected_before_broadcast);
                        if !rejected && !send_error.connect_error {
                            maybe_broadcast = true;
                        } else if rejected {
                            // The node refused these bytes. A new nonce is safe.
                            signed_tx = None;
                        }
                        tracing::warn!(
                            "relay post-quantum attempt {attempt}/{} endpoint {index} failed: {}",
                            policy.max_attempts,
                            send_error.message
                        );
                        last_error = send_error.message;
                    }
                }
            }
        }

        Err(if maybe_broadcast {
            RelayFailure::StatusUnknown {
                tx_hash: signed_tx.as_ref().map(|(_, hash)| *hash),
                message: last_error,
            }
        } else {
            RelayFailure::NotSent {
                message: last_error,
            }
        })
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

    /// `send_tx` against one RPC endpoint. A connect failure has not been
    /// broadcast. A JSON-RPC error is returned with its body so the caller can
    /// tell a refusal from a timeout.
    async fn send_once(
        http: &reqwest::Client,
        endpoint: &near_api::RPCEndpoint,
        signed_tx_base64: &str,
    ) -> Result<serde_json::Value, TxSendError> {
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": "0",
            "method": "send_tx",
            "params": {
                "signed_tx_base64": signed_tx_base64,
                "wait_until": "FINAL",
            }
        });
        let mut request = http.post(endpoint.url.clone()).json(&body);
        if let Some(authorization) = &endpoint.bearer_header {
            request = request.header(reqwest::header::AUTHORIZATION, authorization);
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                return Err(TxSendError {
                    message: error.to_string(),
                    connect_error: error.is_connect() || error.is_request(),
                    rpc_error: None,
                });
            }
        };
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let parsed = serde_json::from_str::<serde_json::Value>(&text).ok();
        if let Some(error) = parsed.as_ref().and_then(|value| value.get("error")) {
            return Err(TxSendError {
                message: error.to_string(),
                connect_error: false,
                rpc_error: Some(error.clone()),
            });
        }
        if let Some(result) = parsed.as_ref().and_then(|value| value.get("result")) {
            return Ok(result.clone());
        }
        Err(TxSendError {
            message: format!("send_tx HTTP {status}: {text}"),
            // A gateway timeout or a body we cannot read may already have been
            // accepted by the node.
            connect_error: status.is_client_error(),
            rpc_error: None,
        })
    }
}

struct TxSendError {
    message: String,
    connect_error: bool,
    rpc_error: Option<serde_json::Value>,
}

impl Sponsor {
    /// Send a user's relayed transaction, owning every broadcast so the relay
    /// always knows what may have reached the network.
    ///
    /// near-api's own retry loop is bypassed (one send per endpoint, no SDK
    /// retries): it re-sends the same bytes across endpoints and surfaces only
    /// the final error, so an early timeout (a broadcast) followed by a refused
    /// re-send elsewhere would come back looking like "never sent". Here the
    /// transaction is signed, then tried endpoint by endpoint; while every send
    /// is proven unsent it is re-signed between attempts, and once any send may
    /// have been broadcast the same bytes are re-sent to read their outcome and
    /// the relay can no longer be reported as unsent.
    async fn send_replay_protected(
        &self,
        label: &str,
        build: impl Fn() -> ExecuteSignedTransaction,
    ) -> Result<ExecutionFinalResult, RelayFailure> {
        let policy = RetryPolicy::rpc();
        let mut maybe_broadcast: Option<SignedTransaction> = None;
        let mut last_error = String::new();

        for attempt in 1..=policy.max_attempts {
            if attempt > 1 {
                tokio::time::sleep(policy.delay).await;
            }
            let signed = match &maybe_broadcast {
                Some(signed) => signed.clone(),
                None => match build().presign_with(&self.network).await {
                    Ok(presigned) => match presigned.transaction {
                        TransactionableOrSigned::Signed((signed, _)) => signed,
                        TransactionableOrSigned::Transactionable(_) => {
                            last_error = "presigned transaction is unsigned".to_owned();
                            continue;
                        }
                    },
                    Err(sign_error) => {
                        tracing::warn!(
                            "{label} attempt {attempt}/{} failed to sign: {sign_error}",
                            policy.max_attempts
                        );
                        last_error = sign_error.to_string();
                        continue;
                    }
                },
            };

            for (index, endpoint) in self.network.rpc_endpoints.iter().enumerate() {
                let single_shot = NetworkConfig {
                    rpc_endpoints: vec![endpoint.clone().with_retries(1)],
                    ..self.network.clone()
                };
                match with_signed(build(), signed.clone())
                    .send_to(&single_shot)
                    .await
                {
                    Ok(outcome) => {
                        return landed_result(
                            outcome,
                            maybe_broadcast.as_ref().map(SignedTransaction::get_hash),
                        );
                    }
                    Err(send_error) => {
                        if !was_never_broadcast(&send_error) {
                            maybe_broadcast.get_or_insert_with(|| signed.clone());
                        }
                        tracing::warn!(
                            "{label} attempt {attempt}/{} endpoint {index} failed: {send_error}",
                            policy.max_attempts
                        );
                        last_error = send_error.to_string();
                    }
                }
            }
        }

        Err(match maybe_broadcast {
            Some(signed) => RelayFailure::StatusUnknown {
                tx_hash: Some(signed.get_hash()),
                message: last_error,
            },
            None => RelayFailure::NotSent {
                message: last_error,
            },
        })
    }
}

/// Pair already-signed bytes with a fresh handle so the same transaction can be
/// sent again: near-api consumes the handle on every send.
fn with_signed(
    mut handle: ExecuteSignedTransaction,
    signed: SignedTransaction,
) -> ExecuteSignedTransaction {
    handle.transaction = match handle.transaction {
        TransactionableOrSigned::Transactionable(transactionable)
        | TransactionableOrSigned::Signed((_, transactionable)) => {
            TransactionableOrSigned::Signed((signed, transactionable))
        }
    };
    handle
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

/// Turn a landed outcome into the relay result. The outcome is only trusted
/// as the user's when it belongs to the transaction that may already have been
/// broadcast (or nothing was); a different transaction failing after that is a
/// nonce replay of the earlier one, so the outcome is reported as unknown.
fn landed_result(
    outcome: ExecutionFinalResult,
    maybe_broadcast: Option<CryptoHash>,
) -> Result<ExecutionFinalResult, RelayFailure> {
    let landed_hash = outcome.transaction().get_hash();
    if let Some(earlier_tx_hash) = maybe_broadcast.filter(|earlier| *earlier != landed_hash) {
        return Err(RelayFailure::StatusUnknown {
            tx_hash: Some(earlier_tx_hash),
            message: format!(
                "a later transaction {landed_hash} landed after {earlier_tx_hash} may have been broadcast"
            ),
        });
    }
    let Some(message) = landed_failure_message(&outcome) else {
        return Ok(outcome);
    };
    Err(RelayFailure::FailedOnChain {
        tx_hash: landed_hash,
        reason: TxFailureReason::classify(&message),
        message,
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

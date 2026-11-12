use std::time::{Duration, Instant};

use near_api::{Account, AccountId, Chain, NetworkConfig, PublicKey, RPCEndpoint, Reference};
use serde_json::{Value, json};

use crate::AppState;

/// Per-call caps, and a ceiling on the whole provider round so one slow
/// step can never outlive the operation lease.
const SEND_TIMEOUT: Duration = Duration::from_secs(15);
const SEND_ROUND: Duration = Duration::from_secs(20);
const STATUS_TIMEOUT: Duration = Duration::from_secs(6);
const STATUS_ROUND: Duration = Duration::from_secs(8);

/// JSON-RPC against each configured provider, one call at a time, with no
/// SDK retries: the engine owns every broadcast so it always knows what may
/// have reached the network.
pub struct RelayRpc {
    http: reqwest::Client,
    network: NetworkConfig,
}

#[derive(Debug, Clone, Copy)]
pub struct AccessKeySnapshot {
    pub nonce: u64,
    pub block_hash: [u8; 32],
    pub block_height: u64,
}

/// What one `send_tx` round over the providers established.
#[derive(Debug)]
pub enum SendOutcome {
    /// A provider returned the final outcome of these exact bytes.
    Landed(Value),
    /// A reachable node refused the bytes before any provider may have
    /// broadcast them.
    Rejected(String),
    /// Some provider may hold the bytes: timeout, dropped response, or a
    /// refusal that came after such an attempt.
    Unknown(String),
    /// No provider could be reached; nothing was broadcast.
    Unreachable(String),
}

/// What a status round over the providers established for a hash.
#[derive(Debug)]
pub enum StatusOutcome {
    Landed(Value),
    /// A node has the transaction but it is not executed yet.
    Known(String),
    /// No provider returned an outcome; `absent_votes` providers positively
    /// reported the hash as unknown.
    Unknown {
        absent_votes: usize,
        detail: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RpcErrorKind {
    Connect,
    Timeout,
    UnknownTransaction,
    /// `InvalidTransaction` / `DoesNotTrackShard`: the node refused the bytes.
    Rejected,
    Other,
}

#[derive(Debug)]
pub struct RpcCallError {
    pub kind: RpcErrorKind,
    pub message: String,
}

impl RelayRpc {
    pub fn from_state(state: &AppState) -> Self {
        Self {
            http: state.http_client.clone(),
            network: state.network.clone(),
        }
    }

    pub fn provider_count(&self) -> usize {
        self.network.rpc_endpoints.len()
    }

    /// Two independent confirmations of absence when there are two
    /// providers, one otherwise.
    pub fn absence_quorum(&self) -> usize {
        self.provider_count().clamp(1, 2)
    }

    pub async fn access_key(
        &self,
        account_id: &AccountId,
        public_key: &PublicKey,
    ) -> Result<AccessKeySnapshot, String> {
        let data = Account(account_id.clone())
            .access_key(*public_key)
            .at(Reference::Final)
            .fetch_from(&self.network)
            .await
            .map_err(|error| format!("access key {public_key}: {error}"))?;
        Ok(AccessKeySnapshot {
            nonce: data.data.nonce.0,
            block_hash: data.block_hash.0,
            block_height: data.block_height,
        })
    }

    pub async fn block_height(&self) -> Result<u64, String> {
        Chain::block_number()
            .fetch_from(&self.network)
            .await
            .map_err(|error| format!("block height: {error}"))
    }

    /// Hand the exact signed bytes to the providers in order until one
    /// returns an outcome.
    pub async fn send(&self, signed_tx_base64: &str) -> SendOutcome {
        let params = json!({ "signed_tx_base64": signed_tx_base64, "wait_until": "FINAL" });
        let mut maybe_broadcast = false;
        let mut reached_any = false;
        let mut last_error = String::new();
        let round = Instant::now();
        for endpoint in &self.network.rpc_endpoints {
            let Some(timeout) = remaining(round, SEND_ROUND, SEND_TIMEOUT) else {
                last_error = format!("send round exceeded {SEND_ROUND:?}");
                maybe_broadcast = true;
                break;
            };
            match self
                .call(endpoint, "send_tx", params.clone(), timeout)
                .await
            {
                Ok(result) => return SendOutcome::Landed(result),
                Err(error) => {
                    tracing::warn!(
                        endpoint = %endpoint.url,
                        kind = ?error.kind,
                        error = %error.message,
                        "relay send_tx did not return an outcome"
                    );
                    match error.kind {
                        RpcErrorKind::Connect => {}
                        RpcErrorKind::Rejected if !maybe_broadcast => {
                            return SendOutcome::Rejected(error.message);
                        }
                        RpcErrorKind::Rejected => reached_any = true,
                        RpcErrorKind::Timeout
                        | RpcErrorKind::UnknownTransaction
                        | RpcErrorKind::Other => {
                            maybe_broadcast = true;
                            reached_any = true;
                        }
                    }
                    last_error = error.message;
                }
            }
        }
        if maybe_broadcast || reached_any {
            SendOutcome::Unknown(last_error)
        } else {
            SendOutcome::Unreachable(last_error)
        }
    }

    /// Look a hash up on every provider until one has its outcome.
    pub async fn status(&self, sender_account_id: &AccountId, tx_hash: &str) -> StatusOutcome {
        let params = json!({
            "tx_hash": tx_hash,
            "sender_account_id": sender_account_id,
            "wait_until": "NONE",
        });
        let mut absent_votes = 0;
        let mut known: Option<String> = None;
        let mut last_error = String::new();
        let round = Instant::now();
        for endpoint in &self.network.rpc_endpoints {
            let Some(timeout) = remaining(round, STATUS_ROUND, STATUS_TIMEOUT) else {
                last_error = format!("status round exceeded {STATUS_ROUND:?}");
                break;
            };
            match self.call(endpoint, "tx", params.clone(), timeout).await {
                Ok(result) if is_executed(&result) => return StatusOutcome::Landed(result),
                Ok(result) => {
                    known = Some(
                        result
                            .get("final_execution_status")
                            .map(ToString::to_string)
                            .unwrap_or_else(|| "unknown stage".to_owned()),
                    );
                }
                Err(error) => {
                    if error.kind == RpcErrorKind::UnknownTransaction {
                        absent_votes += 1;
                    } else {
                        tracing::warn!(
                            endpoint = %endpoint.url,
                            kind = ?error.kind,
                            error = %error.message,
                            "relay tx status lookup failed"
                        );
                    }
                    last_error = error.message;
                }
            }
        }
        match known {
            Some(stage) => StatusOutcome::Known(stage),
            None => StatusOutcome::Unknown {
                absent_votes,
                detail: last_error,
            },
        }
    }

    async fn call(
        &self,
        endpoint: &RPCEndpoint,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, RpcCallError> {
        let body = json!({ "jsonrpc": "2.0", "id": "relay", "method": method, "params": params });
        let mut request = self
            .http
            .post(endpoint.url.clone())
            .json(&body)
            .timeout(timeout);
        if let Some(authorization) = &endpoint.bearer_header {
            request = request.header(reqwest::header::AUTHORIZATION, authorization);
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                let kind = if error.is_timeout() {
                    RpcErrorKind::Timeout
                } else if error.is_connect() || error.is_request() {
                    RpcErrorKind::Connect
                } else {
                    RpcErrorKind::Other
                };
                return Err(RpcCallError {
                    kind,
                    message: error.to_string(),
                });
            }
        };
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let parsed = serde_json::from_str::<Value>(&text).ok();
        if let Some(error) = parsed.as_ref().and_then(|value| value.get("error")) {
            return Err(RpcCallError {
                kind: classify_rpc_error(error),
                message: error.to_string(),
            });
        }
        if let Some(result) = parsed.as_ref().and_then(|value| value.get("result")) {
            return Ok(result.clone());
        }
        Err(RpcCallError {
            // A 4xx without a JSON-RPC body never reached the node's handler;
            // a gateway timeout or an unreadable body may have.
            kind: if status.is_client_error() {
                RpcErrorKind::Connect
            } else {
                RpcErrorKind::Other
            },
            message: format!("{method} HTTP {status}: {text}"),
        })
    }
}

/// Time left in a provider round for the next call, capped per call; `None`
/// once the round is spent.
fn remaining(round: Instant, round_cap: Duration, call_cap: Duration) -> Option<Duration> {
    let left = round_cap.checked_sub(round.elapsed())?;
    if left < Duration::from_millis(500) {
        return None;
    }
    Some(left.min(call_cap))
}

/// A `tx` result carries an outcome once the transaction executed; before
/// that only `final_execution_status` (NONE / INCLUDED) is meaningful.
fn is_executed(result: &Value) -> bool {
    let stage = result
        .get("final_execution_status")
        .and_then(Value::as_str)
        .unwrap_or("EXECUTED");
    !matches!(stage, "NONE" | "INCLUDED")
        && result.get("status").is_some_and(|status| {
            status.get("SuccessValue").is_some() || status.get("Failure").is_some()
        })
}

/// Classify a JSON-RPC `error` object by its structured name, falling back
/// to the legacy `data` text older nodes return.
pub fn classify_rpc_error(error: &Value) -> RpcErrorKind {
    let rendered = error.to_string().to_ascii_uppercase();
    if rendered.contains("UNKNOWN_TRANSACTION") || rendered.contains("UNKNOWNTRANSACTION") {
        RpcErrorKind::UnknownTransaction
    } else if rendered.contains("TIMEOUT") {
        RpcErrorKind::Timeout
    } else if rendered.contains("INVALID_TRANSACTION")
        || rendered.contains("INVALIDTXERROR")
        || rendered.contains("DOES_NOT_TRACK_SHARD")
    {
        RpcErrorKind::Rejected
    } else {
        RpcErrorKind::Other
    }
}

/// Whether a refusal says the bytes' validity window is over: proof that
/// they can never land once no provider has them. Only the node's own
/// `InvalidTxError::Expired` counts; an action-level expiry inside a landed
/// outcome or a message that merely mentions the word does not.
pub fn is_expired_rejection(message: &str) -> bool {
    serde_json::from_str::<Value>(message).is_ok_and(|error| {
        error
            .pointer("/data/TxExecutionError/InvalidTxError")
            .and_then(Value::as_str)
            == Some("Expired")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rpc_errors_classify_by_name_or_legacy_data() {
        assert_eq!(
            classify_rpc_error(
                &json!({"name": "HANDLER_ERROR", "cause": {"name": "UNKNOWN_TRANSACTION"}})
            ),
            RpcErrorKind::UnknownTransaction
        );
        assert_eq!(
            classify_rpc_error(
                &json!({"name": "HANDLER_ERROR", "cause": {"name": "TIMEOUT_ERROR"}})
            ),
            RpcErrorKind::Timeout
        );
        assert_eq!(
            classify_rpc_error(
                &json!({"name": "HANDLER_ERROR", "cause": {"name": "INVALID_TRANSACTION"}, "data": {"TxExecutionError": {"InvalidTxError": "Expired"}}})
            ),
            RpcErrorKind::Rejected
        );
        assert_eq!(
            classify_rpc_error(
                &json!({"data": {"TxExecutionError": {"InvalidTxError": {"InvalidNonce": {}}}}})
            ),
            RpcErrorKind::Rejected
        );
        assert_eq!(
            classify_rpc_error(&json!({"name": "INTERNAL_ERROR"})),
            RpcErrorKind::Other
        );
        assert!(is_expired_rejection(
            &json!({"data": {"TxExecutionError": {"InvalidTxError": "Expired"}}}).to_string()
        ));
    }

    #[test]
    fn only_the_nodes_own_expiry_counts_as_an_expired_rejection() {
        let expired = json!({
            "name": "HANDLER_ERROR",
            "cause": {"name": "INVALID_TRANSACTION", "info": {}},
            "code": -32000,
            "message": "Server error",
            "data": {"TxExecutionError": {"InvalidTxError": "Expired"}}
        });
        assert!(is_expired_rejection(&expired.to_string()));

        let invalid_nonce = json!({
            "cause": {"name": "INVALID_TRANSACTION"},
            "data": {"TxExecutionError": {"InvalidTxError": {"InvalidNonce": {"ak_nonce": 8, "tx_nonce": 7}}}}
        });
        assert!(!is_expired_rejection(&invalid_nonce.to_string()));

        let delegate_expired_in_receipt = json!({
            "cause": {"name": "INVALID_TRANSACTION"},
            "data": {"TxExecutionError": {"ActionError": {"index": 0, "kind": "DelegateActionExpired"}}}
        });
        assert!(!is_expired_rejection(
            &delegate_expired_in_receipt.to_string()
        ));

        assert!(!is_expired_rejection("send_tx HTTP 504: Expired upstream"));
    }

    #[test]
    fn a_status_result_counts_as_landed_only_once_executed() {
        assert!(!is_executed(
            &json!({"final_execution_status": "INCLUDED", "status": {"SuccessValue": ""}})
        ));
        assert!(is_executed(
            &json!({"final_execution_status": "FINAL", "status": {"SuccessValue": ""}})
        ));
        assert!(is_executed(
            &json!({"final_execution_status": "EXECUTED_OPTIMISTIC", "status": {"Failure": {}}})
        ));
        assert!(!is_executed(&json!({"final_execution_status": "FINAL"})));
    }

    #[test]
    fn a_round_hands_out_what_is_left_and_then_nothing() {
        let round = Instant::now();
        let first = remaining(round, Duration::from_secs(20), Duration::from_secs(15)).unwrap();
        assert!(first <= Duration::from_secs(15));
        let spent = Instant::now() - Duration::from_secs(25);
        assert!(remaining(spent, Duration::from_secs(20), Duration::from_secs(15)).is_none());
    }
}

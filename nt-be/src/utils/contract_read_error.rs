use axum::http::StatusCode;
use near_api::errors::{QueryError, RetryError, SendRequestError};
use near_openapi_types::{CompilationError, FunctionCallError, HostError, RpcQueryError};

use crate::utils::cache::CacheError;

/// Why a NEAR view call failed, classified once so every handler answers the
/// same status for the same cause. Caller-caused failures (unknown account,
/// wrong contract type, missing resource) are 4xx and never reach Sentry;
/// everything else is a dependency fault. Pinned blocks are always chosen by
/// the backend, so an unavailable block is never the caller's fault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractReadError {
    UnknownAccount,
    NoContractCode,
    MethodNotFound,
    ResourceNotFound(String),
    ContractPanic(String),
    BlockUnavailable,
    InvalidAccount,
    Rpc(String),
    Decode(String),
}

impl std::fmt::Display for ContractReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContractReadError::UnknownAccount => write!(f, "Account does not exist"),
            ContractReadError::NoContractCode => write!(f, "Account has no contract deployed"),
            ContractReadError::MethodNotFound => {
                write!(f, "Account is not the expected contract type")
            }
            ContractReadError::ResourceNotFound(msg) => write!(f, "Resource not found: {msg}"),
            ContractReadError::ContractPanic(msg) => write!(f, "Contract panicked: {msg}"),
            ContractReadError::BlockUnavailable => write!(f, "Requested block is not available"),
            ContractReadError::InvalidAccount => write!(f, "Invalid account id"),
            ContractReadError::Rpc(msg) => write!(f, "NEAR RPC error: {msg}"),
            ContractReadError::Decode(msg) => write!(f, "Unexpected contract response: {msg}"),
        }
    }
}

impl std::error::Error for ContractReadError {}

impl ContractReadError {
    /// HTTP status + client-safe message, shaped like `AuthError::status_and_message`.
    pub fn status_and_message(&self) -> (StatusCode, String) {
        match self {
            ContractReadError::UnknownAccount
            | ContractReadError::NoContractCode
            | ContractReadError::MethodNotFound
            | ContractReadError::ResourceNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            ContractReadError::InvalidAccount => (StatusCode::BAD_REQUEST, self.to_string()),
            ContractReadError::ContractPanic(_) => {
                (StatusCode::BAD_GATEWAY, "Contract call failed".to_string())
            }
            ContractReadError::BlockUnavailable | ContractReadError::Rpc(_) => {
                (StatusCode::BAD_GATEWAY, "NEAR RPC error".to_string())
            }
            ContractReadError::Decode(_) => (
                StatusCode::BAD_GATEWAY,
                "Unexpected contract response".to_string(),
            ),
        }
    }

    pub fn is_client_error(&self) -> bool {
        self.status_and_message().0.is_client_error()
    }

    /// Log and convert for a user-facing read: `warn` for caller-caused
    /// failures, `error_event!` only for dependency faults.
    pub fn into_http(self, call: &str) -> (StatusCode, String) {
        if self.is_client_error() {
            tracing::warn!(call, error = %self, "contract read rejected");
        } else {
            crate::error_event!(
                crate::error_event::ErrorCode::ContractReadFailed,
                call,
                error = %self
            );
        }
        self.status_and_message()
    }

    /// String fallback for failures that lost their type: near-api degrades to
    /// `TransportError` when it cannot parse the node's wasm error message.
    fn from_message(message: String) -> Self {
        if is_unknown_account(&message) {
            ContractReadError::UnknownAccount
        } else if is_method_not_found(&message) {
            ContractReadError::MethodNotFound
        } else if is_block_unavailable(&message) {
            ContractReadError::BlockUnavailable
        } else if let Some(panic_msg) = guest_panic_message(&message) {
            Self::from_panic(panic_msg)
        } else {
            ContractReadError::Rpc(message)
        }
    }

    fn from_panic(panic_msg: String) -> Self {
        if is_missing_resource_panic(&panic_msg) {
            ContractReadError::ResourceNotFound(panic_msg)
        } else {
            ContractReadError::ContractPanic(panic_msg)
        }
    }

    fn from_function_call_error(error: FunctionCallError) -> Self {
        match error {
            FunctionCallError::MethodResolveError(_) => ContractReadError::MethodNotFound,
            FunctionCallError::CompilationError(CompilationError::CodeDoesNotExist { .. }) => {
                ContractReadError::NoContractCode
            }
            FunctionCallError::HostError(HostError::GuestPanic { panic_msg }) => {
                Self::from_panic(panic_msg)
            }
            other => Self::from_message(format!("{other:?}")),
        }
    }

    fn from_rpc_query_error(error: RpcQueryError) -> Self {
        match error {
            RpcQueryError::UnknownAccount { .. } => ContractReadError::UnknownAccount,
            RpcQueryError::NoContractCode { .. } => ContractReadError::NoContractCode,
            RpcQueryError::InvalidAccount { .. } => ContractReadError::InvalidAccount,
            RpcQueryError::UnknownBlock { .. } | RpcQueryError::GarbageCollectedBlock { .. } => {
                ContractReadError::BlockUnavailable
            }
            RpcQueryError::ContractExecutionError { vm_error, .. } => Self::from_message(vm_error),
            other => ContractReadError::Rpc(format!("{other:?}")),
        }
    }

    fn from_send_request_error(error: SendRequestError<RpcQueryError>) -> Self {
        match error {
            SendRequestError::ServerError(rpc) => Self::from_rpc_query_error(rpc),
            SendRequestError::WasmExecutionError(call) => Self::from_function_call_error(call),
            other => Self::from_message(format!("{other:?}")),
        }
    }
}

impl From<QueryError<RpcQueryError>> for ContractReadError {
    fn from(error: QueryError<RpcQueryError>) -> Self {
        match error {
            QueryError::QueryError(retry) => match *retry {
                RetryError::RetriesExhausted(e) | RetryError::Critical(e) => {
                    Self::from_send_request_error(e)
                }
                other => ContractReadError::Rpc(other.to_string()),
            },
            QueryError::DeserializeError(e) => ContractReadError::Decode(e.to_string()),
            e @ (QueryError::UnexpectedResponse { .. } | QueryError::ConversionError(_)) => {
                ContractReadError::Decode(e.to_string())
            }
            other => ContractReadError::Rpc(other.to_string()),
        }
    }
}

impl From<ContractReadError> for (StatusCode, String) {
    fn from(error: ContractReadError) -> Self {
        error.status_and_message()
    }
}

impl From<ContractReadError> for CacheError {
    fn from(error: ContractReadError) -> Self {
        let (status, message) = error.status_and_message();
        CacheError::Full(status, message)
    }
}

/// "The method does not exist" / "no contract deployed" — the account is not
/// the contract type the caller expected.
pub fn is_method_not_found(probe: &str) -> bool {
    let p = probe.to_lowercase();
    // contract has no such method
    p.contains("methodresolveerror")
        || p.contains("method not found")
        || p.contains("methodnotfound")
        || p.contains("methodnamemismatch")
        || p.contains("methodutf8error")
        // no contract code is deployed on the account
        || p.contains("codedoesnotexist")
        || p.contains("nocontractcode")
        || p.contains("no_contract_code")
        || p.contains("contractcodenotfound")
        || p.contains("no contract code")
        || p.contains("contract code does not exist")
}

/// The "account does not exist" RPC error, in every spelling the node uses.
pub fn is_unknown_account(probe: &str) -> bool {
    let p = probe.to_lowercase();
    p.contains("unknown_account")
        || p.contains("unknownaccount")
        || p.contains("does not exist while viewing")
        || p.contains("account_does_not_exist")
}

/// Only the RPC's own "this height has no block" signals. A skipped height on
/// the archival endpoint answers `HANDLER_ERROR / UNKNOWN_BLOCK` with
/// "DB Not Found Error: BLOCK HEIGHT …" (verified live); a garbage-collected
/// block on a non-archival node names itself. Anything else — a 422 from a
/// malformed request, a transport failure — must surface as an error.
pub fn is_block_unavailable(message: &str) -> bool {
    message.contains("UNKNOWN_BLOCK")
        || message.contains("UnknownBlock")
        || message.contains("DB Not Found")
        || message.contains("GARBAGE_COLLECTED_BLOCK")
        || message.contains("GarbageCollectedBlock")
}

/// Panics a contract raises for a lookup that found nothing. Any other panic
/// is a contract or state bug and must stay reportable.
fn is_missing_resource_panic(panic_msg: &str) -> bool {
    panic_msg.contains("ERR_NO_PROPOSAL") || panic_msg.contains("ERR_NO_BOUNTY")
}

fn guest_panic_message(message: &str) -> Option<String> {
    let (_, rest) = message.split_once("GuestPanic")?;
    let (_, rest) = rest.split_once("panic_msg:")?;
    let rest = rest.trim_start().trim_start_matches(['\\', '"']);
    let end = rest.find(['\\', '"']).unwrap_or(rest.len());
    Some(rest[..end].trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server_error(rpc: serde_json::Value) -> QueryError<RpcQueryError> {
        let rpc: RpcQueryError = serde_json::from_value(rpc).expect("fixture parses");
        QueryError::QueryError(Box::new(RetryError::Critical(
            SendRequestError::ServerError(rpc),
        )))
    }

    fn wasm_error(call: FunctionCallError) -> QueryError<RpcQueryError> {
        QueryError::QueryError(Box::new(RetryError::RetriesExhausted(
            SendRequestError::WasmExecutionError(call),
        )))
    }

    const BLOCK_HASH: &str = "8bVg8wugs2QHqXr42oEsCYyH7jvR9pLaAP35dFqx2evU";

    #[test]
    fn unknown_account_is_404() {
        // The mainnet payload for `get_config` on `phpinfo.php.old` (issue #1638).
        let error = ContractReadError::from(server_error(serde_json::json!({
            "name": "UNKNOWN_ACCOUNT",
            "info": {
                "block_hash": BLOCK_HASH,
                "block_height": 165000000u64,
                "requested_account_id": "phpinfo.php.old"
            }
        })));
        assert_eq!(error, ContractReadError::UnknownAccount);
        assert_eq!(error.status_and_message().0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn no_contract_code_is_404() {
        let error = ContractReadError::from(server_error(serde_json::json!({
            "name": "NO_CONTRACT_CODE",
            "info": {
                "block_hash": BLOCK_HASH,
                "block_height": 165000000u64,
                "contract_account_id": "alice.near"
            }
        })));
        assert_eq!(error, ContractReadError::NoContractCode);
        assert_eq!(error.status_and_message().0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn invalid_account_is_400_and_missing_block_is_502() {
        let invalid = ContractReadError::from(server_error(serde_json::json!({
            "name": "INVALID_ACCOUNT",
            "info": {
                "block_hash": BLOCK_HASH,
                "block_height": 165000000u64,
                "requested_account_id": "alice.near"
            }
        })));
        assert_eq!(invalid, ContractReadError::InvalidAccount);
        assert_eq!(invalid.status_and_message().0, StatusCode::BAD_REQUEST);

        let collected = ContractReadError::from(server_error(serde_json::json!({
            "name": "GARBAGE_COLLECTED_BLOCK",
            "info": { "block_hash": BLOCK_HASH, "block_height": 1u64 }
        })));
        assert_eq!(collected, ContractReadError::BlockUnavailable);
        assert_eq!(
            collected.status_and_message(),
            (StatusCode::BAD_GATEWAY, "NEAR RPC error".to_string())
        );
        assert!(!collected.is_client_error());
    }

    #[test]
    fn contract_execution_error_is_classified_from_vm_message() {
        let error = ContractReadError::from(server_error(serde_json::json!({
            "name": "CONTRACT_EXECUTION_ERROR",
            "info": {
                "block_hash": BLOCK_HASH,
                "block_height": 165000000u64,
                "vm_error": "wasm execution failed with error: MethodResolveError(MethodNotFound)"
            }
        })));
        assert_eq!(error, ContractReadError::MethodNotFound);
    }

    #[test]
    fn wasm_method_not_found_is_404() {
        let call: FunctionCallError =
            serde_json::from_value(serde_json::json!({ "MethodResolveError": "MethodNotFound" }))
                .expect("fixture parses");
        let error = ContractReadError::from(wasm_error(call));
        assert_eq!(error, ContractReadError::MethodNotFound);
        assert_eq!(error.status_and_message().0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn missing_resource_panic_is_404_with_panic_message() {
        let error = ContractReadError::from(wasm_error(FunctionCallError::HostError(
            HostError::GuestPanic {
                panic_msg: "panicked at 'ERR_NO_PROPOSAL'".to_string(),
            },
        )));
        assert_eq!(
            error,
            ContractReadError::ResourceNotFound("panicked at 'ERR_NO_PROPOSAL'".to_string())
        );
        assert_eq!(error.status_and_message().0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn unexpected_panic_is_reportable_502_without_detail() {
        let error = ContractReadError::from(wasm_error(FunctionCallError::HostError(
            HostError::GuestPanic {
                panic_msg: "Cannot deserialize the contract state.".to_string(),
            },
        )));
        assert_eq!(
            error,
            ContractReadError::ContractPanic("Cannot deserialize the contract state.".to_string())
        );
        assert_eq!(
            error.status_and_message(),
            (StatusCode::BAD_GATEWAY, "Contract call failed".to_string())
        );
        assert!(!error.is_client_error());
    }

    #[test]
    fn other_wasm_failures_are_502() {
        let error = ContractReadError::from(wasm_error(FunctionCallError::HostError(
            HostError::GasLimitExceeded,
        )));
        assert!(matches!(error, ContractReadError::Rpc(_)));
        assert_eq!(error.status_and_message().0, StatusCode::BAD_GATEWAY);
    }

    #[test]
    fn network_and_decode_failures_are_502_without_detail() {
        let no_endpoints = ContractReadError::from(QueryError::<RpcQueryError>::QueryError(
            Box::new(RetryError::NoRpcEndpoints),
        ));
        assert_eq!(
            no_endpoints.status_and_message(),
            (StatusCode::BAD_GATEWAY, "NEAR RPC error".to_string())
        );

        let decode = serde_json::from_str::<u64>("\"x\"").unwrap_err();
        let decode = ContractReadError::from(QueryError::<RpcQueryError>::DeserializeError(decode));
        assert_eq!(
            decode.status_and_message(),
            (
                StatusCode::BAD_GATEWAY,
                "Unexpected contract response".to_string()
            )
        );
    }

    #[test]
    fn untyped_messages_fall_back_to_string_predicates() {
        assert_eq!(
            ContractReadError::from_message(
                "account phpinfo.php.old does not exist while viewing".to_string()
            ),
            ContractReadError::UnknownAccount
        );
        assert_eq!(
            ContractReadError::from_message(
                "wasm execution failed with error: MethodResolveError(MethodNotFound)".to_string()
            ),
            ContractReadError::MethodNotFound
        );
        assert_eq!(
            ContractReadError::from_message("DB Not Found Error: BLOCK HEIGHT 12".to_string()),
            ContractReadError::BlockUnavailable
        );
        assert_eq!(
            ContractReadError::from_message(
                "HostError(GuestPanic { panic_msg: \"ERR_NO_PROPOSAL\" })".to_string()
            ),
            ContractReadError::ResourceNotFound("ERR_NO_PROPOSAL".to_string())
        );
        assert_eq!(
            ContractReadError::from_message(
                "HostError(GuestPanic { panic_msg: \"Cannot deserialize the contract state.\" })"
                    .to_string()
            ),
            ContractReadError::ContractPanic("Cannot deserialize the contract state.".to_string())
        );
        assert!(matches!(
            ContractReadError::from_message("connection reset by peer".to_string()),
            ContractReadError::Rpc(_)
        ));
    }

    #[test]
    fn block_unavailable_predicate_stays_narrow() {
        assert!(is_block_unavailable("UnknownBlock"));
        assert!(is_block_unavailable("GarbageCollectedBlock"));
        assert!(!is_block_unavailable("account does not exist"));
        assert!(!is_block_unavailable("connection reset by peer"));
    }
}

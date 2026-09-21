use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

/// Which user-facing error this is. The frontend owns the copy; a code it does
/// not know falls back to `UNEXPECTED`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApiErrorCode {
    SponsorshipNotAvailable,
    NotAuthorized,
    RequestRejected,
    RpcUnavailable,
    TxStatusUnknown,
    TxFailed,
    Unexpected,
}

/// What the frontend is allowed to say about funds. "No funds were moved" is
/// only true for `None` and `NotSent`; `Unknown` must never offer a retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FundsState {
    None,
    NotSent,
    Unknown,
    FailedOnchain,
}

/// Why a landed transaction failed on-chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TxFailureReason {
    InsufficientBalance,
    RequestExpired,
    RequestNotActive,
    AlreadyVoted,
    RecipientNotRegistered,
    InsufficientPermissions,
    OutOfGas,
    Unknown,
}

impl TxFailureReason {
    /// Classify the debug form of an execution failure. Contract panics only
    /// exist as strings, so this matches on text by necessity.
    pub fn classify(failure_debug: &str) -> Self {
        let has = |needles: &[&str]| needles.iter().any(|needle| failure_debug.contains(needle));
        if has(&["ERR_PROPOSAL_EXPIRED", "ERR_EXPIRED", "proposal expired"]) {
            Self::RequestExpired
        } else if has(&["ERR_PROPOSAL_NOT_READY_FOR_VOTE", "ERR_NO_PROPOSAL"]) {
            Self::RequestNotActive
        } else if has(&["ERR_ALREADY_VOTED"]) {
            Self::AlreadyVoted
        } else if has(&["ERR_PERMISSION_DENIED", "ERR_NOT_ALLOWED"]) {
            Self::InsufficientPermissions
        } else if has(&[
            "is not registered",
            "not registered",
            "ERR_ACCOUNT_NOT_REGISTERED",
        ]) {
            Self::RecipientNotRegistered
        } else if has(&[
            "NotEnoughBalance",
            "LackBalanceForState",
            "not enough balance",
            "doesn't have enough balance",
            "ERR_NOT_ENOUGH_BALANCE",
            "insufficient balance",
        ]) {
            Self::InsufficientBalance
        } else if has(&[
            "Exceeded the prepaid gas",
            "GasExceeded",
            "GasLimitExceeded",
        ]) {
            Self::OutOfGas
        } else {
            Self::Unknown
        }
    }

    /// Reasons the user caused or can act on; they never page anyone.
    const fn is_caller_caused(self) -> bool {
        !matches!(self, Self::Unknown | Self::OutOfGas)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ErrorDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<TxFailureReason>,
}

/// The one error envelope the frontend understands:
/// `{"error": {code, funds_state, retryable, details}}`. The Error ID shown to
/// the user is the `x-request-id` response header, so it also covers handlers
/// that still answer with a bare string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: ApiErrorCode,
    pub funds_state: FundsState,
    pub retryable: bool,
    pub details: ErrorDetails,
}

#[derive(Serialize)]
struct ApiErrorBody<'a> {
    code: ApiErrorCode,
    funds_state: FundsState,
    retryable: bool,
    details: &'a ErrorDetails,
}

#[derive(Serialize)]
struct ApiErrorEnvelope<'a> {
    error: ApiErrorBody<'a>,
}

impl ApiError {
    /// A failure before anything was broadcast, classified by HTTP status.
    pub fn rejected_before_send(status: StatusCode) -> Self {
        let (code, retryable) = match status {
            StatusCode::PAYMENT_REQUIRED => (ApiErrorCode::SponsorshipNotAvailable, false),
            StatusCode::FORBIDDEN => (ApiErrorCode::NotAuthorized, false),
            status if status.is_client_error() => (ApiErrorCode::RequestRejected, false),
            _ => (ApiErrorCode::Unexpected, true),
        };
        Self {
            status,
            code,
            funds_state: FundsState::NotSent,
            retryable,
            details: ErrorDetails::default(),
        }
    }

    /// The transaction was certainly never broadcast.
    pub fn rpc_unavailable() -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            code: ApiErrorCode::RpcUnavailable,
            funds_state: FundsState::NotSent,
            retryable: true,
            details: ErrorDetails::default(),
        }
    }

    /// The transaction may have been broadcast; its outcome is not known.
    pub fn tx_status_unknown(tx_hash: Option<String>) -> Self {
        Self {
            status: StatusCode::GATEWAY_TIMEOUT,
            code: ApiErrorCode::TxStatusUnknown,
            funds_state: FundsState::Unknown,
            retryable: false,
            details: ErrorDetails {
                tx_hash,
                reason: None,
            },
        }
    }

    /// The transaction landed and failed on-chain.
    pub fn tx_failed(tx_hash: String, reason: TxFailureReason) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: ApiErrorCode::TxFailed,
            funds_state: FundsState::FailedOnchain,
            retryable: false,
            details: ErrorDetails {
                tx_hash: Some(tx_hash),
                reason: Some(reason),
            },
        }
    }

    fn envelope(&self) -> ApiErrorEnvelope<'_> {
        ApiErrorEnvelope {
            error: ApiErrorBody {
                code: self.code,
                funds_state: self.funds_state,
                retryable: self.retryable,
                details: &self.details,
            },
        }
    }

    /// Whether this failure should alert (→ Sentry) rather than only be logged.
    /// Caller-caused rejections and on-chain failures the user can act on never
    /// alert; an unexplained on-chain failure does.
    pub fn is_alertable(&self) -> bool {
        match self.details.reason {
            Some(reason) => !reason.is_caller_caused(),
            None => self.status.is_server_error(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.envelope())).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_the_spec_envelope() {
        let error = ApiError::tx_failed("8xQk".to_owned(), TxFailureReason::RequestExpired);
        let body = serde_json::to_value(error.envelope()).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "error": {
                    "code": "TX_FAILED",
                    "funds_state": "failed_onchain",
                    "retryable": false,
                    "details": { "tx_hash": "8xQk", "reason": "REQUEST_EXPIRED" }
                }
            })
        );
    }

    #[test]
    fn unknown_status_is_never_retryable() {
        let error = ApiError::tx_status_unknown(None);
        assert_eq!(error.funds_state, FundsState::Unknown);
        assert!(!error.retryable);
    }

    #[test]
    fn pre_send_rejections_map_by_status() {
        let out_of_credits = ApiError::rejected_before_send(StatusCode::PAYMENT_REQUIRED);
        assert_eq!(out_of_credits.code, ApiErrorCode::SponsorshipNotAvailable);
        assert!(!out_of_credits.is_alertable());

        let forbidden = ApiError::rejected_before_send(StatusCode::FORBIDDEN);
        assert_eq!(forbidden.code, ApiErrorCode::NotAuthorized);

        let server = ApiError::rejected_before_send(StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(server.code, ApiErrorCode::Unexpected);
        assert!(server.retryable);
        assert!(server.is_alertable());
    }

    #[test]
    fn classifies_on_chain_failure_reasons() {
        let cases = [
            (
                "ActionError { kind: FunctionCallError(ExecutionError(\"Smart contract panicked: ERR_PROPOSAL_EXPIRED\")) }",
                TxFailureReason::RequestExpired,
            ),
            (
                "Smart contract panicked: ERR_ALREADY_VOTED",
                TxFailureReason::AlreadyVoted,
            ),
            (
                "Smart contract panicked: ERR_PROPOSAL_NOT_READY_FOR_VOTE",
                TxFailureReason::RequestNotActive,
            ),
            (
                "Smart contract panicked: ERR_PERMISSION_DENIED",
                TxFailureReason::InsufficientPermissions,
            ),
            (
                "Smart contract panicked: The account bob.near is not registered",
                TxFailureReason::RecipientNotRegistered,
            ),
            (
                "ActionError { kind: LackBalanceForState { account_id: .. } }",
                TxFailureReason::InsufficientBalance,
            ),
            (
                "FunctionCallError(ExecutionError(\"Exceeded the prepaid gas.\"))",
                TxFailureReason::OutOfGas,
            ),
            ("something new", TxFailureReason::Unknown),
        ];
        for (failure_debug, expected) in cases {
            assert_eq!(TxFailureReason::classify(failure_debug), expected);
        }
    }

    #[test]
    fn only_unexplained_on_chain_failures_alert() {
        let expired = ApiError::tx_failed("h".to_owned(), TxFailureReason::RequestExpired);
        assert!(!expired.is_alertable());
        let unknown = ApiError::tx_failed("h".to_owned(), TxFailureReason::Unknown);
        assert!(unknown.is_alertable());
    }
}

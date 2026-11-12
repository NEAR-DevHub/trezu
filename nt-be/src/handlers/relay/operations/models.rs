use std::{fmt, str::FromStr};

use axum::http::StatusCode;
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use near_api::AccountId;
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::utils::api_error::{ApiError, TxFailureReason};

macro_rules! pg_enum {
    ($name:ident, $type_name:literal, { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, sqlx::Type, Serialize)]
        #[sqlx(type_name = $type_name, rename_all = "snake_case")]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

pg_enum!(OperationKind, "relay_operation_kind", {
    AddProposal => "add_proposal",
    ActProposal => "act_proposal",
    WalletReplay => "wallet_replay",
});

// `pending` covers the whole life of an operation until it is terminal; what
// to do next is derived from its transactions, not from a sub-state.
pg_enum!(OperationState, "relay_operation_state", {
    Pending => "pending",
    Succeeded => "succeeded",
    Failed => "failed",
    ManualReview => "manual_review",
});

impl OperationState {
    pub const fn is_terminal(self) -> bool {
        !matches!(self, Self::Pending)
    }
}

// `prepared` is signed and committed but never sent; `pending` has been
// handed to the network at least once and is reconciled by hash.
pg_enum!(TransactionState, "relay_transaction_state", {
    Prepared => "prepared",
    Pending => "pending",
    Succeeded => "succeeded",
    Failed => "failed",
    Superseded => "superseded",
});

/// A `step_key` value that is not one of the known steps.
#[derive(Debug)]
pub struct UnknownStepKey(pub String);

impl fmt::Display for UnknownStepKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown step_key: {}", self.0)
    }
}

impl std::error::Error for UnknownStepKey {}

/// Which on-chain step of the workflow a transaction performs. Registrations
/// are batched per token contract (one transaction carries every
/// `storage_deposit` for that token); `chunk` splits oversized batches.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum StepKey {
    StorageTopUp,
    Registration { token: AccountId, chunk: u32 },
    Relay,
}

impl StepKey {
    const REGISTRATION_PREFIX: &'static str = "registration:";

    pub const fn is_relay(&self) -> bool {
        matches!(self, Self::Relay)
    }
}

impl fmt::Display for StepKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StorageTopUp => f.write_str("storage_topup"),
            Self::Registration { token, chunk } => {
                write!(f, "{}{token}:{chunk}", Self::REGISTRATION_PREFIX)
            }
            Self::Relay => f.write_str("relay"),
        }
    }
}

impl FromStr for StepKey {
    type Err = UnknownStepKey;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let unknown = || UnknownStepKey(value.to_owned());
        match value {
            "storage_topup" => Ok(Self::StorageTopUp),
            "relay" => Ok(Self::Relay),
            other => {
                let rest = other
                    .strip_prefix(Self::REGISTRATION_PREFIX)
                    .ok_or_else(unknown)?;
                let (token, chunk) = rest.rsplit_once(':').ok_or_else(unknown)?;
                Ok(Self::Registration {
                    token: token.parse().map_err(|_| unknown())?,
                    chunk: chunk.parse().map_err(|_| unknown())?,
                })
            }
        }
    }
}

impl TryFrom<String> for StepKey {
    type Error = UnknownStepKey;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        value.parse()
    }
}

/// Server-derived key that makes retries of one signed action converge on one
/// operation. Each component is length-prefixed so no two inputs share a hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotencyKey(String);

impl IdempotencyKey {
    pub fn derive(
        treasury_id: &AccountId,
        actor_account_id: &AccountId,
        signed_request: &[u8],
    ) -> Self {
        let mut hasher = Sha256::new();
        for part in [
            treasury_id.as_bytes(),
            actor_account_id.as_bytes(),
            signed_request,
        ] {
            hasher.update((part.len() as u64).to_be_bytes());
            hasher.update(part);
        }
        Self(hex::encode(hasher.finalize()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Why an operation ended in `failed`, as stored in `failure_code`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FailureCode {
    /// The user's delegate action expired before the relay could land.
    DelegateExpired,
    /// Every RPC provider refused the signed bytes before broadcast.
    NotSent,
    /// A sponsor-side step (storage top-up, registration) failed on chain.
    SponsorStepFailed,
    /// The relay landed and failed on chain.
    OnChain(TxFailureReason),
}

impl FailureCode {
    const ON_CHAIN_PREFIX: &'static str = "TX_FAILED:";

    pub fn as_text(&self) -> String {
        match self {
            Self::DelegateExpired => "DELEGATE_EXPIRED".to_owned(),
            Self::NotSent => "NOT_SENT".to_owned(),
            Self::SponsorStepFailed => "SPONSOR_STEP_FAILED".to_owned(),
            Self::OnChain(reason) => format!("{}{}", Self::ON_CHAIN_PREFIX, reason_text(*reason)),
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "DELEGATE_EXPIRED" => Some(Self::DelegateExpired),
            "NOT_SENT" => Some(Self::NotSent),
            "SPONSOR_STEP_FAILED" => Some(Self::SponsorStepFailed),
            other => other
                .strip_prefix(Self::ON_CHAIN_PREFIX)
                .and_then(parse_reason)
                .map(Self::OnChain),
        }
    }

    /// The same error envelope the inline relay path returns for this failure.
    pub fn api_error(&self, tx_hash: Option<String>) -> ApiError {
        match self {
            Self::DelegateExpired => {
                let mut error = ApiError::rejected_before_send(StatusCode::BAD_REQUEST);
                error.retryable = true;
                error
            }
            Self::NotSent => ApiError::rpc_unavailable(),
            Self::SponsorStepFailed => {
                ApiError::rejected_before_send(StatusCode::INTERNAL_SERVER_ERROR)
            }
            Self::OnChain(reason) => ApiError::tx_failed(tx_hash.unwrap_or_default(), *reason),
        }
    }
}

fn reason_text(reason: TxFailureReason) -> String {
    serde_json::to_value(reason)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "UNKNOWN".to_owned())
}

fn parse_reason(text: &str) -> Option<TxFailureReason> {
    serde_json::from_value(serde_json::Value::String(text.to_owned())).ok()
}

/// Input for a new operation row. `submission_payload` is the user's original
/// signed request, byte for byte.
#[derive(Debug, Clone)]
pub struct NewRelayOperation {
    pub idempotency_key: IdempotencyKey,
    pub treasury_id: AccountId,
    pub actor_account_id: AccountId,
    pub operation_kind: OperationKind,
    pub submission_payload: Vec<u8>,
    pub credit_reserved: bool,
    pub proposal_type: Option<String>,
    pub address_book_payment: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RelayOperation {
    pub id: Uuid,
    pub idempotency_key: String,
    #[sqlx(try_from = "String")]
    pub treasury_id: AccountId,
    #[sqlx(try_from = "String")]
    pub actor_account_id: AccountId,
    pub operation_kind: OperationKind,
    pub submission_payload: Vec<u8>,
    pub state: OperationState,
    pub credit_reserved: bool,
    pub proposal_type: Option<String>,
    pub address_book_payment: bool,
    pub proposal_ids: Option<Vec<i64>>,
    pub failure_code: Option<String>,
    pub last_error: Option<String>,
    pub lease_token: Option<Uuid>,
    pub lease_until: Option<DateTime<Utc>>,
    pub next_attempt_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl RelayOperation {
    /// The lease a claim handed out; `None` on a row this worker does not hold.
    pub fn lease(&self) -> Option<OperationLease> {
        self.lease_token.map(|token| OperationLease {
            operation_id: self.id,
            token,
        })
    }

    pub fn failure(&self) -> Option<FailureCode> {
        self.failure_code.as_deref().and_then(FailureCode::parse)
    }
}

/// Proof of ownership for every write to an operation and its transactions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OperationLease {
    pub operation_id: Uuid,
    pub token: Uuid,
}

#[derive(Debug, Clone)]
pub enum OperationOutcome {
    Succeeded {
        proposal_ids: Vec<i64>,
    },
    Failed {
        failure_code: FailureCode,
        reason: String,
    },
    ManualReview {
        reason: String,
    },
}

impl OperationOutcome {
    pub const fn state(&self) -> OperationState {
        match self {
            Self::Succeeded { .. } => OperationState::Succeeded,
            Self::Failed { .. } => OperationState::Failed,
            Self::ManualReview { .. } => OperationState::ManualReview,
        }
    }
}

/// A transaction signed once and ready to be committed before its broadcast.
#[derive(Debug, Clone)]
pub struct PreparedTransaction {
    pub step_key: StepKey,
    pub public_key: String,
    pub nonce: i64,
    pub valid_until_height: i64,
    pub tx_hash: String,
    pub signed_tx: Vec<u8>,
    pub spend_yocto: BigDecimal,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RelayTransaction {
    pub id: Uuid,
    pub operation_id: Uuid,
    #[sqlx(try_from = "String")]
    pub step_key: StepKey,
    pub state: TransactionState,
    pub public_key: String,
    pub nonce: i64,
    pub valid_until_height: i64,
    pub tx_hash: String,
    pub signed_tx: Vec<u8>,
    pub spend_yocto: BigDecimal,
    pub broadcast_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub enum TransactionOutcome {
    Succeeded,
    Failed {
        reason: String,
    },
    /// Proven unable to land (nonce passed or validity window closed); its
    /// step is free for a replacement.
    Superseded {
        reason: String,
    },
}

impl TransactionOutcome {
    pub const fn state(&self) -> TransactionState {
        match self {
            Self::Succeeded => TransactionState::Succeeded,
            Self::Failed { .. } => TransactionState::Failed,
            Self::Superseded { .. } => TransactionState::Superseded,
        }
    }
}

/// Queue depth and age for job health and alerting.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct RelayQueueHealth {
    pub pending_operations: i64,
    pub pending_transactions: i64,
    pub oldest_pending_seconds: Option<i64>,
    pub manual_review_operations: i64,
}

/// What a client may learn about a submission: the same payload on the status
/// endpoint, the `202` body and the SSE event. Never signed bytes or sponsor
/// details.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaySubmissionStatus {
    pub submission_id: Uuid,
    pub treasury_id: String,
    pub state: OperationState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_ids: Option<Vec<u64>>,
    /// The `{code, funds_state, retryable, details}` error body on failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<serde_json::Value>,
}

impl RelaySubmissionStatus {
    pub fn from_rows(operation: &RelayOperation, transactions: &[RelayTransaction]) -> Self {
        let relay = transactions
            .iter()
            .filter(|tx| tx.step_key.is_relay() && tx.state != TransactionState::Superseded)
            .max_by_key(|tx| (tx.state == TransactionState::Succeeded, tx.created_at));
        let tx_hash = relay.map(|tx| tx.tx_hash.clone());
        let error = match operation.state {
            OperationState::Failed => operation
                .failure()
                .map(|failure| failure.api_error(tx_hash.clone()).body()),
            OperationState::ManualReview => {
                Some(ApiError::tx_status_unknown(tx_hash.clone()).body())
            }
            OperationState::Pending | OperationState::Succeeded => None,
        };
        Self {
            submission_id: operation.id,
            treasury_id: operation.treasury_id.to_string(),
            state: operation.state,
            tx_hash,
            proposal_ids: operation
                .proposal_ids
                .as_ref()
                .map(|ids| ids.iter().map(|id| *id as u64).collect()),
            error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_keys_round_trip() {
        let keys = [
            StepKey::StorageTopUp,
            StepKey::Registration {
                token: "usdc.near".parse().unwrap(),
                chunk: 2,
            },
            StepKey::Relay,
        ];
        for key in keys {
            assert_eq!(key.to_string().parse::<StepKey>().unwrap(), key);
        }
        assert!("registration:usdc.near".parse::<StepKey>().is_err());
    }

    #[test]
    fn failure_codes_round_trip_and_map_to_api_errors() {
        let codes = [
            FailureCode::DelegateExpired,
            FailureCode::NotSent,
            FailureCode::SponsorStepFailed,
            FailureCode::OnChain(TxFailureReason::AlreadyVoted),
        ];
        for code in codes {
            assert_eq!(FailureCode::parse(&code.as_text()).unwrap(), code);
        }
        let expired = FailureCode::DelegateExpired.api_error(None);
        assert_eq!(expired.status, StatusCode::BAD_REQUEST);
        assert!(expired.retryable);
        let on_chain =
            FailureCode::OnChain(TxFailureReason::AlreadyVoted).api_error(Some("h".to_owned()));
        assert_eq!(on_chain.details.tx_hash.as_deref(), Some("h"));
        assert!(!on_chain.is_alertable());
    }
}

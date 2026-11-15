//! Reading a relay's `send_tx` / `tx` result from the raw RPC JSON.
//!
//! near-api cannot represent an ML-DSA-65 key, so the relay worker builds its
//! transactions with `near-primitives` and reads their outcome here.

use base64::Engine as _;
use near_api::AccountId;
use near_primitives::types::AccountId as ProtocolAccountId;
use serde_json::Value;

use crate::utils::api_error::TxFailureReason;

/// What a landed post-quantum relay produced, read from the RPC JSON. The
/// near-api outcome type cannot be built from this response: its transaction
/// view includes the ML-DSA public key, which that decoder rejects.
#[derive(Debug)]
pub struct ProtocolRelayOutcome {
    pub proposal_ids: Vec<u64>,
}

/// On-chain failure of a landed transaction, classified the same way as the
/// near-api path.
#[derive(Debug)]
pub struct ProtocolRelayFailure {
    pub reason: TxFailureReason,
    pub message: String,
}

pub fn protocol_account(id: &AccountId) -> Result<ProtocolAccountId, String> {
    id.as_str()
        .parse()
        .map_err(|error| format!("invalid account id '{id}': {error}"))
}

/// Read a `send_tx` result object. `Err` is an on-chain failure of this
/// transaction. A transport or JSON-RPC error is the caller's to classify.
pub fn read_send_tx_result(
    result: &Value,
    treasury_id: &str,
) -> Result<ProtocolRelayOutcome, ProtocolRelayFailure> {
    if let Some(message) = execution_failure(result) {
        return Err(ProtocolRelayFailure {
            reason: TxFailureReason::classify(&message),
            message,
        });
    }
    Ok(ProtocolRelayOutcome {
        proposal_ids: proposal_ids(result, treasury_id),
    })
}

fn execution_failure(result: &Value) -> Option<String> {
    if result.pointer("/status/Failure").is_some() {
        return Some(format!("Execution failed: {}", result["status"]));
    }
    let receipts = result.get("receipts_outcome")?.as_array()?;
    let failures: Vec<String> = receipts
        .iter()
        .filter_map(|receipt| {
            receipt
                .pointer("/outcome/status/Failure")
                .map(ToString::to_string)
        })
        .collect();
    if failures.is_empty() {
        return None;
    }
    Some(format!(
        "Relayed transaction landed but {} receipt(s) failed on-chain: {}",
        failures.len(),
        failures.join("; ")
    ))
}

fn proposal_ids(result: &Value, treasury_id: &str) -> Vec<u64> {
    let Some(receipts) = result.get("receipts_outcome").and_then(Value::as_array) else {
        return Vec::new();
    };
    receipts
        .iter()
        .filter_map(|receipt| {
            let outcome = receipt.get("outcome")?;
            if outcome.get("executor_id").and_then(Value::as_str) != Some(treasury_id) {
                return None;
            }
            let encoded = outcome.pointer("/status/SuccessValue")?.as_str()?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .ok()?;
            serde_json::from_slice::<u64>(&bytes).ok()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn proposal_id_is_read_from_the_treasury_receipt() {
        let id_bytes = serde_json::to_vec(&42u64).unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(id_bytes);
        let result = json!({
            "status": { "SuccessValue": "" },
            "receipts_outcome": [{
                "outcome": {
                    "executor_id": "dao.sputnik-dao.near",
                    "status": { "SuccessValue": encoded }
                }
            }]
        });
        let outcome = read_send_tx_result(&result, "dao.sputnik-dao.near").unwrap();
        assert_eq!(outcome.proposal_ids, vec![42]);
    }

    #[test]
    fn a_receipt_failure_is_classified() {
        let result = json!({
            "status": { "SuccessValue": "" },
            "receipts_outcome": [{
                "outcome": {
                    "executor_id": "dao.sputnik-dao.near",
                    "status": { "Failure": { "ActionError": "ERR_ALREADY_VOTED" } }
                }
            }]
        });
        let failure = read_send_tx_result(&result, "dao.sputnik-dao.near").unwrap_err();
        assert_eq!(failure.reason, TxFailureReason::AlreadyVoted);
    }
}

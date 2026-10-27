//! Sponsor submission for an ML-DSA-65 meta-transaction.
//!
//! near-api cannot represent the key, so the outer transaction is built with
//! `near-primitives` and the user's original signed delegate bytes are embedded
//! unchanged. The sponsor still signs that outer transaction with its own key.

use base64::Engine as _;
use near_api::{AccountId, SecretKey as ApiSecretKey};
use near_crypto::SecretKey;
use near_primitives::action::delegate::SignedDelegateAction;
use near_primitives::action::Action;
use near_primitives::hash::CryptoHash;
use near_primitives::transaction::{SignedTransaction, Transaction, TransactionV0};
use near_primitives::types::AccountId as ProtocolAccountId;
use serde_json::Value;

use crate::utils::api_error::TxFailureReason;

/// What a landed post-quantum relay produced, read from the RPC JSON. The
/// near-api outcome type cannot be built from this response: its transaction
/// view includes the ML-DSA public key, which that decoder rejects.
#[derive(Debug)]
pub struct ProtocolRelayOutcome {
    pub tx_hash: String,
    pub proposal_ids: Vec<u64>,
    pub debug: String,
}

/// On-chain failure of a landed transaction, classified the same way as the
/// near-api path.
#[derive(Debug)]
pub struct ProtocolRelayFailure {
    pub tx_hash: String,
    pub reason: TxFailureReason,
    pub message: String,
}

pub fn sponsor_secret(key: &ApiSecretKey) -> Result<SecretKey, String> {
    key.to_string()
        .parse()
        .map_err(|error| format!("sponsor signing key: {error}"))
}

pub fn protocol_account(id: &AccountId) -> Result<ProtocolAccountId, String> {
    id.as_str()
        .parse()
        .map_err(|error| format!("invalid account id '{id}': {error}"))
}

/// Outer sponsor transaction whose single action is the user's delegate
/// action. The delegate bytes are the original payload, not a re-encoding.
pub fn unsigned_relay_transaction(
    signer_id: &AccountId,
    signer_public_key: &near_crypto::PublicKey,
    nonce: u64,
    receiver_id: &AccountId,
    block_hash: [u8; 32],
    delegate: SignedDelegateAction,
) -> Result<Transaction, String> {
    Ok(Transaction::V0(TransactionV0 {
        signer_id: protocol_account(signer_id)?,
        public_key: signer_public_key.clone(),
        nonce,
        receiver_id: protocol_account(receiver_id)?,
        block_hash: CryptoHash(block_hash),
        actions: vec![Action::Delegate(Box::new(delegate))],
    }))
}

pub fn sign_transaction(secret: &SecretKey, transaction: Transaction) -> SignedTransaction {
    let (hash, _) = transaction.get_hash_and_size();
    let signature = secret.sign(hash.as_ref());
    SignedTransaction::new(signature, transaction)
}

pub fn signed_tx_base64(signed: &SignedTransaction) -> String {
    base64::engine::general_purpose::STANDARD.encode(borsh::to_vec(signed).expect("signed tx"))
}

/// Read a `send_tx` result object. `Err` is an on-chain failure of this
/// transaction. A transport or JSON-RPC error is the caller's to classify.
pub fn read_send_tx_result(
    result: &Value,
    treasury_id: &str,
    tx_hash: &str,
) -> Result<ProtocolRelayOutcome, ProtocolRelayFailure> {
    if let Some(message) = execution_failure(result) {
        return Err(ProtocolRelayFailure {
            tx_hash: tx_hash.to_owned(),
            reason: TxFailureReason::classify(&message),
            message,
        });
    }
    Ok(ProtocolRelayOutcome {
        tx_hash: tx_hash.to_owned(),
        proposal_ids: proposal_ids(result, treasury_id),
        debug: result.to_string(),
    })
}

fn execution_failure(result: &Value) -> Option<String> {
    if result.pointer("/status/Failure").is_some() {
        return Some(format!("Execution failed: {}", result["status"]));
    }
    let receipts = result.get("receipts_outcome")?.as_array()?;
    let failures: Vec<String> = receipts
        .iter()
        .filter_map(|receipt| receipt.pointer("/outcome/status/Failure").map(ToString::to_string))
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

/// JSON-RPC `error` values that prove the node refused the transaction before
/// it could be broadcast. Anything else may already be in the network.
pub fn rpc_rejected_before_broadcast(error: &Value) -> bool {
    let rendered = error.to_string();
    rendered.contains("InvalidTransaction")
        || rendered.contains("InvalidTx")
        || rendered.contains("DoesNotTrackShard")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::relay::parse::{MetaRelay, RelaySubmission, parse_relay};
    use borsh::BorshDeserialize;
    use near_crypto::{KeyType, PublicKey, Signature};
    use near_primitives::action::FunctionCallAction;
    use near_primitives::action::delegate::{DelegateAction, NonDelegateAction};
    use serde_json::json;

    fn delegate_bytes() -> Vec<u8> {
        let call = NonDelegateAction::try_from(Action::FunctionCall(Box::new(FunctionCallAction {
            method_name: "add_proposal".to_owned(),
            args: serde_json::to_vec(&json!({
                "proposal": { "description": "d", "kind": { "Transfer": {} } }
            }))
            .unwrap(),
            gas: near_primitives::gas::Gas::from_gas(10),
            deposit: near_api::NearToken::from_yoctonear(0),
        })))
        .unwrap();
        let signed = SignedDelegateAction {
            delegate_action: DelegateAction {
                sender_id: "user.near".parse().unwrap(),
                receiver_id: "dao.sputnik-dao.near".parse().unwrap(),
                actions: vec![call],
                nonce: 3,
                max_block_height: 50,
                public_key: PublicKey::empty(KeyType::MLDSA65),
            },
            signature: Signature::empty(KeyType::MLDSA65),
        };
        borsh::to_vec(&signed).unwrap()
    }

    #[test]
    fn the_outer_transaction_contains_the_original_delegate_bytes() {
        let raw = delegate_bytes();
        let treasury: AccountId = "dao.sputnik-dao.near".parse().unwrap();
        let parsed = parse_relay(treasury, &raw).unwrap();
        let RelaySubmission::MetaTransaction(MetaRelay::PostQuantum { sender_id, bytes }) =
            parsed.submission
        else {
            panic!("expected post-quantum meta relay");
        };
        assert_eq!(bytes, raw);

        let secret = SecretKey::from_seed(KeyType::ED25519, "relay-test");
        let delegate = SignedDelegateAction::try_from_slice(&bytes).unwrap();
        let tx = unsigned_relay_transaction(
            &"relayer.near".parse().unwrap(),
            &secret.public_key(),
            9,
            &sender_id,
            [7; 32],
            delegate,
        )
        .unwrap();
        let encoded = borsh::to_vec(&tx).unwrap();
        assert!(
            encoded.windows(raw.len()).any(|window| window == raw),
            "sponsor transaction must carry the user's signed bytes unchanged"
        );
    }

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
        let outcome = read_send_tx_result(&result, "dao.sputnik-dao.near", "hash").unwrap();
        assert_eq!(outcome.proposal_ids, vec![42]);
        assert_eq!(outcome.tx_hash, "hash");
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
        let failure = read_send_tx_result(&result, "dao.sputnik-dao.near", "hash").unwrap_err();
        assert_eq!(failure.reason, TxFailureReason::AlreadyVoted);
        assert_eq!(failure.tx_hash, "hash");
    }

    #[test]
    fn an_invalid_transaction_was_never_broadcast() {
        let error = json!({"name": "HANDLER_ERROR", "cause": {"name": "InvalidTransaction"}});
        assert!(rpc_rejected_before_broadcast(&error));
        assert!(!rpc_rejected_before_broadcast(&json!({"name": "TIMEOUT_ERROR"})));
    }
}

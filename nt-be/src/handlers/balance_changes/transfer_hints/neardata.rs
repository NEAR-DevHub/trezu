//! Neardata block API client
//!
//! Fetches full block data from mainnet.neardata.xyz to extract receipt metadata
//! (counterparty, action_kind, method_name, transaction hashes) in a single HTTP call,
//! replacing multiple individual RPC calls during gap filling.

use reqwest::Client;
use serde::Deserialize;
use std::error::Error;

// ── Client ──────────────────────────────────────────────────────────────────

pub struct NeardataClient {
    client: Client,
    base_url: String,
    api_key: Option<String>,
}

impl NeardataClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            base_url: "https://mainnet.neardata.xyz".to_string(),
            api_key: None,
        }
    }

    pub fn with_api_key(mut self, api_key: impl Into<String>) -> Self {
        self.api_key = Some(api_key.into());
        self
    }

    /// Create from environment (reads FASTNEAR_API_KEY)
    pub fn from_env() -> Self {
        let mut client = Self::new();
        if let Ok(key) = std::env::var("FASTNEAR_API_KEY") {
            client.api_key = Some(key);
        }
        client
    }

    /// Fetch block data and extract receipts/transactions relevant to an account.
    pub async fn fetch_account_block_data(
        &self,
        block_height: u64,
        account_id: &str,
    ) -> Result<NeardataAccountBlock, Box<dyn Error + Send + Sync>> {
        let url = format!("{}/v0/block/{}", self.base_url, block_height);

        let mut req = self.client.get(&url);
        if let Some(api_key) = &self.api_key {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = req.send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Neardata API error at block {}: {} - {}",
                block_height, status, body
            )
            .into());
        }

        let block: NeardataBlock = response.json().await?;

        let timestamp_nanos = block.block.header.timestamp as i64;

        let mut receipts = Vec::new();
        let mut transactions = Vec::new();

        for shard in &block.shards {
            // Receipts from chunks: these are the incoming action receipts
            if let Some(chunk) = &shard.chunk {
                for r in &chunk.receipts {
                    if r.receiver_id == account_id {
                        if let Some(action) = &r.receipt.action {
                            let (action_kind, method_name, deposit) =
                                extract_action_info(&action.actions);
                            receipts.push(AccountReceipt {
                                receipt_id: r.receipt_id.clone(),
                                predecessor_id: r.predecessor_id.clone(),
                                receiver_id: r.receiver_id.clone(),
                                signer_id: action.signer_id.clone(),
                                action_kind,
                                method_name,
                                deposit,
                            });
                        }
                    }
                }

                // Transactions in chunks
                for t in &chunk.transactions {
                    let tx = &t.transaction;
                    if tx.signer_id == account_id || tx.receiver_id == account_id {
                        let receipt_ids = t
                            .outcome
                            .as_ref()
                            .and_then(|o| {
                                o.execution_outcome
                                    .as_ref()
                                    .map(|eo| eo.outcome.receipt_ids.clone())
                            })
                            .unwrap_or_default();
                        transactions.push(AccountTransaction {
                            hash: tx.hash.clone(),
                            signer_id: tx.signer_id.clone(),
                            receiver_id: tx.receiver_id.clone(),
                            receipt_ids,
                        });
                    }
                }
            }

            // Receipt execution outcomes: get tx_hash for receipts involving account
            for reo in &shard.receipt_execution_outcomes {
                let executor = reo
                    .execution_outcome
                    .as_ref()
                    .map(|eo| eo.outcome.executor_id.as_str())
                    .unwrap_or("");
                if executor == account_id {
                    if let Some(tx_hash) = &reo.tx_hash {
                        // Check if we already have this tx_hash from transactions
                        if !transactions.iter().any(|t| t.hash == *tx_hash) {
                            let receipt_id = reo
                                .execution_outcome
                                .as_ref()
                                .map(|eo| eo.id.clone())
                                .unwrap_or_default();
                            transactions.push(AccountTransaction {
                                hash: tx_hash.clone(),
                                signer_id: String::new(), // not available from execution outcome
                                receiver_id: String::new(),
                                receipt_ids: vec![receipt_id],
                            });
                        }
                    }
                }
            }
        }

        Ok(NeardataAccountBlock {
            block_height,
            timestamp_nanos,
            receipts,
            transactions,
        })
    }
}

// ── Extracted account-level types ───────────────────────────────────────────

/// Block data filtered to a specific account
pub struct NeardataAccountBlock {
    pub block_height: u64,
    pub timestamp_nanos: i64,
    pub receipts: Vec<AccountReceipt>,
    pub transactions: Vec<AccountTransaction>,
}

/// A receipt relevant to the monitored account
pub struct AccountReceipt {
    pub receipt_id: String,
    pub predecessor_id: String,
    pub receiver_id: String,
    pub signer_id: String,
    pub action_kind: Option<String>,
    pub method_name: Option<String>,
    pub deposit: Option<String>,
}

/// A transaction involving the monitored account
pub struct AccountTransaction {
    pub hash: String,
    pub signer_id: String,
    pub receiver_id: String,
    pub receipt_ids: Vec<String>,
}

// ── Serde types for neardata JSON ───────────────────────────────────────────

#[derive(Deserialize)]
struct NeardataBlock {
    block: BlockWrapper,
    #[serde(default)]
    shards: Vec<NeardataShard>,
}

#[derive(Deserialize)]
struct BlockWrapper {
    header: BlockHeader,
}

#[derive(Deserialize)]
struct BlockHeader {
    #[allow(dead_code)]
    height: u64,
    timestamp: u64,
}

#[derive(Deserialize)]
struct NeardataShard {
    chunk: Option<NeardataChunk>,
    #[serde(default)]
    receipt_execution_outcomes: Vec<ReceiptExecutionOutcome>,
}

#[derive(Deserialize)]
struct NeardataChunk {
    #[serde(default)]
    receipts: Vec<NeardataReceipt>,
    #[serde(default)]
    transactions: Vec<NeardataTransaction>,
}

#[derive(Deserialize)]
struct NeardataReceipt {
    receipt_id: String,
    predecessor_id: String,
    receiver_id: String,
    receipt: ReceiptBody,
}

#[derive(Deserialize)]
struct ReceiptBody {
    #[serde(rename = "Action")]
    action: Option<ActionBody>,
}

#[derive(Deserialize)]
struct ActionBody {
    #[serde(default)]
    actions: Vec<NeardataAction>,
    #[serde(default)]
    signer_id: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum NeardataAction {
    Transfer(TransferAction),
    FunctionCall(FunctionCallAction),
    Other(()),
}

#[derive(Deserialize)]
struct TransferAction {
    #[serde(rename = "Transfer")]
    transfer: TransferDeposit,
}

#[derive(Deserialize)]
struct TransferDeposit {
    deposit: String,
}

#[derive(Deserialize)]
struct FunctionCallAction {
    #[serde(rename = "FunctionCall")]
    function_call: FunctionCallData,
}

#[derive(Deserialize)]
struct FunctionCallData {
    method_name: String,
    deposit: String,
}

#[derive(Deserialize)]
struct NeardataTransaction {
    transaction: TransactionInner,
    outcome: Option<TransactionOutcome>,
}

#[derive(Deserialize)]
struct TransactionInner {
    hash: String,
    signer_id: String,
    receiver_id: String,
}

#[derive(Deserialize)]
struct TransactionOutcome {
    execution_outcome: Option<ExecutionOutcomeWrapper>,
}

#[derive(Deserialize)]
struct ReceiptExecutionOutcome {
    execution_outcome: Option<ExecutionOutcomeWrapper>,
    tx_hash: Option<String>,
}

#[derive(Deserialize)]
struct ExecutionOutcomeWrapper {
    #[serde(default)]
    id: String,
    outcome: OutcomeData,
}

#[derive(Deserialize)]
struct OutcomeData {
    #[serde(default)]
    executor_id: String,
    #[serde(default)]
    receipt_ids: Vec<String>,
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn extract_action_info(
    actions: &[NeardataAction],
) -> (Option<String>, Option<String>, Option<String>) {
    for action in actions {
        match action {
            NeardataAction::Transfer(t) => {
                return (
                    Some("TRANSFER".to_string()),
                    None,
                    Some(t.transfer.deposit.clone()),
                );
            }
            NeardataAction::FunctionCall(f) => {
                return (
                    Some("FUNCTION_CALL".to_string()),
                    Some(f.function_call.method_name.clone()),
                    Some(f.function_call.deposit.clone()),
                );
            }
            NeardataAction::Other(_) => continue,
        }
    }
    (None, None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_action_transfer() {
        let actions = vec![NeardataAction::Transfer(TransferAction {
            transfer: TransferDeposit {
                deposit: "1000000000000000000000000".to_string(),
            },
        })];
        let (kind, method, deposit) = extract_action_info(&actions);
        assert_eq!(kind.as_deref(), Some("TRANSFER"));
        assert!(method.is_none());
        assert_eq!(deposit.as_deref(), Some("1000000000000000000000000"));
    }

    #[test]
    fn test_extract_action_function_call() {
        let actions = vec![NeardataAction::FunctionCall(FunctionCallAction {
            function_call: FunctionCallData {
                method_name: "ft_transfer".to_string(),
                deposit: "1".to_string(),
            },
        })];
        let (kind, method, deposit) = extract_action_info(&actions);
        assert_eq!(kind.as_deref(), Some("FUNCTION_CALL"));
        assert_eq!(method.as_deref(), Some("ft_transfer"));
        assert_eq!(deposit.as_deref(), Some("1"));
    }

    #[test]
    fn test_deserialize_transfer_action() {
        let json = r#"{"Transfer": {"deposit": "2870000000000000000000"}}"#;
        let action: NeardataAction = serde_json::from_str(json).unwrap();
        match action {
            NeardataAction::Transfer(t) => {
                assert_eq!(t.transfer.deposit, "2870000000000000000000");
            }
            _ => panic!("Expected Transfer"),
        }
    }

    #[test]
    fn test_deserialize_function_call_action() {
        let json = r#"{"FunctionCall": {"method_name": "act_proposal", "deposit": "100000000000000000000000", "gas": 200000000000000, "args": "eyJpZCI6MH0="}}"#;
        let action: NeardataAction = serde_json::from_str(json).unwrap();
        match action {
            NeardataAction::FunctionCall(f) => {
                assert_eq!(f.function_call.method_name, "act_proposal");
                assert_eq!(f.function_call.deposit, "100000000000000000000000");
            }
            _ => panic!("Expected FunctionCall"),
        }
    }

    #[test]
    fn test_deserialize_receipt_body() {
        let json = r#"{
            "Action": {
                "actions": [{"Transfer": {"deposit": "2870000000000000000000"}}],
                "gas_price": "100000000",
                "input_data_ids": [],
                "is_promise_yield": false,
                "output_data_receivers": [],
                "signer_id": "sponsor.trezu.near",
                "signer_public_key": "ed25519:7r9YdTv6TGpWaC6FW5MWjA3h2EAiASsDuvGmCsCEjyEv"
            }
        }"#;
        let body: ReceiptBody = serde_json::from_str(json).unwrap();
        let action = body.action.unwrap();
        assert_eq!(action.signer_id, "sponsor.trezu.near");
        assert_eq!(action.actions.len(), 1);
    }

    #[test]
    fn test_deserialize_data_receipt() {
        // Data receipts have no Action field — should deserialize with action = None
        let json = r#"{"Data": {"data": null, "data_id": "abc123"}}"#;
        let body: ReceiptBody = serde_json::from_str(json).unwrap();
        assert!(body.action.is_none());
    }
}

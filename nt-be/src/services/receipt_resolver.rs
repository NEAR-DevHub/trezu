//! Receipt-to-transaction resolution.
//!
//! Traces a receipt_id back to its originating transaction hash using
//! `EXPERIMENTAL_receipt` and block scanning: fetch the receipt's on-chain
//! `signer_id`, walk `account_changes` on that signer for
//! `TransactionProcessing` entries, and confirm the candidate with
//! `EXPERIMENTAL_tx_status`.

use crate::utils::jsonrpc::create_rpc_client;
use crate::utils::transport::with_transport_retry;
use near_api::NetworkConfig;
use near_jsonrpc_client::{JsonRpcClient, methods};
use near_jsonrpc_primitives::types::receipts::ReceiptReference;
use near_primitives::types::{BlockId, BlockReference};
use near_primitives::views::FinalExecutionOutcomeViewEnum;
use std::error::Error;

/// Result of resolving a receipt to its originating transaction
#[derive(Debug, Clone)]
pub struct ReceiptTransaction {
    /// The receipt ID that was resolved
    pub receipt_id: String,
    /// The originating transaction hash
    pub transaction_hash: String,
    /// The signer of the originating transaction
    pub signer_id: String,
}

/// Resolve a receipt_id to its originating transaction hash
///
/// 1. Calls `EXPERIMENTAL_receipt` to get the receipt's on-chain `signer_id`
/// 2. Queries `account_changes` on that signer to find `TransactionProcessing` entries
/// 3. Confirms with `EXPERIMENTAL_tx_status` which transaction produced the receipt
///
/// # Arguments
/// * `network` - NEAR network configuration (archival RPC)
/// * `receipt_id` - The receipt ID to resolve
/// * `block_height` - The block height where this receipt was executed
///
/// # Returns
/// `ReceiptTransaction` containing the originating transaction hash
pub async fn resolve_receipt_to_transaction(
    network: &NetworkConfig,
    receipt_id: &str,
    block_height: u64,
) -> Result<ReceiptTransaction, Box<dyn Error + Send + Sync>> {
    let client = create_rpc_client(network)?;

    // Step 1: Fetch receipt to get the on-chain signer_id
    let parsed_receipt_id: near_primitives::hash::CryptoHash = receipt_id.parse()?;
    let receipt_response = with_transport_retry("receipt_for_tx_resolve", || {
        let req = methods::EXPERIMENTAL_receipt::RpcReceiptRequest {
            receipt_reference: ReceiptReference {
                receipt_id: parsed_receipt_id,
            },
        };
        client.call(req)
    })
    .await?;

    // For Action receipts, use signer_id directly and search for this receipt.
    // For Data receipts, find the action receipt that caused the balance change,
    // then search for that receipt instead (data receipts don't appear in tx outcomes).
    let (search_receipt_id, signer_id) = match &receipt_response.receipt {
        near_primitives::views::ReceiptEnumView::Action { signer_id, .. } => {
            (receipt_id.to_string(), signer_id.to_string())
        }
        _ => {
            let receiver = receipt_response.receiver_id.to_string();
            find_action_receipt_at_block(&client, &receiver, block_height).await?
        }
    };

    let parsed_signer: near_primitives::types::AccountId = signer_id.parse()?;

    tracing::debug!(
        "Resolving receipt {} to transaction via account_changes on {} near block {}",
        receipt_id,
        signer_id,
        block_height
    );

    // Step 2: Search for TransactionProcessing on the signer's account.
    // The transaction is included at or before the receipt execution block.
    let mut result = find_transaction_on_signer(
        &client,
        &search_receipt_id,
        &signer_id,
        &parsed_signer,
        block_height,
    )
    .await?;

    // Return the original receipt_id in the result
    result.receipt_id = receipt_id.to_string();
    Ok(result)
}

/// For a Data receipt, find the Action receipt that caused the balance change at this block
///
/// Returns (action_receipt_id, signer_id) — the action receipt can be looked up in tx outcomes
/// (data receipts don't appear in `receipts_outcome`).
async fn find_action_receipt_at_block(
    client: &JsonRpcClient,
    receiver: &str,
    block_height: u64,
) -> Result<(String, String), Box<dyn Error + Send + Sync>> {
    let parsed_receiver: near_primitives::types::AccountId = receiver.parse()?;

    let changes_response = with_transport_retry("account_changes_for_data_receipt", || {
        let req = methods::EXPERIMENTAL_changes::RpcStateChangesInBlockByTypeRequest {
            block_reference: BlockReference::BlockId(BlockId::Height(block_height)),
            state_changes_request:
                near_primitives::views::StateChangesRequestView::AccountChanges {
                    account_ids: vec![parsed_receiver.clone()],
                },
        };
        client.call(req)
    })
    .await?;

    // Find receipt hashes from receipt_processing causes — these are the action receipts
    use near_primitives::views::StateChangeCauseView;
    let mut seen = Vec::new();
    for change in &changes_response.changes {
        if let StateChangeCauseView::ReceiptProcessing { receipt_hash } = &change.cause {
            let hash_str = receipt_hash.to_string();
            if seen.contains(&hash_str) {
                continue;
            }
            seen.push(hash_str);

            // Fetch this receipt to get its signer_id
            let receipt_response = with_transport_retry("receipt_for_data_receipt_signer", || {
                let req = methods::EXPERIMENTAL_receipt::RpcReceiptRequest {
                    receipt_reference: ReceiptReference {
                        receipt_id: *receipt_hash,
                    },
                };
                client.call(req)
            })
            .await?;

            if let near_primitives::views::ReceiptEnumView::Action { signer_id, .. } =
                &receipt_response.receipt
            {
                return Ok((receipt_hash.to_string(), signer_id.to_string()));
            }
        }
    }

    Err(format!(
        "Could not find action receipt for data receipt at block {} on {}",
        block_height, receiver
    )
    .into())
}

/// Search for TransactionProcessing on a signer's account to find the originating transaction
async fn find_transaction_on_signer(
    client: &JsonRpcClient,
    receipt_id: &str,
    signer_id: &str,
    parsed_signer: &near_primitives::types::AccountId,
    block_height: u64,
) -> Result<ReceiptTransaction, Box<dyn Error + Send + Sync>> {
    let search_start = block_height.saturating_sub(5);

    for search_block in (search_start..=block_height).rev() {
        let changes_response = match with_transport_retry("account_changes_for_tx", || {
            let req = methods::EXPERIMENTAL_changes::RpcStateChangesInBlockByTypeRequest {
                block_reference: BlockReference::BlockId(BlockId::Height(search_block)),
                state_changes_request:
                    near_primitives::views::StateChangesRequestView::AccountChanges {
                        account_ids: vec![parsed_signer.clone()],
                    },
            };
            client.call(req)
        })
        .await
        {
            Ok(resp) => resp,
            Err(e) => {
                tracing::debug!(
                    "account_changes on {} at block {} failed: {}",
                    signer_id,
                    search_block,
                    e
                );
                continue;
            }
        };

        // Collect unique transaction_processing tx hashes
        let mut tx_hashes = Vec::new();
        for change in &changes_response.changes {
            use near_primitives::views::StateChangeCauseView;
            if let StateChangeCauseView::TransactionProcessing { tx_hash } = &change.cause {
                let hash_str = tx_hash.to_string();
                if !tx_hashes.contains(&hash_str) {
                    tx_hashes.push(hash_str);
                }
            }
        }

        if tx_hashes.is_empty() {
            continue;
        }

        tracing::debug!(
            "Found {} candidate tx hash(es) at block {} on {}: {:?}",
            tx_hashes.len(),
            search_block,
            signer_id,
            tx_hashes
        );

        // Confirm which transaction produced our receipt
        for tx_hash in &tx_hashes {
            match has_receipt(client, tx_hash, signer_id, receipt_id).await {
                Ok(true) => {
                    tracing::debug!(
                        "Resolved receipt {} to transaction {} (via account_changes on {} at block {})",
                        receipt_id,
                        tx_hash,
                        signer_id,
                        search_block
                    );
                    return Ok(ReceiptTransaction {
                        receipt_id: receipt_id.to_string(),
                        transaction_hash: tx_hash.clone(),
                        signer_id: signer_id.to_string(),
                    });
                }
                Ok(false) => continue,
                Err(e) => {
                    tracing::debug!(
                        "Error checking tx {} for receipt {}: {}",
                        tx_hash,
                        receipt_id,
                        e
                    );
                    continue;
                }
            }
        }
    }

    Err(format!(
        "Could not find originating transaction for receipt {} (signer={}, block={})",
        receipt_id, signer_id, block_height
    )
    .into())
}

/// Check if a transaction produced a specific receipt
async fn has_receipt(
    client: &JsonRpcClient,
    tx_hash: &str,
    sender_account_id: &str,
    target_receipt_id: &str,
) -> Result<bool, Box<dyn Error + Send + Sync>> {
    let parsed_tx_hash: near_primitives::hash::CryptoHash = tx_hash.parse()?;
    let parsed_sender: near_primitives::types::AccountId = sender_account_id.parse()?;

    let tx_response = with_transport_retry("has_receipt_tx_status", || {
        let req = methods::tx::RpcTransactionStatusRequest {
            transaction_info: methods::tx::TransactionInfo::TransactionId {
                tx_hash: parsed_tx_hash,
                sender_account_id: parsed_sender.clone(),
            },
            wait_until: near_primitives::views::TxExecutionStatus::Final,
        };
        client.call(req)
    })
    .await?;

    let receipts_outcome = match &tx_response.final_execution_outcome {
        Some(FinalExecutionOutcomeViewEnum::FinalExecutionOutcome(outcome)) => {
            &outcome.receipts_outcome
        }
        Some(FinalExecutionOutcomeViewEnum::FinalExecutionOutcomeWithReceipt(outcome)) => {
            &outcome.final_outcome.receipts_outcome
        }
        None => return Ok(false),
    };

    Ok(receipts_outcome
        .iter()
        .any(|r| r.id.to_string() == target_receipt_id))
}

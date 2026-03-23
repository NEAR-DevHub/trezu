//! Counterparty Correction for Native NEAR Transfers
//!
//! Fixes balance_changes records where the counterparty was incorrectly set to
//! the meta-tx delegate target or transaction receiver instead of the actual
//! sender/recipient DAO.
//!
//! This is a standalone correction process that queries the app database and
//! resolves correct counterparties via NEAR RPC — no Goldsky data needed.

use crate::utils::jsonrpc::create_rpc_client;
use bigdecimal::Zero;
use near_api::NetworkConfig;
use near_jsonrpc_client::methods;
use near_primitives::views::FinalExecutionOutcomeViewEnum;
use sqlx::PgPool;

use super::utils::with_transport_retry;

/// A balance_changes record with a potentially wrong counterparty.
#[derive(Debug, sqlx::FromRow)]
struct WrongCounterpartyRecord {
    id: i64,
    account_id: String,
    #[allow(dead_code)]
    block_height: i64,
    amount: bigdecimal::BigDecimal,
    transaction_hashes: Vec<String>,
    counterparty: String,
    signer_id: Option<String>,
}

/// Find and correct balance_changes records where the counterparty is likely wrong.
///
/// Identifies records where `token_id = 'near'`, `method_name = 'act_proposal'`,
/// and `counterparty = receiver_id` (the meta-tx delegate target was used instead of
/// the actual sender/recipient DAO). Only processes records with `ABS(amount) > 0.01`
/// to skip gas cost records where the voter is the correct counterparty.
///
/// For each affected record, resolves the correct counterparty via RPC:
/// - Incoming (amount > 0): `EXPERIMENTAL_receipt` → predecessor_id (the sender)
/// - Outgoing (amount < 0): `tx_status` → child receipt executor_id (the recipient)
///
/// Returns the number of records corrected.
/// Maximum number of records to correct per run to limit RPC usage.
const MAX_RECORDS_PER_RUN: i64 = 20;

pub async fn correct_near_counterparties(
    pool: &PgPool,
    network: &NetworkConfig,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let records: Vec<WrongCounterpartyRecord> = sqlx::query_as(
        r#"
        SELECT id, account_id, block_height, amount, transaction_hashes,
               counterparty, signer_id
        FROM balance_changes
        WHERE token_id = 'near'
          AND method_name = 'act_proposal'
          AND counterparty = receiver_id
          AND ABS(amount) > 0.01
        ORDER BY block_height ASC
        LIMIT $1
        "#,
    )
    .bind(MAX_RECORDS_PER_RUN)
    .fetch_all(pool)
    .await?;

    if records.is_empty() {
        return Ok(0);
    }

    log::info!(
        "[counterparty-correction] Found {} records to correct",
        records.len()
    );

    let client = create_rpc_client(network)?;
    let mut corrected = 0usize;

    for record in &records {
        let tx_hash = match record.transaction_hashes.first() {
            Some(h) => h,
            None => continue,
        };

        let signer = match record.signer_id.as_deref() {
            Some(s) => s,
            None => {
                log::warn!(
                    "[counterparty-correction] Skipping record {} for tx {}: missing signer_id",
                    record.id,
                    tx_hash
                );
                continue;
            }
        };

        let parsed_tx_hash: near_primitives::hash::CryptoHash = match tx_hash.parse() {
            Ok(h) => h,
            Err(_) => continue,
        };
        let parsed_sender: near_primitives::types::AccountId = match signer.parse() {
            Ok(s) => s,
            Err(_) => continue,
        };

        // Use EXPERIMENTAL_tx_status to get full receipt data including predecessor_id
        let tx_response = match with_transport_retry("tx_status_correction", || {
            let req = methods::EXPERIMENTAL_tx_status::RpcTransactionStatusRequest {
                transaction_info: methods::EXPERIMENTAL_tx_status::TransactionInfo::TransactionId {
                    tx_hash: parsed_tx_hash,
                    sender_account_id: parsed_sender.clone(),
                },
                wait_until: near_primitives::views::TxExecutionStatus::Final,
            };
            client.call(req)
        })
        .await
        {
            Ok(r) => r,
            Err(e) => {
                log::warn!(
                    "[counterparty-correction] Failed to fetch tx {}: {}",
                    tx_hash,
                    e
                );
                continue;
            }
        };

        let (receipts_outcome, receipts) = match &tx_response.final_execution_outcome {
            Some(FinalExecutionOutcomeViewEnum::FinalExecutionOutcome(o)) => {
                (&o.receipts_outcome, None)
            }
            Some(FinalExecutionOutcomeViewEnum::FinalExecutionOutcomeWithReceipt(o)) => {
                (&o.final_outcome.receipts_outcome, Some(&o.receipts))
            }
            None => continue,
        };

        // Find the receipt that executed on this account
        let our_receipt = match receipts_outcome
            .iter()
            .find(|ro| ro.outcome.executor_id.as_str() == record.account_id)
        {
            Some(r) => r,
            None => {
                log::warn!(
                    "[counterparty-correction] No receipt for {} in tx {}",
                    record.account_id,
                    tx_hash
                );
                continue;
            }
        };

        let new_counterparty = if record.amount > bigdecimal::BigDecimal::zero() {
            // Incoming: get predecessor from full receipt data
            receipts
                .and_then(|rs| rs.iter().find(|r| r.receipt_id == our_receipt.id))
                .map(|r| r.predecessor_id.to_string())
                .filter(|p| *p != record.account_id)
        } else {
            // Outgoing: find child receipt with different executor
            let child_ids: std::collections::HashSet<near_primitives::hash::CryptoHash> =
                our_receipt.outcome.receipt_ids.iter().cloned().collect();

            receipts_outcome
                .iter()
                .find(|ro| {
                    child_ids.contains(&ro.id)
                        && ro.outcome.executor_id.as_str() != record.account_id
                })
                .map(|ro| ro.outcome.executor_id.to_string())
        };

        if let Some(ref new_cp) = new_counterparty
            && *new_cp != record.counterparty
        {
            sqlx::query(
                "UPDATE balance_changes SET counterparty = $1, updated_at = NOW()
                 WHERE id = $2",
            )
            .bind(new_cp)
            .bind(record.id)
            .execute(pool)
            .await?;

            log::info!(
                "[counterparty-correction] id={}: {} → {} (tx={}, amount={})",
                record.id,
                record.counterparty,
                new_cp,
                tx_hash,
                record.amount,
            );
            corrected += 1;
        }
    }

    log::info!(
        "[counterparty-correction] Corrected {}/{} records",
        corrected,
        records.len()
    );

    Ok(corrected)
}

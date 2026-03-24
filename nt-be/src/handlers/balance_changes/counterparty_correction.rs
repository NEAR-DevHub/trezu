//! Counterparty Correction for Native NEAR Transfers
//!
//! Fixes balance_changes records where the counterparty was incorrectly set to
//! the meta-tx delegate target or transaction receiver instead of the actual
//! sender/recipient DAO.
//!
//! This is a standalone correction process that queries the app database and
//! resolves correct counterparties via NEAR RPC — no Goldsky data needed.
//!
//! ## Cursor-based backward scan
//!
//! Progress is tracked in `maintenance_jobs` (row `counterparty_correction`).
//! On the first invocation the cursor is initialised to the highest block
//! height of any matching record; each subsequent call advances the cursor
//! downward by the size of the batch just processed.  The job stops
//! naturally once no matching records remain below the cursor.

use crate::utils::jsonrpc::create_rpc_client;
use bigdecimal::Zero;
use near_api::NetworkConfig;
use near_jsonrpc_client::methods;
use near_primitives::views::FinalExecutionOutcomeViewEnum;
use sqlx::PgPool;

use super::utils::with_transport_retry;

const JOB_NAME: &str = "counterparty_correction";

/// Maximum number of records to examine per run.
const MAX_RECORDS_PER_RUN: i64 = 20;

/// A balance_changes record with a potentially wrong counterparty.
#[derive(Debug, sqlx::FromRow)]
struct WrongCounterpartyRecord {
    id: i64,
    account_id: String,
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
/// Progress is tracked in `maintenance_jobs`.  The scan works **backwards**
/// through block history so that the most-recent (most visible) records are
/// fixed first.  Once no matching records exist below the cursor the function
/// returns 0 and the job is effectively complete.
///
/// Returns the number of records corrected.
pub async fn correct_near_counterparties(
    pool: &PgPool,
    network: &NetworkConfig,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    // --- Resolve the cursor --------------------------------------------------

    let cursor: Option<i64> = sqlx::query_scalar(
        "SELECT last_processed_block FROM maintenance_jobs WHERE job_name = $1",
    )
    .bind(JOB_NAME)
    .fetch_optional(pool)
    .await?;

    let from_block: i64 = match cursor {
        Some(b) => b,
        None => {
            // First run: seed the cursor at the highest matching block so the
            // scan starts at the most recent records and works backwards.
            let max_block: Option<i64> = sqlx::query_scalar(
                r#"
                SELECT MAX(block_height)
                FROM balance_changes
                WHERE (token_id IS NULL OR LOWER(token_id) = 'near')
                  AND method_name = 'act_proposal'
                  AND counterparty = receiver_id
                  AND ABS(amount) > 0.01
                "#,
            )
            .fetch_optional(pool)
            .await?
            .flatten();

            match max_block {
                Some(b) => {
                    sqlx::query(
                        "INSERT INTO maintenance_jobs (job_name, last_processed_block)
                         VALUES ($1, $2)",
                    )
                    .bind(JOB_NAME)
                    .bind(b)
                    .execute(pool)
                    .await?;
                    log::info!(
                        "[counterparty-correction] Initialised cursor at block {}",
                        b
                    );
                    b
                }
                None => {
                    log::info!("[counterparty-correction] No records to correct");
                    return Ok(0);
                }
            }
        }
    };

    // --- Fetch the next batch (backwards from cursor) -----------------------

    let records: Vec<WrongCounterpartyRecord> = sqlx::query_as(
        r#"
        SELECT id, account_id, block_height, amount, transaction_hashes,
               counterparty, signer_id
        FROM balance_changes
        WHERE (token_id IS NULL OR LOWER(token_id) = 'near')
          AND method_name = 'act_proposal'
          AND counterparty = receiver_id
          AND ABS(amount) > 0.01
          AND block_height <= $1
        ORDER BY block_height DESC
        LIMIT $2
        "#,
    )
    .bind(from_block)
    .bind(MAX_RECORDS_PER_RUN)
    .fetch_all(pool)
    .await?;

    if records.is_empty() {
        log::info!(
            "[counterparty-correction] No records at or below block {} — job complete",
            from_block
        );
        return Ok(0);
    }

    log::info!(
        "[counterparty-correction] Processing {} records at or below block {}",
        records.len(),
        from_block,
    );

    // --- Resolve counterparties via RPC -------------------------------------

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

    // --- Advance cursor to one block below the lowest block we processed ----

    let min_block = records
        .iter()
        .map(|r| r.block_height)
        .min()
        .expect("records is non-empty");
    let next_cursor = min_block - 1;

    sqlx::query(
        "UPDATE maintenance_jobs
         SET last_processed_block = $1, updated_at = NOW()
         WHERE job_name = $2",
    )
    .bind(next_cursor)
    .bind(JOB_NAME)
    .execute(pool)
    .await?;

    log::info!(
        "[counterparty-correction] Corrected {}/{} records; cursor advanced to block {}",
        corrected,
        records.len(),
        next_cursor,
    );

    Ok(corrected)
}

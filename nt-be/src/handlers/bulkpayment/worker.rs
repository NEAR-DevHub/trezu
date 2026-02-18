use crate::app_state::AppState;
use near_api::Contract;
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Minimal response type for view_list contract call
#[derive(Debug, Deserialize)]
struct PaymentListView {
    status: PaymentListStatus,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
#[allow(non_snake_case)]
enum PaymentListStatus {
    Simple(String),
    Enum {
        Pending: Option<()>,
        Approved: Option<()>,
        Rejected: Option<()>,
    },
}

impl PaymentListStatus {
    fn is_approved(&self) -> bool {
        matches!(
            self,
            PaymentListStatus::Simple(s) if s == "Approved"
        ) || matches!(
            self,
            PaymentListStatus::Enum { Approved: Some(_), .. }
        )
    }

    fn is_pending(&self) -> bool {
        matches!(
            self,
            PaymentListStatus::Simple(s) if s == "Pending"
        ) || matches!(
            self,
            PaymentListStatus::Enum { Pending: Some(_), .. }
        )
    }
}

lazy_static::lazy_static! {
    /// Shared state for tracking pending payment lists
    /// This is used to avoid querying the contract for every poll
    static ref PENDING_LISTS: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
}

/// Add a list_id to the set of pending lists to be processed by the worker
pub async fn add_pending_list(list_id: String) {
    log::info!("Adding list {} to payout worker queue", list_id);
    let mut pending = PENDING_LISTS.lock().await;
    pending.insert(list_id);
    log::info!("Payout worker queue now has {} lists", pending.len());
}

/// Query the bulk payment contract for pending payment lists and process them
///
/// This function checks known pending lists on-chain and calls payout_batch
/// to process pending payments.
///
/// Returns the number of batches processed.
pub async fn query_and_process_pending_lists(
    state: &Arc<AppState>,
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    // Get a copy of pending list IDs
    let list_ids: Vec<String> = {
        let pending = PENDING_LISTS.lock().await;
        pending.iter().cloned().collect()
    };

    if list_ids.is_empty() {
        return Ok(0);
    }

    log::info!(
        "Worker checking {} pending lists: {:?}",
        list_ids.len(),
        list_ids
    );

    let mut processed_count = 0;
    let mut completed_lists = Vec::new();

    for list_id in &list_ids {
        // First check list status via view call before attempting payout
        log::info!("Checking status of list {}", list_id);

        let view_result = Contract(state.bulk_payment_contract_id.clone())
            .call_function(
                "view_list",
                serde_json::json!({
                    "list_id": list_id
                }),
            )
            .read_only::<PaymentListView>()
            .fetch_from(&state.network)
            .await;

        match view_result {
            Ok(response) => {
                let list = response.data;
                if list.status.is_pending() {
                    log::debug!("List {} is still pending approval, skipping", list_id);
                    continue;
                }
                if !list.status.is_approved() {
                    // List is rejected or in an unknown state — remove from queue
                    log::info!(
                        "List {} is not approved (rejected or unknown status), removing from queue",
                        list_id
                    );
                    completed_lists.push(list_id.clone());
                    continue;
                }
            }
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("not found") {
                    log::info!("List {} not found on-chain, removing from queue", list_id);
                    completed_lists.push(list_id.clone());
                } else {
                    log::error!("Failed to view list {}: {}", list_id, err_str);
                }
                continue;
            }
        }

        // List is approved — proceed with payout
        log::info!("Processing payout batch for approved list {}", list_id);

        let call_result = Contract(state.bulk_payment_contract_id.clone())
            .call_function(
                "payout_batch",
                serde_json::json!({
                    "list_id": list_id
                }),
            )
            .transaction()
            .with_signer(state.signer_id.clone(), state.signer.clone())
            .send_to(&state.network)
            .await;

        match call_result {
            Ok(_) => {
                processed_count += 1;
                log::info!("Successfully processed batch for list {}", list_id);
            }
            Err(e) => {
                let err_str = e.to_string();
                log::error!("Failed to process batch for list {}: {}", list_id, err_str);

                // Remove list from tracking if it's not found or completed
                if err_str.contains("not found")
                    || err_str.contains("No pending payments")
                {
                    log::info!("Removing list {} from worker queue", list_id);
                    completed_lists.push(list_id.clone());
                }
            }
        }
    }

    // Remove completed lists from tracking
    if !completed_lists.is_empty() {
        let mut pending = PENDING_LISTS.lock().await;
        for list_id in completed_lists {
            pending.remove(&list_id);
        }
    }

    Ok(processed_count)
}

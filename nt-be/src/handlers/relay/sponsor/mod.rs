//! Sponsorship rules shared by the relay worker: the spend policy
//! ([`policy`]), the RPC retry helper ([`retry`]) and how a landed outcome's
//! receipt failures are worded.

pub mod policy;
pub mod retry;

use near_api::types::transaction::result::ExecutionFinalResult;

pub(crate) fn receipt_failure_message(outcome: &ExecutionFinalResult) -> Option<String> {
    let failures = outcome.receipt_failures();
    if failures.is_empty() {
        return None;
    }
    let details = failures
        .iter()
        .map(|failure| format!("{:?}", failure))
        .collect::<Vec<_>>()
        .join("; ");
    Some(format!(
        "Relayed transaction landed but {} receipt(s) failed on-chain: {}",
        failures.len(),
        details
    ))
}

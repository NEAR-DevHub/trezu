//! Confidential bulk-payment processor.
//!
//! Driven by the same worker loop as the public bulk-payment payouts.
//! Walks `confidential_bulk_payments` rows and pushes each through the
//! state machine:
//!
//! 0. `pending` → once the header intent is `submitted` to 1Click, link the
//!    on-chain `proposal_id` and move to `activating`. The vote relay does
//!    the same when the MPC signature is in its own outcome; this step
//!    covers headers the per-DAO poll submitted from chain instead.
//! 1. `activating` → call sub `activate(proposal_id)` (0.5 NEAR deposit).
//!    Move to `signing`.
//! 2. `signing` → view sub `get_activation`. If the activation is `Ready`
//!    and there are still `Pending` entries, call `ping`. If `Done` with
//!    `SignFailed` entries, call `retry_failed` (up to
//!    `CONFIDENTIAL_BULK_MAX_SIGN_RETRIES`, default 3)
//!    so the next tick pings them again. Otherwise submit every signed
//!    recipient intent to 1Click in parallel and mark the bulk row
//!    `completed`.
//!
//! Why retries matter: a `ping` dispatches signs until its gas runs low, so
//! the last signs of a large batch get starved and v1.signer rejects them
//! ("Provided gas is lower than required"). Each retry handles fewer hashes
//! with the same gas, so it converges.
//!
use std::sync::Arc;

use near_api::{AccountId, Contract, NearGas, NearToken, types::json::Base64VecU8};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;

use crate::AppState;

const ACTIVATE_DEPOSIT: NearToken = NearToken::from_millinear(500); // 0.5 NEAR
const PING_GAS: NearGas = NearGas::from_tgas(1000);

// Strongly-typed mirror of the on-chain contract types. Kept in lockstep
// with `contracts/confidential-bulk-payment/src/lib.rs`. Duplicating them
// here (rather than depending on the contract crate) keeps the BE binary
// independent of the contract's near-sdk version.

#[derive(Debug, Deserialize, Serialize)]
pub enum ActivationStatusView {
    Loading,
    Ready { cursor: u32 },
    Done,
}

#[derive(Debug, Deserialize, Serialize)]
pub enum HashInvalidReasonView {
    MalformedHex,
}

#[derive(Debug, Deserialize, Serialize)]
pub enum SignFailureReasonView {
    SignerCallFailed,
}

#[derive(Debug, Deserialize, Serialize)]
pub enum HashStatusView {
    Pending,
    Signing,
    Signed { signature: Base64VecU8 },
    SignFailed { reason: SignFailureReasonView },
    Invalid { reason: HashInvalidReasonView },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HashEntryView {
    pub payload_hash: String,
    pub status: HashStatusView,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ActivationView {
    pub status: ActivationStatusView,
    pub hashes: Vec<HashEntryView>,
    pub unresolved: u32,
}

impl ActivationStatusView {
    fn is_done(&self) -> bool {
        matches!(self, ActivationStatusView::Done)
    }
    fn is_ready(&self) -> bool {
        matches!(self, ActivationStatusView::Ready { .. })
    }
}

impl HashStatusView {
    fn signed_signature(&self) -> Option<&Base64VecU8> {
        match self {
            HashStatusView::Signed { signature } => Some(signature),
            _ => None,
        }
    }
    fn is_pending_or_signing(&self) -> bool {
        matches!(self, HashStatusView::Pending | HashStatusView::Signing)
    }
    fn is_sign_failed(&self) -> bool {
        matches!(self, HashStatusView::SignFailed { .. })
    }
}

async fn fetch_activation(
    state: &Arc<AppState>,
    sub_id: &AccountId,
    proposal_id: i64,
) -> Result<Option<ActivationView>, String> {
    Contract(sub_id.clone())
        .call_function(
            "get_activation",
            json!({ "proposal_id": proposal_id.to_string() }),
        )
        .read_only::<Option<ActivationView>>()
        .fetch_from(&state.network)
        .await
        .map(|r| r.data)
        .map_err(|e| format!("get_activation: {}", e))
}

/// A bulk row the worker armed itself: its header reached 1Click without
/// the vote relay linking the proposal.
#[derive(sqlx::FromRow)]
struct ArmedBulkPayment {
    id: i32,
    dao_id: String,
    proposal_id: i64,
}

/// Link `pending` bulk rows whose header intent is `submitted` and carries
/// the on-chain proposal id, and hand them to the state machine.
async fn arm_from_submitted_headers(pool: &PgPool) -> Result<Vec<ArmedBulkPayment>, sqlx::Error> {
    sqlx::query_as::<_, ArmedBulkPayment>(
        r#"
        UPDATE confidential_bulk_payments b
        SET proposal_id = ci.proposal_id,
            status = 'activating',
            updated_at = NOW()
        FROM confidential_intents ci
        WHERE b.status = 'pending'
          AND ci.dao_id = b.dao_id
          AND ci.payload_hash = b.header_payload_hash
          AND ci.status = 'submitted'
          AND ci.proposal_id IS NOT NULL
        RETURNING b.id, b.dao_id, b.proposal_id
        "#,
    )
    .fetch_all(pool)
    .await
}

/// Drive every confidential bulk-payment row currently in `activating` or
/// `signing`. Called once per worker tick.
pub async fn process_confidential_bulk_payments(state: &Arc<AppState>) {
    match arm_from_submitted_headers(&state.db_pool).await {
        Ok(armed) => {
            for row in &armed {
                tracing::info!(
                    "Armed bulk-payment #{} for {} from its submitted header (bulk id {})",
                    row.proposal_id,
                    row.dao_id,
                    row.id
                );
            }
        }
        Err(e) => {
            tracing::error!("Failed to arm bulk-payments from submitted headers: {}", e);
        }
    }

    let rows = match sqlx::query!(
        r#"
        SELECT id, dao_id, bulk_account_id, header_payload_hash,
               recipient_payload_hashes, proposal_id, status
        FROM confidential_bulk_payments
        WHERE status IN ('activating', 'signing') AND proposal_id IS NOT NULL
        "#
    )
    .fetch_all(&state.db_pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to fetch pending bulk-payments: {}", e);
            return;
        }
    };

    for row in rows {
        let proposal_id = match row.proposal_id {
            Some(id) => id,
            None => continue,
        };

        let sub_id: AccountId = match row.bulk_account_id.parse() {
            Ok(id) => id,
            Err(e) => {
                tracing::error!(
                    "invalid bulk_account_id {} in row {}: {}",
                    row.bulk_account_id,
                    row.id,
                    e
                );
                continue;
            }
        };

        if row.status == "activating" {
            if let Err(e) = activate_subaccount(state, &sub_id, proposal_id).await {
                tracing::error!(
                    "Failed to activate bulk #{} ({}): {}",
                    proposal_id,
                    row.dao_id,
                    e
                );
                continue;
            }
            // Move to `signing` — even if activation rejected the proposal
            // the per-cycle view below will detect a missing/empty activation
            // and the row will be marked failed.
            let _ = sqlx::query!(
                "UPDATE confidential_bulk_payments SET status = 'signing', updated_at = NOW() WHERE id = $1",
                row.id,
            )
            .execute(&state.db_pool)
            .await;
        }

        // Whether we just activated or already `signing`, view + drive ping
        // or submit on the same tick.
        if let Err(e) = drive_signing(
            state,
            row.id,
            &row.dao_id,
            &sub_id,
            proposal_id,
            &row.recipient_payload_hashes,
        )
        .await
        {
            tracing::error!(
                "Failed to drive bulk #{} ({}): {}",
                proposal_id,
                row.dao_id,
                e
            );
            let _ = sqlx::query!(
                "UPDATE confidential_bulk_payments SET last_error = $2, updated_at = NOW() WHERE id = $1",
                row.id,
                e,
            )
            .execute(&state.db_pool)
            .await;
        }
    }
}

async fn activate_subaccount(
    state: &Arc<AppState>,
    sub_id: &AccountId,
    proposal_id: i64,
) -> Result<(), String> {
    Contract(sub_id.clone())
        .call_function(
            "activate",
            json!({ "proposal_id": proposal_id.to_string() }),
        )
        .transaction()
        .max_gas()
        .deposit(ACTIVATE_DEPOSIT)
        .with_signer(state.signer_id.clone(), state.signer.clone())
        .send_to(&state.network)
        .await
        .map_err(|e| format!("activate send: {}", e))?
        .into_result()
        .map_err(|e| format!("activate send: {}", e))?;
    tracing::info!("Activated bulk proposal {} on {}", proposal_id, sub_id);
    Ok(())
}

async fn drive_signing(
    state: &Arc<AppState>,
    bulk_id: i32,
    dao_id: &str,
    sub_id: &AccountId,
    proposal_id: i64,
    recipient_hashes: &[String],
) -> Result<(), String> {
    let activation = fetch_activation(state, sub_id, proposal_id).await?;
    let activation = match activation {
        Some(a) => a,
        None => {
            // `activate` did not produce state (e.g. proposal not Approved
            // on-chain at the time). Mark failed.
            sqlx::query!(
                "UPDATE confidential_bulk_payments SET status = 'failed', last_error = 'activation missing', updated_at = NOW() WHERE id = $1",
                bulk_id,
            )
            .execute(&state.db_pool)
            .await
            .map_err(|e| format!("mark-failed: {}", e))?;
            return Ok(());
        }
    };

    if !activation.status.is_done() {
        // Still mid-signing. If the activation is `Ready` and any entry is
        // pending, kick a ping. Skip submit until all entries terminal.
        if activation.status.is_ready()
            && activation
                .hashes
                .iter()
                .any(|h| h.status.is_pending_or_signing())
        {
            ping_subaccount(state, sub_id, proposal_id).await?;
        }
        return Ok(());
    }

    // Done, but some signs failed — reset them and let the next tick ping.
    // Past the retry cap we fall through: signed recipients still get paid,
    // unsigned ones are marked failed below.
    if activation.hashes.iter().any(|h| h.status.is_sign_failed()) {
        if claim_sign_retry(state, bulk_id).await? {
            retry_failed_on_subaccount(state, sub_id, proposal_id).await?;
            return Ok(());
        }
        crate::error_event!(
            crate::error_event::ErrorCode::BulkConfDriveFailed,
            dao_id,
            proposal_id,
            error = "recipient signs still failing after max retries"
        );
    }

    // Done — only now do we submit recipient intents to 1Click.
    let public_key =
        crate::handlers::relay::confidential::fetch_mpc_public_key(state, sub_id.as_ref(), "")
            .await
            .map_err(|(c, m)| format!("sub pubkey ({}): {}", c, m))?;

    submit_done_activation(
        state,
        bulk_id,
        dao_id,
        sub_id,
        &activation,
        recipient_hashes,
        &public_key,
    )
    .await
}

async fn ping_subaccount(
    state: &Arc<AppState>,
    sub_id: &AccountId,
    proposal_id: i64,
) -> Result<(), String> {
    Contract(sub_id.clone())
        .call_function("ping", json!({ "proposal_id": proposal_id.to_string() }))
        .transaction()
        .gas(PING_GAS)
        .with_signer(state.signer_id.clone(), state.signer.clone())
        .send_to(&state.network)
        .await
        .map_err(|e| format!("ping send: {}", e))?
        .into_result()
        .map_err(|e| format!("ping send: {}", e))?;
    tracing::info!("Pinged bulk proposal {} on {}", proposal_id, sub_id);
    Ok(())
}

/// Atomically take one of the `confidential_bulk_max_sign_retries` slots.
/// Returns false once they're used up. The slot is spent even if the
/// `retry_failed` tx then fails, which keeps the loop bounded.
async fn claim_sign_retry(state: &Arc<AppState>, bulk_id: i32) -> Result<bool, String> {
    // ponytail: runtime query, not `query!`, so the .sqlx offline cache needs no regen.
    sqlx::query_scalar::<_, i32>(
        r#"
        UPDATE confidential_bulk_payments
        SET sign_retry_count = sign_retry_count + 1, updated_at = NOW()
        WHERE id = $1 AND sign_retry_count < $2
        RETURNING sign_retry_count
        "#,
    )
    .bind(bulk_id)
    .bind(state.env_vars.confidential_bulk_max_sign_retries)
    .fetch_optional(&state.db_pool)
    .await
    .map(|claimed| claimed.is_some())
    .map_err(|e| format!("claim sign retry: {}", e))
}

/// Reset the sub's `SignFailed` entries to `Pending` and move the activation
/// back to `Ready`, so the next `ping` signs them again.
async fn retry_failed_on_subaccount(
    state: &Arc<AppState>,
    sub_id: &AccountId,
    proposal_id: i64,
) -> Result<(), String> {
    Contract(sub_id.clone())
        .call_function(
            "retry_failed",
            json!({ "proposal_id": proposal_id.to_string() }),
        )
        .transaction()
        .with_signer(state.signer_id.clone(), state.signer.clone())
        .send_to(&state.network)
        .await
        .map_err(|e| format!("retry_failed send: {}", e))?
        .into_result()
        .map_err(|e| format!("retry_failed send: {}", e))?;
    tracing::info!(
        "Reset failed signs for bulk proposal {} on {}",
        proposal_id,
        sub_id
    );
    Ok(())
}

/// Submit every recipient intent that's already-`Signed` on-chain and not
/// yet posted to 1Click. Marks the bulk row `completed` after the last
/// recipient is submitted.
async fn submit_done_activation(
    state: &Arc<AppState>,
    bulk_id: i32,
    dao_id: &str,
    sub_id: &AccountId,
    activation: &ActivationView,
    recipient_hashes: &[String],
    public_key: &str,
) -> Result<(), String> {
    // Fetch any recipient rows still pending submission to 1Click.
    let pending = sqlx::query!(
        r#"
        SELECT payload_hash, intent_payload
        FROM confidential_intents
        WHERE payload_hash = ANY($1) AND status = 'pending'
        "#,
        recipient_hashes,
    )
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| format!("fetch pending recipients: {}", e))?;

    if pending.is_empty() {
        // All already submitted (or none pending). Mark completed.
        sqlx::query!(
            "UPDATE confidential_bulk_payments SET status = 'completed', updated_at = NOW() WHERE id = $1",
            bulk_id,
        )
        .execute(&state.db_pool)
        .await
        .map_err(|e| format!("mark-completed: {}", e))?;
        tracing::info!("Bulk-payment {} for {} fully submitted", bulk_id, dao_id);
        return Ok(());
    }

    // Build a hash → on-chain entry map for sig lookup.
    let sig_by_hash: std::collections::HashMap<&str, &Base64VecU8> = activation
        .hashes
        .iter()
        .filter_map(|h| {
            h.status
                .signed_signature()
                .map(|sig| (h.payload_hash.as_str(), sig))
        })
        .collect();

    // Submit in parallel.
    let mut futures = Vec::with_capacity(pending.len());
    for row in &pending {
        let hash = row.payload_hash.clone();
        let intent_payload = row.intent_payload.clone();
        let sig = match sig_by_hash.get(hash.as_str()) {
            Some(s) => (*s).clone(),
            None => {
                // Sub recorded the entry as Invalid/SignFailed — mark recipient
                // failed and move on.
                let _ = sqlx::query!(
                    r#"
                    UPDATE confidential_intents
                    SET status = 'failed',
                        submit_result = '"no signature on chain"'::jsonb,
                        updated_at = NOW()
                    WHERE payload_hash = $1
                    "#,
                    hash,
                )
                .execute(&state.db_pool)
                .await;
                continue;
            }
        };
        let state = state.clone();
        let public_key = public_key.to_string();
        let sub_id = sub_id.to_string();
        futures.push(async move {
            let res = crate::handlers::relay::confidential::submit_intent_to_oneclick(
                &state,
                crate::handlers::relay::confidential::IntentSubmitKind::Shield,
                &intent_payload,
                &public_key,
                &sig.0,
            )
            .await;
            (sub_id, hash, res)
        });
    }

    let results = futures::future::join_all(futures).await;
    for (sub_id, hash, res) in results {
        match res {
            Ok(body) => {
                let _ = sqlx::query!(
                    "UPDATE confidential_intents SET status = 'submitted', submit_result = $2, updated_at = NOW() WHERE payload_hash = $1",
                    hash,
                    body,
                )
                .execute(&state.db_pool)
                .await;
            }
            Err(err) => {
                tracing::error!(
                    "submit-intent failed for {} (hash={}): {}",
                    sub_id,
                    hash,
                    err
                );
                let _ = sqlx::query!(
                    "UPDATE confidential_intents SET status = 'failed', submit_result = $2, updated_at = NOW() WHERE payload_hash = $1",
                    hash,
                    json!({ "error": err.to_string() }),
                )
                .execute(&state.db_pool)
                .await;
            }
        }
    }

    // Pull the next 1Click history poll forward so the submitted intents enter
    // the await-settlement fast tier (mirrors relay/confidential.rs submits).
    // Before the completed update: if that update fails, the retry cycle finds
    // no pending recipients and never reaches this point again.
    if let Err(e) =
        crate::handlers::intents::confidential::bronze::store::mark_confidential_history_activity_due(
            &state.db_pool,
            dao_id,
        )
        .await
    {
        tracing::warn!("cannot mark confidential history due for {}: {}", dao_id, e);
    }

    sqlx::query!(
        "UPDATE confidential_bulk_payments SET status = 'completed', updated_at = NOW() WHERE id = $1",
        bulk_id,
    )
    .execute(&state.db_pool)
    .await
    .map_err(|e| format!("mark-completed: {}", e))?;

    tracing::info!("Bulk-payment {} for {} fully submitted", bulk_id, dao_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAO: &str = "bulk.sputnik-dao.near";
    const SUB: &str = "bulk.bulkpayment.near";

    async fn seed_header(pool: &PgPool, hash: &str, status: &str, proposal_id: Option<i64>) {
        sqlx::query(
            r#"
            INSERT INTO confidential_intents (
                dao_id, payload_hash, intent_payload, intent_type, status, proposal_id
            )
            VALUES ($1, $2, '{}'::jsonb, 'shield', $3, $4)
            "#,
        )
        .bind(DAO)
        .bind(hash)
        .bind(status)
        .bind(proposal_id)
        .execute(pool)
        .await
        .expect("seed header");
    }

    async fn seed_bulk(pool: &PgPool, header_hash: &str) -> i32 {
        sqlx::query_scalar::<_, i32>(
            r#"
            INSERT INTO confidential_bulk_payments (
                dao_id, bulk_account_id, header_payload_hash, recipient_payload_hashes, status
            )
            VALUES ($1, $2, $3, ARRAY['r1', 'r2'], 'pending')
            RETURNING id
            "#,
        )
        .bind(DAO)
        .bind(SUB)
        .bind(header_hash)
        .fetch_one(pool)
        .await
        .expect("seed bulk")
    }

    async fn bulk_state(pool: &PgPool, id: i32) -> (String, Option<i64>) {
        sqlx::query_as::<_, (String, Option<i64>)>(
            "SELECT status, proposal_id FROM confidential_bulk_payments WHERE id = $1",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("bulk row")
    }

    #[sqlx::test]
    async fn arms_pending_rows_whose_header_reached_oneclick(pool: PgPool) {
        seed_header(&pool, "submitted-header", "submitted", Some(56)).await;
        seed_header(&pool, "unvoted-header", "pending", None).await;
        seed_header(&pool, "executed-unsubmitted-header", "pending", Some(57)).await;
        let armed_id = seed_bulk(&pool, "submitted-header").await;
        let unvoted_id = seed_bulk(&pool, "unvoted-header").await;
        let unsubmitted_id = seed_bulk(&pool, "executed-unsubmitted-header").await;

        let armed = arm_from_submitted_headers(&pool).await.expect("arm");
        assert_eq!(armed.len(), 1);
        assert_eq!(
            (armed[0].id, armed[0].dao_id.as_str(), armed[0].proposal_id),
            (armed_id, DAO, 56)
        );
        assert_eq!(
            bulk_state(&pool, armed_id).await,
            ("activating".to_string(), Some(56))
        );
        assert_eq!(
            bulk_state(&pool, unvoted_id).await,
            ("pending".to_string(), None)
        );
        assert_eq!(
            bulk_state(&pool, unsubmitted_id).await,
            ("pending".to_string(), None),
            "the header must reach 1Click before the sub is activated"
        );

        let again = arm_from_submitted_headers(&pool).await.expect("arm again");
        assert!(again.is_empty(), "arming is one-shot per row");
    }
}

//! Auto-submit confidential intents after DAO proposal approval.
//!
//! When a confidential_transfer proposal is created, the intent payload is stored
//! in `pending_confidential_intents`. When a vote approves the proposal and the
//! MPC signature is in the execution result, the signed intent is submitted to
//! the 1Click API automatically.

use crate::AppState;
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;

const MPC_PUBLIC_KEY: &str = "ed25519:7pPtVUyLDRXvzkgAUtfGeUK9ZWaSWd256tSgvazfZKZg";

/// Store a pending intent for later auto-submission.
pub async fn store_pending_intent(
    pool: &PgPool,
    dao_id: &str,
    proposal_id: i32,
    intent_payload: &Value,
    correlation_id: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO pending_confidential_intents (dao_id, proposal_id, intent_payload, correlation_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (dao_id, proposal_id) DO UPDATE SET
            intent_payload = EXCLUDED.intent_payload,
            correlation_id = EXCLUDED.correlation_id,
            updated_at = NOW()
        "#,
    )
    .bind(dao_id)
    .bind(proposal_id)
    .bind(intent_payload)
    .bind(correlation_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to store pending intent: {}", e))?;

    log::info!(
        "Stored pending confidential intent for {}/proposal#{}",
        dao_id,
        proposal_id
    );
    Ok(())
}

/// Extract MPC signature from the execution result debug string.
/// Searches for the base64 marker "eyJzY2hlbWUi" (= `{"scheme"`).
fn extract_mpc_signature(result_debug: &str) -> Option<Vec<u8>> {
    let marker = "eyJzY2hlbWUi";
    let start = result_debug.find(marker)?;
    let rest = &result_debug[start..];
    let end = rest
        .find(|c: char| !c.is_alphanumeric() && c != '+' && c != '/' && c != '=')
        .unwrap_or(rest.len());
    let b64_value = &rest[..end];

    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(b64_value)
        .ok()?;
    let sig_json: Value = serde_json::from_slice(&decoded).ok()?;

    if sig_json.get("scheme")?.as_str()? != "Ed25519" {
        return None;
    }

    let sig_array = sig_json.get("signature")?.as_array()?;
    if sig_array.len() != 64 {
        return None;
    }

    Some(sig_array.iter().map(|v| v.as_u64().unwrap() as u8).collect())
}

/// Try to auto-submit a confidential intent after a vote relay succeeds.
///
/// This is called in a background task after a successful vote relay.
/// It checks all pending intents for the treasury and tries to match
/// the MPC signature in the execution result.
pub async fn try_auto_submit_intent(
    state: &Arc<AppState>,
    treasury_id: &str,
    result_debug: &str,
) {
    // Extract MPC signature from execution result
    let sig_bytes = match extract_mpc_signature(result_debug) {
        Some(bytes) => bytes,
        None => {
            log::debug!(
                "No MPC signature found in vote result for {} — not a confidential proposal",
                treasury_id
            );
            return;
        }
    };

    let sig_b58 = format!("ed25519:{}", bs58::encode(&sig_bytes).into_string());
    log::info!(
        "Extracted MPC signature for {} — looking for pending intent",
        treasury_id
    );

    // Find the most recent pending intent for this treasury
    let pending = sqlx::query_as::<_, (i32, Value, Option<String>)>(
        r#"
        SELECT proposal_id, intent_payload, correlation_id
        FROM pending_confidential_intents
        WHERE dao_id = $1 AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(treasury_id)
    .fetch_optional(&state.db_pool)
    .await;

    let (proposal_id, intent_payload, _correlation_id) = match pending {
        Ok(Some(row)) => row,
        Ok(None) => {
            log::warn!(
                "MPC signature found but no pending intent for {}",
                treasury_id
            );
            return;
        }
        Err(e) => {
            log::error!("DB error looking up pending intent for {}: {}", treasury_id, e);
            return;
        }
    };

    log::info!(
        "Auto-submitting signed intent for {}/proposal#{}",
        treasury_id,
        proposal_id
    );

    // Build the submit-intent body
    let submit_body = serde_json::json!({
        "type": "swap_transfer",
        "signedData": {
            "standard": "nep413",
            "payload": intent_payload,
            "public_key": MPC_PUBLIC_KEY,
            "signature": sig_b58,
        }
    });

    // Submit to 1Click API
    let url = format!("{}/v0/submit-intent", state.env_vars.oneclick_api_url);
    let result = state
        .http_client
        .post(&url)
        .header("content-type", "application/json")
        .json(&submit_body)
        .send()
        .await;

    match result {
        Ok(resp) => {
            let status = resp.status();
            let body: Value = resp.json().await.unwrap_or_default();

            if status.is_success() {
                log::info!(
                    "Successfully submitted signed intent for {}/proposal#{}: {:?}",
                    treasury_id, proposal_id, body
                );
                // Update status
                let _ = sqlx::query(
                    "UPDATE pending_confidential_intents SET status = 'submitted', submit_result = $1, updated_at = NOW() WHERE dao_id = $2 AND proposal_id = $3"
                )
                .bind(&body)
                .bind(treasury_id)
                .bind(proposal_id)
                .execute(&state.db_pool)
                .await;
            } else {
                log::error!(
                    "1Click submit-intent failed ({}) for {}/proposal#{}: {:?}",
                    status, treasury_id, proposal_id, body
                );
                let _ = sqlx::query(
                    "UPDATE pending_confidential_intents SET status = 'failed', submit_result = $1, updated_at = NOW() WHERE dao_id = $2 AND proposal_id = $3"
                )
                .bind(&body)
                .bind(treasury_id)
                .bind(proposal_id)
                .execute(&state.db_pool)
                .await;
            }
        }
        Err(e) => {
            log::error!(
                "Failed to call 1Click submit-intent for {}/proposal#{}: {}",
                treasury_id, proposal_id, e
            );
            let _ = sqlx::query(
                "UPDATE pending_confidential_intents SET status = 'failed', submit_result = $1, updated_at = NOW() WHERE dao_id = $2 AND proposal_id = $3"
            )
            .bind(serde_json::json!({"error": e.to_string()}))
            .bind(treasury_id)
            .bind(proposal_id)
            .execute(&state.db_pool)
            .await;
        }
    }
}

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

use crate::handlers::intents::confidential::config::oneclick_api_key;

/// Fetch the Ed25519 derived public key for a DAO's path from v1.signer.
async fn fetch_mpc_public_key(
    state: &Arc<AppState>,
    dao_id: &str,
) -> Result<String, String> {
    let v1_signer: near_api::AccountId = "v1.signer".parse().unwrap();
    let args = serde_json::json!({
        "path": dao_id,
        "predecessor": dao_id,
        "domain_id": 1,
    });

    let args_bytes = serde_json::to_vec(&args).unwrap();
    let result = near_api::Contract(v1_signer)
        .call_function_raw("derived_public_key", args_bytes)
        .read_only::<String>()
        .fetch_from(&state.network)
        .await
        .map_err(|e| format!("Failed to query v1.signer: {}", e))?;

    Ok(result.data)
}

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
            intent_type = 'shield',
            status = 'pending',
            submit_result = NULL,
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

    // Find the most recent pending intent or auth for this treasury
    let pending = sqlx::query_as::<_, (i32, Value, Option<String>, String)>(
        r#"
        SELECT proposal_id, intent_payload, correlation_id, intent_type
        FROM pending_confidential_intents
        WHERE dao_id = $1 AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(treasury_id)
    .fetch_optional(&state.db_pool)
    .await;

    let (proposal_id, intent_payload, _correlation_id, intent_type) = match pending {
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

    // Fetch the DAO's derived MPC public key from v1.signer
    let mpc_public_key = match fetch_mpc_public_key(state, treasury_id).await {
        Ok(key) => key,
        Err(e) => {
            log::error!("Failed to fetch MPC public key for {}: {}", treasury_id, e);
            return;
        }
    };

    log::info!(
        "Auto-submitting {} for {}/proposal#{} (mpc_key={})",
        intent_type, treasury_id, proposal_id, mpc_public_key
    );

    let (url, body) = if intent_type == "auth" {
        // Authentication: call 1Click auth/authenticate
        let url = format!("{}/v0/auth/authenticate", state.env_vars.confidential_api_url);
        let body = serde_json::json!({
            "signedData": {
                "standard": "nep413",
                "payload": intent_payload,
                "public_key": mpc_public_key,
                "signature": sig_b58,
            }
        });
        (url, body)
    } else {
        // Shield: call 1Click submit-intent
        let url = format!("{}/v0/submit-intent", state.env_vars.confidential_api_url);
        let body = serde_json::json!({
            "type": "swap_transfer",
            "signedData": {
                "standard": "nep413",
                "payload": intent_payload,
                "public_key": mpc_public_key,
                "signature": sig_b58,
            }
        });
        (url, body)
    };

    let mut req = state
        .http_client
        .post(&url)
        .header("content-type", "application/json");

    if let Some(api_key) = oneclick_api_key() {
        req = req.header("x-api-key", api_key);
    }

    let result = req.json(&body).send().await;

    match result {
        Ok(resp) => {
            let status = resp.status();
            let resp_body: Value = resp.json().await.unwrap_or_default();

            if status.is_success() {
                log::info!(
                    "Successfully submitted {} for {}/proposal#{}: {:?}",
                    intent_type, treasury_id, proposal_id, resp_body
                );

                // For auth: store the JWT tokens in monitored_accounts
                if intent_type == "auth" {
                    if let (Some(access_token), Some(refresh_token)) = (
                        resp_body.get("accessToken").and_then(|v| v.as_str()),
                        resp_body.get("refreshToken").and_then(|v| v.as_str()),
                    ) {
                        let expires_in = resp_body
                            .get("expiresIn")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(3600);
                        let expires_at = chrono::Utc::now()
                            + chrono::Duration::seconds(expires_in);

                        let _ = sqlx::query(
                            r#"
                            UPDATE monitored_accounts
                            SET confidential_access_token = $1,
                                confidential_refresh_token = $2,
                                confidential_token_expires_at = $3
                            WHERE account_id = $4
                            "#,
                        )
                        .bind(access_token)
                        .bind(refresh_token)
                        .bind(expires_at)
                        .bind(treasury_id)
                        .execute(&state.db_pool)
                        .await;

                        log::info!(
                            "Stored confidential JWT for DAO {} (expires in {}s)",
                            treasury_id, expires_in
                        );
                    }
                }

                let _ = sqlx::query(
                    "UPDATE pending_confidential_intents SET status = 'submitted', submit_result = $1, updated_at = NOW() WHERE dao_id = $2 AND proposal_id = $3"
                )
                .bind(&resp_body)
                .bind(treasury_id)
                .bind(proposal_id)
                .execute(&state.db_pool)
                .await;
            } else {
                log::error!(
                    "1Click {} failed ({}) for {}/proposal#{}: {:?}",
                    intent_type, status, treasury_id, proposal_id, resp_body
                );
                let _ = sqlx::query(
                    "UPDATE pending_confidential_intents SET status = 'failed', submit_result = $1, updated_at = NOW() WHERE dao_id = $2 AND proposal_id = $3"
                )
                .bind(&resp_body)
                .bind(treasury_id)
                .bind(proposal_id)
                .execute(&state.db_pool)
                .await;
            }
        }
        Err(e) => {
            log::error!(
                "Failed to call 1Click {} for {}/proposal#{}: {}",
                intent_type, treasury_id, proposal_id, e
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

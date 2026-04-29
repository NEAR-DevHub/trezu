//! Auto-submit confidential intents after DAO proposal approval.
//!
//! When a confidential_transfer proposal is created, the intent payload is stored
//! in `confidential_intents` keyed by its NEP-413 payload hash. When a vote
//! approves the proposal and the MPC signature is in the execution result, the
//! signed intent is submitted to the 1Click API automatically.

use crate::{AppState, constants::V1_SIGNER_CONTRACT_ID, utils::cache::CacheKey};
use base64::Engine;
use near_api::types::{Action, transaction::delegate_action::NonDelegateAction};
use reqwest::StatusCode;
use serde_json::Value;
use sqlx::PgPool;
use std::{ops::Deref, sync::Arc};

/// Compute the NEP-413 payload hash (the value used in `payload_v2.Eddsa`).
///
/// Takes the intent payload JSON (`{ message, nonce, recipient }`) and returns
/// the lowercase hex SHA-256 digest that v1.signer signs.
pub fn compute_nep413_hash(payload: &Value) -> Option<String> {
    let message = payload.get("message")?.as_str()?.to_string();
    let nonce_b64 = payload.get("nonce")?.as_str()?;
    let recipient = payload.get("recipient")?.as_str()?.to_string();

    let nonce_bytes = base64::engine::general_purpose::STANDARD
        .decode(nonce_b64)
        .ok()?;
    if nonce_bytes.len() != 32 {
        return None;
    }
    let mut nonce = [0u8; 32];
    nonce.copy_from_slice(&nonce_bytes);

    near_api::signer::NEP413Payload {
        message,
        nonce,
        recipient,
        callback_url: None,
    }
    .compute_hash()
    .ok()
    .map(|hash| hex::encode(hash.0))
}

/// Fetch the Ed25519 derived public key for a DAO's path from v1.signer.
pub(crate) async fn fetch_mpc_public_key(
    state: &Arc<AppState>,
    dao_id: &str,
) -> Result<String, (StatusCode, String)> {
    let args = serde_json::json!({
        "path": dao_id,
        "predecessor": dao_id,
        "domain_id": 1,
    });

    let result = state
        .cache
        .cached_contract_call(
            crate::utils::cache::CacheTier::LongTerm,
            CacheKey::new("mpc-public-key").with(dao_id).build(),
            async move {
                near_api::Contract(V1_SIGNER_CONTRACT_ID.into())
                    .call_function("derived_public_key", args)
                    .read_only::<String>()
                    .fetch_from(&state.network)
                    .await
            },
        )
        .await?;

    Ok(result.data)
}

/// Store a pending intent for later auto-submission.
pub async fn store_pending_intent(
    pool: &PgPool,
    dao_id: &str,
    payload_hash: &str,
    intent_payload: &Value,
    correlation_id: Option<&str>,
    quote_metadata: Option<&Value>,
    notes: Option<&str>,
) -> Result<(), String> {
    sqlx::query!(
        r#"
        INSERT INTO confidential_intents (dao_id, payload_hash, intent_payload, correlation_id, quote_metadata, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (dao_id, payload_hash) DO UPDATE SET
            intent_payload = EXCLUDED.intent_payload,
            correlation_id = EXCLUDED.correlation_id,
            quote_metadata = EXCLUDED.quote_metadata,
            notes = EXCLUDED.notes,
            intent_type = 'shield',
            status = 'pending',
            submit_result = NULL,
            updated_at = NOW()
        "#,
        dao_id,
        payload_hash,
        intent_payload,
        correlation_id,
        quote_metadata,
        notes,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to store pending intent: {}", e))?;

    log::info!(
        "Stored pending confidential intent for {} (hash={})",
        dao_id,
        payload_hash
    );
    Ok(())
}

/// Extract MPC signature from the execution result debug string.
/// Searches for the base64 marker "eyJzY2hlbWUi" (= `{"scheme"`).
pub(crate) fn extract_mpc_signature(result_debug: &str) -> Option<Vec<u8>> {
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

    let bytes: Option<Vec<u8>> = sig_array
        .iter()
        .map(|v| v.as_u64().map(|n| n as u8))
        .collect();

    bytes
}

/// Extract the v1.signer payload hash and the sputnik proposal id being voted
/// on from a delegate action's `act_proposal` call.
///
/// Looks for a `FunctionCall` with `method_name == "act_proposal"`, checks
/// that `proposal.FunctionCall.receiver_id == "v1.signer"`, and pulls:
/// - `args.id` → proposal id
/// - `args.proposal.FunctionCall.actions[0].args.request.payload_v2.Eddsa` → hash
pub fn extract_v1_signer_hash(actions: &[NonDelegateAction]) -> Option<(String, u64)> {
    for action in actions {
        if let Action::FunctionCall(fc) = action.deref() {
            if fc.method_name != "act_proposal" {
                continue;
            }
            let args: Value = serde_json::from_slice(&fc.args).ok()?;
            let proposal_id = args.get("id")?.as_u64()?;
            let proposal = args.get("proposal")?;
            let func_call = proposal.get("FunctionCall")?;

            if func_call.get("receiver_id")?.as_str()? != "v1.signer" {
                return None;
            }

            let inner_actions = func_call.get("actions")?.as_array()?;
            let first_action = inner_actions.first()?;
            let inner_args_b64 = first_action.get("args")?.as_str()?;

            use base64::Engine;
            let inner_args_bytes = base64::engine::general_purpose::STANDARD
                .decode(inner_args_b64)
                .ok()?;
            let inner_args: Value = serde_json::from_slice(&inner_args_bytes).ok()?;

            let hash = inner_args
                .get("request")?
                .get("payload_v2")?
                .get("Eddsa")?
                .as_str()?;

            return Some((hash.to_string(), proposal_id));
        }
    }
    None
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IntentSubmitKind {
    /// `/v0/submit-intent` — bulk recipients + single-shield path.
    Shield,
    /// `/v0/auth/authenticate` — JWT-issuing auth call.
    Auth,
}

/// POST a signed intent to 1Click. Returns the parsed JSON body on success.
/// `signature_bytes` is the raw 64-byte Ed25519 signature.
pub async fn submit_intent_to_oneclick(
    state: &Arc<AppState>,
    kind: IntentSubmitKind,
    intent_payload: &Value,
    public_key: &str,
    signature_bytes: &[u8],
) -> Result<Value, String> {
    let sig_b58 = format!("ed25519:{}", bs58::encode(signature_bytes).into_string());

    let (path, body) = match kind {
        IntentSubmitKind::Shield => (
            "/v0/submit-intent",
            serde_json::json!({
                "type": "swap_transfer",
                "signedData": {
                    "standard": "nep413",
                    "payload": intent_payload,
                    "public_key": public_key,
                    "signature": sig_b58,
                }
            }),
        ),
        IntentSubmitKind::Auth => (
            "/v0/auth/authenticate",
            serde_json::json!({
                "signedData": {
                    "standard": "nep413",
                    "payload": intent_payload,
                    "public_key": public_key,
                    "signature": sig_b58,
                }
            }),
        ),
    };

    let url = format!("{}{}", state.env_vars.confidential_api_url, path);
    let mut req = state
        .http_client
        .post(&url)
        .header("content-type", "application/json");
    if let Some(api_key) = &state.env_vars.oneclick_api_key {
        req = req.header("x-api-key", api_key);
    }
    let response = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("1click {}: {}", path, e))?;
    let status = response.status();
    let resp_body: Value = response.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("1click {} {}: {:?}", path, status, resp_body));
    }
    Ok(resp_body)
}

/// Try to auto-submit a confidential intent after a vote relay succeeds.
///
/// This is called in a background task after a successful vote relay.
/// It uses the payload hash extracted from the delegate action to find the
/// matching pending intent.
///
/// Also attaches the on-chain `proposal_id` to a matching
/// `confidential_bulk_payments` row when the hash is a bulk header — this
/// is what tells the bulk processor a vote has happened, so it can pick up
/// activation and per-recipient signing on its next cycle.
pub async fn try_auto_submit_intent(
    state: &Arc<AppState>,
    treasury_id: &str,
    payload_hash: &str,
    proposal_id: u64,
    result_debug: &str,
) {
    // Extract MPC signature from execution result. Presence of the sig is
    // the signal that the vote actually approved the proposal — only then
    // do we link bulk rows or auto-submit the intent.
    let sig_bytes = match extract_mpc_signature(result_debug) {
        Some(bytes) => bytes,
        None => {
            log::warn!(
                "No MPC signature found in vote result for {} (hash={})",
                treasury_id,
                payload_hash
            );
            return;
        }
    };

    // If this hash is a bulk header, link the proposal id and arm the bulk
    // processor. The header still travels through the regular shield-intent
    // submit path below, which moves the funds DAO → sub on intents.near.
    let bulk_link = sqlx::query!(
        r#"
        UPDATE confidential_bulk_payments
        SET proposal_id = $3,
            status = CASE WHEN status = 'pending' THEN 'activating' ELSE status END,
            updated_at = NOW()
        WHERE dao_id = $1 AND header_payload_hash = $2
        RETURNING id
        "#,
        treasury_id,
        payload_hash,
        proposal_id as i64,
    )
    .fetch_optional(&state.db_pool)
    .await;
    match bulk_link {
        Ok(Some(_)) => {
            log::info!(
                "Linked bulk-payment proposal #{} for {} (header={})",
                proposal_id,
                treasury_id,
                payload_hash
            );
        }
        Ok(None) => {
            // Not a bulk header — fall through to normal single-intent path.
        }
        Err(e) => {
            log::warn!(
                "Failed to link bulk-payment proposal for {} (hash={}): {}",
                treasury_id,
                payload_hash,
                e
            );
        }
    }

    log::info!(
        "Extracted MPC signature for {} (hash={}) — looking for pending intent",
        treasury_id,
        payload_hash
    );

    // Find the pending intent matching this payload hash.
    let pending = sqlx::query_as::<_, (Value, Option<String>, String)>(
        r#"
        SELECT intent_payload, correlation_id, intent_type
        FROM confidential_intents
        WHERE dao_id = $1 AND payload_hash = $2 AND status = 'pending'
        "#,
    )
    .bind(treasury_id)
    .bind(payload_hash)
    .fetch_optional(&state.db_pool)
    .await;

    let (intent_payload, _correlation_id, intent_type) = match pending {
        Ok(Some(row)) => row,
        Ok(None) => {
            log::warn!(
                "MPC signature found but no pending intent for {} (hash={})",
                treasury_id,
                payload_hash
            );
            return;
        }
        Err(e) => {
            log::error!(
                "DB error looking up pending intent for {} (hash={}): {}",
                treasury_id,
                payload_hash,
                e
            );
            return;
        }
    };

    // Fetch the DAO's derived MPC public key from v1.signer
    let mpc_public_key = match fetch_mpc_public_key(state, treasury_id).await {
        Ok(key) => key,
        Err(e) => {
            log::error!(
                "Failed to fetch MPC public key for {}: {:?}",
                treasury_id,
                e
            );
            return;
        }
    };

    log::info!(
        "Auto-submitting {} for {} (hash={}, mpc_key={})",
        intent_type,
        treasury_id,
        payload_hash,
        mpc_public_key
    );

    let kind = if intent_type == "auth" {
        IntentSubmitKind::Auth
    } else {
        IntentSubmitKind::Shield
    };
    match submit_intent_to_oneclick(state, kind, &intent_payload, &mpc_public_key, &sig_bytes).await
    {
        Ok(resp_body) => {
            log::info!(
                "Successfully submitted {} for {} (hash={}): {:?}",
                intent_type,
                treasury_id,
                payload_hash,
                resp_body
            );

            // For auth: store the JWT tokens in monitored_accounts.
            if intent_type == "auth"
                && let (Some(access_token), Some(refresh_token)) = (
                    resp_body.get("accessToken").and_then(|v| v.as_str()),
                    resp_body.get("refreshToken").and_then(|v| v.as_str()),
                )
            {
                let expires_in = resp_body
                    .get("expiresIn")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(3600);
                let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in);

                let _ = sqlx::query!(
                    r#"
                        UPDATE monitored_accounts
                        SET confidential_access_token = $1,
                            confidential_refresh_token = $2,
                            confidential_token_expires_at = $3
                        WHERE account_id = $4
                        "#,
                    access_token,
                    refresh_token,
                    expires_at,
                    treasury_id,
                )
                .execute(&state.db_pool)
                .await;

                log::info!(
                    "Stored confidential JWT for DAO {} (expires in {}s)",
                    treasury_id,
                    expires_in
                );
            }

            let _ = sqlx::query!(
                "UPDATE confidential_intents SET status = 'submitted', submit_result = $1, updated_at = NOW() WHERE dao_id = $2 AND payload_hash = $3",
                &resp_body,
                treasury_id,
                payload_hash,
            )
            .execute(&state.db_pool)
            .await;
        }
        Err(err) => {
            log::error!(
                "1Click {} failed for {} (hash={}): {}",
                intent_type,
                treasury_id,
                payload_hash,
                err
            );
            let _ = sqlx::query!(
                "UPDATE confidential_intents SET status = 'failed', submit_result = $1, updated_at = NOW() WHERE dao_id = $2 AND payload_hash = $3",
                serde_json::json!({ "error": err }),
                treasury_id,
                payload_hash,
            )
            .execute(&state.db_pool)
            .await;
        }
    }
}

//! Prepare a confidential auth proposal for a DAO.
//!
//! Builds the NEP-413 auth message, computes the hash, and returns the
//! v1.signer proposal args. Also stores the auth payload so the relay
//! can auto-authenticate after the proposal is approved.

use axum::{Json, extract::State, http::StatusCode};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Digest;
use std::sync::Arc;

use crate::AppState;

const V1_SIGNER_CONTRACT: &str = "v1.signer";
const V1_SIGNER_GAS: &str = "250000000000000";

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrepareAuthRequest {
    /// The DAO account ID
    pub dao_id: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrepareAuthResponse {
    /// The proposal to submit to the DAO (pass directly to add_proposal)
    pub proposal: serde_json::Value,
    /// The NEP-413 payload for later use in authenticate call
    pub auth_payload: AuthPayload,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthPayload {
    pub message: String,
    pub nonce: String,
    pub recipient: String,
}

/// Build a versioned nonce (32 bytes): 1-byte version + 8-byte salt + 8-byte deadline + 15 zero padding.
fn build_nonce(salt: &[u8], deadline: &chrono::DateTime<chrono::Utc>) -> [u8; 32] {
    let mut nonce = [0u8; 32];
    nonce[0] = 0x01; // version
    let salt_bytes = &salt[..salt.len().min(8)];
    nonce[1..1 + salt_bytes.len()].copy_from_slice(salt_bytes);
    let ts = deadline.timestamp_millis().to_be_bytes();
    nonce[9..17].copy_from_slice(&ts);
    nonce
}

/// POST /api/intents/prepare-auth
///
/// Builds a v1.signer signing proposal for DAO authentication.
/// The auth payload is stored for auto-submission after approval.
pub async fn prepare_auth(
    State(state): State<Arc<AppState>>,
    Json(request): Json<PrepareAuthRequest>,
) -> Result<Json<PrepareAuthResponse>, (StatusCode, String)> {
    // Build auth message (empty intents = auth-only)
    let deadline = chrono::Utc::now() + chrono::Duration::days(7);
    let deadline_str = deadline.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let auth_message = json!({
        "deadline": deadline_str,
        "intents": [],
        "signer_id": request.dao_id,
    })
    .to_string();

    // Build nonce (use random salt)
    let salt: [u8; 8] = rand::random();
    let nonce = build_nonce(&salt, &deadline);
    let nonce_b64 = base64::engine::general_purpose::STANDARD.encode(nonce);

    // Compute NEP-413 hash
    let nep413_tag: u32 = (1u32 << 31) + 413;
    let mut borsh_bytes = nep413_tag.to_le_bytes().to_vec();

    // Borsh String: message
    borsh_bytes.extend_from_slice(&(auth_message.len() as u32).to_le_bytes());
    borsh_bytes.extend_from_slice(auth_message.as_bytes());

    // Borsh [u8; 32]: nonce (fixed-size)
    borsh_bytes.extend_from_slice(&nonce);

    // Borsh String: recipient
    let recipient = "intents.near";
    borsh_bytes.extend_from_slice(&(recipient.len() as u32).to_le_bytes());
    borsh_bytes.extend_from_slice(recipient.as_bytes());

    // Borsh Option<String>: callback_url = None
    borsh_bytes.push(0);

    let hash = sha2::Sha256::digest(&borsh_bytes);
    let hash_hex = hex::encode(hash);

    // Build v1.signer sign args
    let sign_args = json!({
        "request": {
            "path": request.dao_id,
            "payload_v2": { "Eddsa": hash_hex },
            "domain_id": 1,
        }
    });

    let sign_args_b64 =
        base64::engine::general_purpose::STANDARD.encode(sign_args.to_string());

    let proposal = json!({
        "description": "Authenticate DAO for confidential intents",
        "kind": {
            "FunctionCall": {
                "receiver_id": V1_SIGNER_CONTRACT,
                "actions": [{
                    "method_name": "sign",
                    "args": sign_args_b64,
                    "deposit": "1",
                    "gas": V1_SIGNER_GAS,
                }]
            }
        }
    });

    let auth_payload = AuthPayload {
        message: auth_message,
        nonce: nonce_b64,
        recipient: recipient.to_string(),
    };

    // Store as pending auth for auto-submission after approval
    let payload_json = serde_json::to_value(&auth_payload).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to serialize auth payload: {}", e),
        )
    })?;

    sqlx::query(
        r#"
        INSERT INTO pending_confidential_intents (dao_id, proposal_id, intent_payload, intent_type)
        VALUES ($1, -1, $2, 'auth')
        ON CONFLICT (dao_id, proposal_id) DO UPDATE SET
            intent_payload = EXCLUDED.intent_payload,
            intent_type = 'auth',
            status = 'pending',
            updated_at = NOW()
        "#,
    )
    .bind(&request.dao_id)
    .bind(&payload_json)
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to store pending auth: {}", e),
        )
    })?;

    log::info!(
        "Prepared confidential auth proposal for DAO {}",
        request.dao_id
    );

    Ok(Json(PrepareAuthResponse {
        proposal,
        auth_payload,
    }))
}

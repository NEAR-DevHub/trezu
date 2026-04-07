//! Prepare a confidential auth proposal for a DAO.
//!
//! Builds the NEP-413 auth message, computes the hash, and returns the
//! v1.signer proposal args. Also stores the auth payload so the relay
//! can auto-authenticate after the proposal is approved.

use axum::{Json, extract::State, http::StatusCode};
use base64::Engine;
use near_account_id::AccountIdRef;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

use crate::{AppState, auth::AuthUser};

const V1_SIGNER_CONTRACT: &AccountIdRef = AccountIdRef::new_or_panic("v1.signer");
const INTENTS_CONTRACT: &AccountIdRef = AccountIdRef::new_or_panic("intents.near");
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

/// Fetch the current salt from the intents.near contract.
pub(crate) async fn fetch_salt(state: &Arc<AppState>) -> Result<[u8; 4], String> {
    let result = near_api::Contract(INTENTS_CONTRACT.into())
        .call_function("current_salt", ())
        .read_only::<String>()
        .fetch_from(&state.network)
        .await
        .map_err(|e| format!("Failed to fetch salt from intents.near: {}", e))?;

    let hex_str = result.data.trim_matches('"');
    let salt_bytes = hex::decode(hex_str).map_err(|e| format!("Invalid salt hex: {}", e))?;

    salt_bytes
        .try_into()
        .map_err(|_| "Salt not 4 bytes".to_string())
}

/// Build a 32-byte nonce matching the 1Click API expected format.
pub(crate) fn build_nonce(salt: &[u8; 4], deadline: &chrono::DateTime<chrono::Utc>) -> [u8; 32] {
    let deadline_ns = (deadline.timestamp_millis() as u64) * 1_000_000;
    let now_ns = (chrono::Utc::now().timestamp_millis() as u64) * 1_000_000;
    let random_tail: [u8; 7] = rand::random();
    let mut nonce = [0u8; 32];
    nonce[0..4].copy_from_slice(&[0x56, 0x28, 0xF6, 0xC6]); // magic prefix
    nonce[4] = 0; // version
    nonce[5..9].copy_from_slice(salt);
    nonce[9..17].copy_from_slice(&deadline_ns.to_le_bytes());
    nonce[17..25].copy_from_slice(&now_ns.to_le_bytes());
    nonce[25..32].copy_from_slice(&random_tail);
    nonce
}

/// Build the auth proposal JSON and NEP-413 auth payload for a DAO.
///
/// Returns `(proposal, auth_payload_json)` — the proposal is ready to pass to
/// `add_proposal`, and the auth payload is used later when authenticating with
/// the 1Click API.
pub(crate) async fn build_auth_proposal(
    state: &Arc<AppState>,
    dao_id: &str,
) -> Result<(serde_json::Value, serde_json::Value), (StatusCode, String)> {
    let deadline = chrono::Utc::now() + chrono::Duration::days(7);
    let deadline_str = deadline.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let auth_message = json!({
        "deadline": deadline_str,
        "intents": [],
        "signer_id": dao_id,
    })
    .to_string();

    let salt = fetch_salt(state).await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to fetch salt: {}", e),
        )
    })?;
    let nonce = build_nonce(&salt, &deadline);
    let nonce_b64 = base64::engine::general_purpose::STANDARD.encode(nonce);

    let nep413_payload = near_api::signer::NEP413Payload {
        message: auth_message.clone(),
        nonce,
        recipient: INTENTS_CONTRACT.to_string(),
        callback_url: None,
    };
    let hash = nep413_payload.compute_hash().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to compute NEP-413 hash: {}", e),
        )
    })?;
    let hash_hex = hex::encode(hash.0);

    let sign_args = json!({
        "request": {
            "path": dao_id,
            "payload_v2": { "Eddsa": hash_hex },
            "domain_id": 1,
        }
    });
    let sign_args_b64 = base64::engine::general_purpose::STANDARD.encode(sign_args.to_string());

    let proposal = json!({
        "proposal": {
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
        }
    });

    let auth_payload = json!({
        "message": auth_message,
        "nonce": nonce_b64,
        "recipient": INTENTS_CONTRACT.to_string(),
    });

    Ok((proposal, auth_payload))
}

/// POST /api/confidential-intents/prepare-auth
///
/// Builds a v1.signer signing proposal for DAO authentication.
/// The auth payload is stored for auto-submission after approval.
pub async fn prepare_auth(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(request): Json<PrepareAuthRequest>,
) -> Result<Json<PrepareAuthResponse>, (StatusCode, String)> {
    auth_user
        .verify_dao_member(&state.db_pool, &request.dao_id)
        .await
        .map_err(|e| (StatusCode::FORBIDDEN, format!("Not a DAO member: {}", e)))?;

    let (proposal_with_wrapper, auth_payload_json) =
        build_auth_proposal(&state, &request.dao_id).await?;

    // build_auth_proposal wraps in {"proposal": ...}, unwrap for the handler response
    let proposal = proposal_with_wrapper
        .get("proposal")
        .cloned()
        .unwrap_or(proposal_with_wrapper);

    let auth_payload = AuthPayload {
        message: auth_payload_json["message"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        nonce: auth_payload_json["nonce"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        recipient: auth_payload_json["recipient"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    };

    // Store as pending auth for auto-submission after approval
    let payload_json = serde_json::to_value(&auth_payload).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to serialize auth payload: {}", e),
        )
    })?;

    sqlx::query!(
        r#"
        INSERT INTO confidential_intents (dao_id, proposal_id, intent_payload, intent_type)
        VALUES ($1, -1, $2, 'auth')
        ON CONFLICT (dao_id, proposal_id) DO UPDATE SET
            intent_payload = EXCLUDED.intent_payload,
            intent_type = 'auth',
            status = 'pending',
            updated_at = NOW()
        "#,
        &request.dao_id,
        &payload_json,
    )
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

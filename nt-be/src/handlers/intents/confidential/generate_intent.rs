use axum::{Json, extract::State, http::StatusCode};
use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

use crate::constants::INTENTS_CONTRACT_ID;
use crate::{AppState, auth::AuthUser};

use super::prepare_auth::{build_nonce, fetch_salt};

/// Single quote entry. For non-bulk payments the request carries a single entry
/// (`quotes.len() == 1`); for bulk payments it carries N entries that all get
/// merged into one signed NEP-413 message.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuoteEntry {
    /// Full quote response blob — depositAddress is extracted from
    /// `quote_metadata.quote.depositAddress`. Stored so the UI can display
    /// amounts, tokens, recipient, etc. for confidential proposals.
    pub quote_metadata: Value,
    /// Recipient address (intents ID, e.g. "near:alice.near" or an external chain addr).
    pub recipient: String,
    /// Amount in yocto-units (stringified u128).
    pub amount: String,
    /// Token ID in intents-asset format (e.g. "nep141:wrap.near").
    pub token_id: String,
}

/// Unified request. One endpoint handles single and bulk confidential payments —
/// the only difference is `quotes.len()`.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GenerateIntentRequest {
    /// "swap_transfer"
    pub r#type: String,
    /// The signing standard: "nep413" for NEAR
    pub standard: String,
    /// Intents user ID (e.g., "near:mydao.sputnik-dao.near")
    pub signer_id: String,
    pub quotes: Vec<QuoteEntry>,
    /// Optional user-provided memo. Stored in the DB since the on-chain
    /// description is opaque for privacy.
    pub notes: Option<String>,
}

/// Proxy endpoint for 1Click API generate-intent.
///
/// For every entry in `quotes` we call 1Click's `/v0/generate-intent` so each
/// depositAddress gets its correlationId registered server-side. We then merge
/// the returned per-quote `message.intents` arrays into ONE composite NEP-413
/// message with a fresh nonce/deadline, compute its hash, and return it for
/// v1.signer to sign. The DAO proposal only signs this single hash regardless
/// of recipient count.
///
/// POST /api/confidential-intents/generate-intent
pub async fn generate_intent(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(request): Json<GenerateIntentRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if request.quotes.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "quotes must contain at least one entry".to_string(),
        ));
    }

    let dao_id = request
        .signer_id
        .strip_prefix("near:")
        .unwrap_or(&request.signer_id)
        .to_string();
    auth_user
        .verify_dao_member(&state.db_pool, &dao_id)
        .await
        .map_err(|e| (StatusCode::FORBIDDEN, format!("Not a DAO member: {}", e)))?;

    let access_token = super::refresh_dao_jwt(&state, &dao_id).await?;

    let is_bulk = request.quotes.len() > 1;
    log::info!(
        "generate_intent called: type={}, signerId={}, quotes={}",
        request.r#type,
        request.signer_id,
        request.quotes.len(),
    );

    let url = format!("{}/v0/generate-intent", state.env_vars.confidential_api_url);

    let mut composite_intents: Vec<Value> = Vec::with_capacity(request.quotes.len());
    let mut correlation_ids: Vec<String> = Vec::with_capacity(request.quotes.len());
    let mut min_deadline: Option<chrono::DateTime<chrono::Utc>> = None;

    for (idx, entry) in request.quotes.iter().enumerate() {
        let deposit_address = entry
            .quote_metadata
            .get("quote")
            .and_then(|q| q.get("depositAddress"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    format!(
                        "quotes[{}].quote_metadata.quote.depositAddress is required",
                        idx
                    ),
                )
            })?;

        let body = json!({
            "type": request.r#type,
            "standard": request.standard,
            "depositAddress": deposit_address,
            "signerId": request.signer_id,
        });

        let mut req = state
            .http_client
            .post(&url)
            .header("content-type", "application/json")
            .header("Authorization", format!("Bearer {}", access_token));
        if let Some(api_key) = &state.env_vars.oneclick_api_key {
            req = req.header("x-api-key", api_key);
        }
        let response = req.json(&body).send().await.map_err(|e| {
            log::error!(
                "Error calling 1Click generate-intent (quote {}): {}",
                idx,
                e
            );
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to generate intent for quote {}: {}", idx, e),
            )
        })?;

        let status = response.status();
        let response_body: Value = response.json().await.map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to parse generate-intent response: {}", e),
            )
        })?;

        if !status.is_success() {
            let error_message = response_body
                .get("error")
                .or_else(|| response_body.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error from 1Click API");

            return Err((
                StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
                format!("1Click rejected quote {}: {}", idx, error_message),
            ));
        }

        let message_str = response_body
            .get("intent")
            .and_then(|i| i.get("payload"))
            .and_then(|p| p.get("message"))
            .and_then(|m| m.as_str())
            .ok_or_else(|| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!("generate-intent response {} missing payload.message", idx),
                )
            })?;
        let message_json: Value = serde_json::from_str(message_str).map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!(
                    "Malformed NEP-413 message from 1Click (quote {}): {}",
                    idx, e
                ),
            )
        })?;

        let intents_arr = message_json
            .get("intents")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!("NEP-413 message (quote {}) missing intents array", idx),
                )
            })?;
        composite_intents.extend(intents_arr.iter().cloned());

        if let Some(deadline_str) = message_json.get("deadline").and_then(|v| v.as_str())
            && let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(deadline_str)
        {
            let parsed_utc = parsed.with_timezone(&chrono::Utc);
            min_deadline = Some(match min_deadline {
                Some(existing) => existing.min(parsed_utc),
                None => parsed_utc,
            });
        }

        if let Some(cid) = response_body.get("correlationId").and_then(|v| v.as_str()) {
            correlation_ids.push(cid.to_string());
        }
    }

    let deadline = min_deadline.unwrap_or_else(|| chrono::Utc::now() + chrono::Duration::weeks(5));
    let deadline_str = deadline.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    let composite_message = json!({
        "deadline": deadline_str,
        "intents": composite_intents,
        "signer_id": dao_id,
    })
    .to_string();

    let salt = fetch_salt(&state).await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to fetch salt: {}", e),
        )
    })?;
    let nonce = build_nonce(&salt, &deadline);
    let nonce_b64 = base64::engine::general_purpose::STANDARD.encode(nonce);

    let nep413_payload = near_api::signer::NEP413Payload {
        message: composite_message.clone(),
        nonce,
        recipient: INTENTS_CONTRACT_ID.to_string(),
        callback_url: None,
    };
    let hash = nep413_payload.compute_hash().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to compute NEP-413 hash: {}", e),
        )
    })?;
    let payload_hash = hex::encode(hash.0);

    let composite_payload = json!({
        "message": composite_message,
        "nonce": nonce_b64,
        "recipient": INTENTS_CONTRACT_ID.to_string(),
    });

    let intent_type = if is_bulk { "bulk_payment" } else { "payment" };

    // Quote metadata: array form for bulk (N entries), unwrapped object for
    // single payment (preserves existing FE read-path at proposal-extractors.ts).
    let stored_quote_metadata: Value = if is_bulk {
        Value::Array(
            request
                .quotes
                .iter()
                .map(|q| q.quote_metadata.clone())
                .collect(),
        )
    } else {
        request.quotes[0].quote_metadata.clone()
    };
    let stored_correlation_id = if is_bulk {
        None
    } else {
        correlation_ids.first().map(|s| s.as_str())
    };

    if let Err(e) = crate::handlers::relay::confidential::store_pending_intent(
        &state.db_pool,
        &dao_id,
        &payload_hash,
        intent_type,
        &composite_payload,
        stored_correlation_id,
        Some(&stored_quote_metadata),
        request.notes.as_deref(),
    )
    .await
    {
        log::warn!("Failed to store pending intent for {}: {}", dao_id, e);
    }

    let response_body = json!({
        "intent": {
            "standard": request.standard,
            "payload": composite_payload,
        },
        "payloadHash": payload_hash,
        "correlationIds": correlation_ids,
    });

    Ok(Json(response_body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::intents::quote::{QuoteRequest, get_quote};
    use crate::utils::env::EnvVars;
    use axum::extract::State;

    /// Helper to create AppState pointing at the real 1Click API
    async fn create_real_api_state() -> Arc<AppState> {
        dotenvy::from_filename(".env").ok();
        dotenvy::from_filename(".env.test").ok();

        let mut env_vars = EnvVars::default();
        env_vars.oneclick_api_url = "https://1click.chaindefuser.com".to_string();
        env_vars.oneclick_jwt_token = std::env::var("ONECLICK_JWT_TOKEN").ok();
        env_vars.oneclick_app_fee_bps = Some(35);
        env_vars.oneclick_app_fee_recipient = Some("trezu.sputnik-dao.near".to_string());
        env_vars.oneclick_referral = Some("trezu".to_string());

        let db_pool = sqlx::postgres::PgPool::connect_lazy(&env_vars.database_url)
            .expect("Failed to create lazy pool");

        Arc::new(
            AppState::builder()
                .db_pool(db_pool)
                .env_vars(env_vars)
                .build()
                .await
                .expect("Failed to build AppState"),
        )
    }

    async fn live_quote(state: &Arc<AppState>, dao_id: &str, amount: &str) -> Value {
        let deadline = chrono::Utc::now() + chrono::Duration::minutes(10);
        let quote_request = QuoteRequest {
            dao_id: None,
            dry: Some(false),
            swap_type: Some("EXACT_INPUT".to_string()),
            slippage_tolerance: Some(100),
            origin_asset: "nep141:wrap.near".to_string(),
            deposit_type: Some("INTENTS".to_string()),
            destination_asset: "nep141:wrap.near".to_string(),
            amount: amount.to_string(),
            refund_to: Some(format!("near:{}", dao_id)),
            refund_type: Some("CONFIDENTIAL_INTENTS".to_string()),
            recipient: Some(format!("near:{}", dao_id)),
            recipient_type: Some("CONFIDENTIAL_INTENTS".to_string()),
            deadline: deadline.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
            quote_waiting_time_ms: Some(5000),
        };
        get_quote(
            State(state.clone()),
            crate::auth::OptionalAuthUser(None),
            Json(quote_request),
        )
        .await
        .expect("quote failed")
        .0
    }

    /// Integration test: get a real quote then call generate-intent.
    ///
    /// Run with: cargo test test_real_generate_intent -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn test_real_generate_intent() {
        let state = create_real_api_state().await;
        let dao_id = "webassemblymusic-treasury.sputnik-dao.near";

        let quote_response = live_quote(&state, dao_id, "100000000000000000000000").await;
        let generate_request = GenerateIntentRequest {
            r#type: "swap_transfer".to_string(),
            standard: "nep413".to_string(),
            signer_id: format!("near:{}", dao_id),
            quotes: vec![QuoteEntry {
                quote_metadata: quote_response.clone(),
                recipient: format!("near:{}", dao_id),
                amount: "100000000000000000000000".to_string(),
                token_id: "nep141:wrap.near".to_string(),
            }],
            notes: None,
        };

        let auth_user = crate::auth::AuthUser {
            account_id: "test.near".to_string(),
        };
        let response = generate_intent(State(state.clone()), auth_user, Json(generate_request))
            .await
            .expect("generate_intent failed");
        println!(
            "Generate intent response:\n{}",
            serde_json::to_string_pretty(&response.0).unwrap()
        );
    }

    /// Integration test: two live quotes merged into one bulk intent.
    ///
    /// Run with: cargo test test_real_generate_bulk_intent -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn test_real_generate_bulk_intent() {
        let state = create_real_api_state().await;
        let dao_id = "webassemblymusic-treasury.sputnik-dao.near";

        let q1 = live_quote(&state, dao_id, "100000000000000000000000").await;
        let q2 = live_quote(&state, dao_id, "50000000000000000000000").await;

        let request = GenerateIntentRequest {
            r#type: "swap_transfer".to_string(),
            standard: "nep413".to_string(),
            signer_id: format!("near:{}", dao_id),
            quotes: vec![
                QuoteEntry {
                    quote_metadata: q1,
                    recipient: format!("near:{}", dao_id),
                    amount: "100000000000000000000000".to_string(),
                    token_id: "nep141:wrap.near".to_string(),
                },
                QuoteEntry {
                    quote_metadata: q2,
                    recipient: format!("near:{}", dao_id),
                    amount: "50000000000000000000000".to_string(),
                    token_id: "nep141:wrap.near".to_string(),
                },
            ],
            notes: Some("integration bulk test".to_string()),
        };

        let auth_user = crate::auth::AuthUser {
            account_id: "test.near".to_string(),
        };
        let response = generate_intent(State(state.clone()), auth_user, Json(request))
            .await
            .expect("generate_intent (bulk) failed");
        println!(
            "Bulk generate intent response:\n{}",
            serde_json::to_string_pretty(&response.0).unwrap()
        );
        let payload_hash = response
            .0
            .get("payloadHash")
            .and_then(|v| v.as_str())
            .expect("payloadHash");
        assert_eq!(payload_hash.len(), 64);
        let corr = response
            .0
            .get("correlationIds")
            .and_then(|v| v.as_array())
            .expect("correlationIds");
        assert_eq!(corr.len(), 2);
    }
}

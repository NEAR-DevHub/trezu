//! Auto-submit confidential intents after DAO proposal approval.
//!
//! When a confidential_transfer proposal is created, the intent payload is stored
//! in `confidential_intents` keyed by its NEP-413 payload hash. Once the MPC
//! signature exists on chain the signed intent is submitted to the 1Click API by
//! whichever path sees it first: the vote relay, when the signature is already
//! in the relay's execution outcome, or the per-DAO 1Click history poll, which
//! reads it from the execution transaction (the MPC callback can land well after
//! the relay's RPC wait). [`ConfidentialIntentSubmitter`] serialises the two with
//! a claim stamp so an intent is never submitted twice.

use crate::{
    AppState,
    constants::V1_SIGNER_CONTRACT_ID,
    handlers::intents::confidential::{
        bronze::ingest_worker::trigger_confidential_history_refresh,
        gold::history_events::refresh_gold_metadata_for_intent, link_intent_to_history_event,
        proposal_signals::extract_sign_call_from_logs, recover_unsubmitted_intent_from_history,
        types::normalize_quote_metadata_accounts,
    },
    handlers::relay::{effects::background, parse::ProposalKind},
    observability::sanitize_sensitive_json_value,
    services::{CredentialScope, TokenBundle},
    utils::{cache::CacheKey, jsonrpc::create_rpc_client, transport::with_transport_retry},
};
use base64::Engine;
use chrono::{DateTime, Utc};
use near_jsonrpc_client::methods;
use near_primitives::{
    hash::CryptoHash, types::AccountId as RpcAccountId, views::TxExecutionStatus,
};
use reqwest::StatusCode;
use serde_json::Value;
use sqlx::PgPool;
use std::fmt;
use std::sync::Arc;

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

/// Fetch the Ed25519 derived public key for the provided account/path from v1.signer.
#[tracing::instrument(level = "debug", skip_all, fields(account_id = account_id))]
pub(crate) async fn fetch_mpc_public_key(
    state: &AppState,
    account_id: &str,
    path: &str,
) -> Result<String, (StatusCode, String)> {
    let args = serde_json::json!({
        "path": path,
        "predecessor": account_id,
        "domain_id": 1,
    });

    let result = state
        .cache
        .cached_contract_call(
            crate::utils::cache::CacheTier::LongTerm,
            CacheKey::new("mpc-public-key")
                .with(account_id)
                .with(path)
                .build(),
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

pub struct PendingIntentInput<'a> {
    pub dao_id: &'a str,
    pub payload_hash: &'a str,
    pub intent_payload: &'a Value,
    pub correlation_id: Option<&'a str>,
    pub quote_metadata: Option<&'a Value>,
    pub deposit_address: &'a str,
    pub notes: Option<&'a str>,
}

/// Store a pending intent for later auto-submission.
#[tracing::instrument(
    level = "info",
    skip_all,
    fields(dao_id = tracing::field::Empty, hash = tracing::field::Empty)
)]
pub async fn store_pending_intent(
    pool: &PgPool,
    input: PendingIntentInput<'_>,
) -> Result<(), String> {
    tracing::Span::current().record("dao_id", tracing::field::display(input.dao_id));
    tracing::Span::current().record("hash", tracing::field::display(input.payload_hash));

    let quote_metadata = input
        .quote_metadata
        .map(|v| normalize_quote_metadata_accounts(v.clone()));

    sqlx::query(
        r#"
        INSERT INTO confidential_intents (
            dao_id,
            payload_hash,
            intent_payload,
            correlation_id,
            quote_metadata,
            deposit_address,
            notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (dao_id, payload_hash) DO UPDATE SET
            intent_payload = EXCLUDED.intent_payload,
            correlation_id = EXCLUDED.correlation_id,
            quote_metadata = EXCLUDED.quote_metadata,
            deposit_address = EXCLUDED.deposit_address,
            notes = EXCLUDED.notes,
            intent_type = 'shield',
            status = 'pending',
            submit_result = NULL,
            submit_claimed_at = NULL,
            updated_at = NOW()
        "#,
    )
    .bind(input.dao_id)
    .bind(input.payload_hash)
    .bind(input.intent_payload)
    .bind(input.correlation_id)
    .bind(quote_metadata)
    .bind(input.deposit_address)
    .bind(input.notes)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to store pending intent: {}", e))?;

    tracing::info!(
        "Stored pending confidential intent for {} (hash={})",
        input.dao_id,
        input.payload_hash
    );
    Ok(())
}

/// Extract MPC signature from the execution result debug string.
/// Searches for the base64 marker "eyJzY2hlbWUi" (= `{"scheme"`).
/// Base64 prefix of the signer's `{"scheme":…}` signature payload; its
/// presence in a vote outcome means a signature was produced.
pub(crate) const MPC_SIGNATURE_MARKER: &str = "eyJzY2hlbWUi";

pub(crate) fn extract_mpc_signature(result_debug: &str) -> Option<Vec<u8>> {
    let start = result_debug.find(MPC_SIGNATURE_MARKER)?;
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

/// Extract the `payload_v2.Eddsa` hash from a Sputnik proposal `kind`.
///
/// Returns the hash when `kind` is a `FunctionCall` to `v1.signer` whose first
/// inner action signs a `payload_v2.Eddsa` request; otherwise `None`. The `kind`
/// is the value carried in an `act_proposal`'s `proposal` argument.
pub fn extract_v1_signer_hash_from_kind(kind: &Value) -> Option<String> {
    let function_call = ProposalKind::from_value(kind).function_call?;
    if function_call.receiver_id.as_str() != "v1.signer" {
        return None;
    }

    let first_action = function_call.actions.first()?;
    let inner_args_bytes = base64::engine::general_purpose::STANDARD
        .decode(&first_action.args)
        .ok()?;
    let inner_args: Value = serde_json::from_slice(&inner_args_bytes).ok()?;

    inner_args
        .get("request")?
        .get("payload_v2")?
        .get("Eddsa")?
        .as_str()
        .map(str::to_owned)
}

/// Spawn a background auto-submit for each confidential intent referenced by an
/// approving vote relay. Each task matches its payload hash to a pending intent
/// and, if the MPC signature is in the execution result, submits it to 1Click.
///
/// Each entry pairs the `v1.signer` payload hash with the on-chain proposal id
/// being voted on; the proposal id is forwarded so bulk-payment headers can be
/// linked and armed once the vote lands.
#[tracing::instrument(
    level = "debug",
    skip_all,
    fields(treasury_id = treasury_id, intent_count = tracing::field::Empty)
)]
pub fn spawn_auto_submit_intents(
    state: &Arc<AppState>,
    treasury_id: &str,
    payloads: Vec<(String, u64)>,
    result_debug: &str,
) {
    tracing::Span::current().record("intent_count", payloads.len());

    for (payload_hash, proposal_id) in payloads {
        let state = state.clone();
        let treasury_id = treasury_id.to_owned();
        let result_debug = result_debug.to_owned();
        background::spawn("auto-submit confidential intent", async move {
            try_auto_submit_intent(
                &state,
                &treasury_id,
                &payload_hash,
                proposal_id,
                &result_debug,
            )
            .await;
        });
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IntentSubmitKind {
    /// `/v0/submit-intent` — bulk recipients + single-shield path.
    Shield,
    /// `/v0/auth/authenticate` — JWT-issuing auth call.
    Auth,
}

/// Why 1Click did not accept a signed intent. `Rejected` is final for that
/// signature; `Transport` means the answer never arrived and the attempt may be
/// repeated (1Click dedupes by payload hash).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OneclickSubmitError {
    Transport(String),
    Rejected(String),
}

impl fmt::Display for OneclickSubmitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transport(message) | Self::Rejected(message) => f.write_str(message),
        }
    }
}

/// POST a signed intent to 1Click. Returns the parsed JSON body on success.
/// `signature_bytes` is the raw 64-byte Ed25519 signature.
pub async fn submit_intent_to_oneclick(
    state: &AppState,
    kind: IntentSubmitKind,
    intent_payload: &Value,
    public_key: &str,
    signature_bytes: &[u8],
) -> Result<Value, OneclickSubmitError> {
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
        .map_err(|e| OneclickSubmitError::Transport(format!("1click {}: {}", path, e)))?;
    let status = response.status();
    let resp_body: Value = response.json().await.unwrap_or_default();
    if !status.is_success() {
        let sanitized_body = sanitize_sensitive_json_value(&resp_body);
        return Err(OneclickSubmitError::Rejected(format!(
            "1click {} {}: {:?}",
            path, status, sanitized_body
        )));
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
#[tracing::instrument(
    level = "info",
    skip_all,
    fields(treasury_id = treasury_id, hash = tracing::field::Empty)
)]
pub async fn try_auto_submit_intent(
    state: &Arc<AppState>,
    treasury_id: &str,
    payload_hash: &str,
    proposal_id: u64,
    result_debug: &str,
) {
    tracing::Span::current().record("hash", tracing::field::display(payload_hash));

    // Extract MPC signature from execution result. Presence of the sig is
    // the signal that the vote actually approved the proposal — only then
    // do we link bulk rows or auto-submit the intent.
    let sig_bytes = match extract_mpc_signature(result_debug) {
        Some(bytes) => bytes,
        None => {
            // The marker present but unparseable means the signer produced a
            // signature we no longer understand (format/protocol drift) — the
            // intent will sit `pending` forever. Marker absent is the routine
            // non-approving vote (no signature expected yet).
            if result_debug.contains(MPC_SIGNATURE_MARKER) {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfIntentSigParseFailed,
                    treasury_id,
                    payload_hash,
                    proposal_id
                );
            } else {
                tracing::debug!(
                    treasury_id,
                    payload_hash,
                    "no MPC signature in vote result (vote did not approve yet)"
                );
            }
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
            tracing::info!(
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
            tracing::warn!(
                "Failed to link bulk-payment proposal for {} (hash={}): {}",
                treasury_id,
                payload_hash,
                e
            );
        }
    }

    ConfidentialIntentSubmitter::new(state)
        .submit_signed(treasury_id, payload_hash, &sig_bytes)
        .await;
}

/// How one attempt to hand a signed intent to 1Click ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IntentSubmitOutcome {
    /// 1Click accepted it; `submit_result` holds the response.
    Submitted,
    /// 1Click rejected it; the row is `failed` with the error in `submit_result`.
    Rejected(String),
    /// A transient failure (RPC, transport, key fetch). The row keeps its
    /// status and is retried by the per-DAO 1Click poll.
    Deferred(String),
    /// The execution transaction does not carry the MPC callback receipt yet.
    NotSignedYet,
    /// Already submitted, failed, or claimed by another path within the claim window.
    AlreadyHandled,
}

#[derive(Debug, sqlx::FromRow)]
struct ClaimedIntent {
    intent_payload: Value,
    intent_type: String,
}

/// Whether the DAO's ingested 1Click history vouches for an unsubmitted intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HistoryReconciliation {
    /// 1Click has it; the row is now `submitted`.
    Recovered,
    /// No matching history row: safe to re-post or expire.
    NotInHistory,
    /// The lookup itself failed; nothing is known, so leave the row alone.
    Unknown,
}

/// Executed on chain, never accepted by 1Click: what the per-DAO poll re-attempts.
#[derive(Debug, sqlx::FromRow)]
struct AwaitingSubmitIntent {
    payload_hash: String,
    intent_payload: Value,
    proposal_execution_transaction_hash: String,
}

impl AwaitingSubmitIntent {
    /// NEP-413 message deadline. Past it the intents contract rejects the
    /// signature, so there is nothing left to submit.
    fn intent_deadline(&self) -> Option<DateTime<Utc>> {
        intent_deadline(&self.intent_payload)
    }
}

fn intent_deadline(intent_payload: &Value) -> Option<DateTime<Utc>> {
    let message = intent_payload.get("message")?.as_str()?;
    let message: Value = serde_json::from_str(message).ok()?;
    let deadline = message.get("deadline")?.as_str()?;
    DateTime::parse_from_rfc3339(deadline)
        .ok()
        .map(|deadline| deadline.with_timezone(&Utc))
}

/// Rows re-attempted per poll of one DAO.
const AWAITING_SUBMIT_BATCH: i64 = 20;
const CONFIDENTIAL_TX_STATUS_LABEL: &str = "confidential_intent_tx_status";

/// Hands a signed confidential intent to 1Click exactly once, from whichever
/// path sees the MPC signature first: the vote relay (signature in the relay
/// outcome), or the per-DAO 1Click poll (signature read from the execution
/// transaction). A conditional claim on `submit_claimed_at` serialises them.
pub struct ConfidentialIntentSubmitter<'a> {
    state: &'a AppState,
}

impl<'a> ConfidentialIntentSubmitter<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    /// Submit with a signature already in hand.
    pub async fn submit_signed(
        &self,
        dao_id: &str,
        payload_hash: &str,
        signature: &[u8],
    ) -> IntentSubmitOutcome {
        let claimed = match self.claim(dao_id, payload_hash).await {
            Ok(Some(claimed)) => claimed,
            Ok(None) => {
                tracing::info!(
                    "MPC signature found but intent {}/{} is already handled or claimed",
                    dao_id,
                    payload_hash
                );
                return IntentSubmitOutcome::AlreadyHandled;
            }
            Err(e) => {
                tracing::error!(
                    "DB error claiming intent for {} (hash={}): {}",
                    dao_id,
                    payload_hash,
                    e
                );
                return IntentSubmitOutcome::Deferred(e.to_string());
            }
        };
        let intent_type = claimed.intent_type.as_str();

        // Fetch the DAO's derived MPC public key from v1.signer. Bulk-payment
        // auth proposals sign with an empty path (the JWT is issued for the
        // subaccount; the DAO signs as predecessor); everything else uses the
        // DAO self path.
        let mpc_path = if intent_type == "bulk_auth" {
            ""
        } else {
            dao_id
        };
        let mpc_public_key = match fetch_mpc_public_key(self.state, dao_id, mpc_path).await {
            Ok(key) => key,
            Err(e) => {
                tracing::error!("Failed to fetch MPC public key for {}: {:?}", dao_id, e);
                self.release_claim(dao_id, payload_hash).await;
                return IntentSubmitOutcome::Deferred(format!("{:?}", e));
            }
        };

        tracing::info!(
            "Auto-submitting {} for {} (hash={}, mpc_key={})",
            intent_type,
            dao_id,
            payload_hash,
            mpc_public_key
        );

        let kind = if intent_type == "auth" || intent_type == "bulk_auth" {
            IntentSubmitKind::Auth
        } else {
            IntentSubmitKind::Shield
        };
        let submitted = submit_intent_to_oneclick(
            self.state,
            kind,
            &claimed.intent_payload,
            &mpc_public_key,
            signature,
        )
        .await;
        let resp_body = match submitted {
            Ok(resp_body) => resp_body,
            Err(OneclickSubmitError::Transport(err)) => {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfIntentSubmitFailed,
                    dao_id,
                    payload_hash,
                    intent_type,
                    error = %err
                );
                // The claim stays: 1Click may have received the request, so the
                // poll re-attempts only after the claim window (1Click dedupes
                // by payload hash, so a repeat is harmless).
                return IntentSubmitOutcome::Deferred(err);
            }
            Err(OneclickSubmitError::Rejected(err)) => {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfIntentSubmitFailed,
                    dao_id,
                    payload_hash,
                    intent_type,
                    error = %err
                );
                self.mark_failed(dao_id, payload_hash, serde_json::json!({ "error": err }))
                    .await;
                return IntentSubmitOutcome::Rejected(err);
            }
        };

        let sanitized_resp_body = sanitize_sensitive_json_value(&resp_body);
        tracing::info!(
            "Successfully submitted {} for {} (hash={}): {:?}",
            intent_type,
            dao_id,
            payload_hash,
            sanitized_resp_body
        );

        // For auth flavors: store the JWT tokens in monitored_accounts.
        // `auth` authenticates the DAO itself; `bulk_auth` authenticates
        // the DAO's bulk-payment subaccount (bulk-payments activation).
        // An auth intent is only `submitted` once its credentials are
        // stored — a 200 without tokens or a failed save marks it
        // `failed` (the UI maps that to a restartable state).
        if intent_type == "auth" || intent_type == "bulk_auth" {
            let (Some(access_token), Some(refresh_token)) = (
                resp_body.get("accessToken").and_then(|v| v.as_str()),
                resp_body.get("refreshToken").and_then(|v| v.as_str()),
            ) else {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfAuthTokensMissing,
                    intent_type,
                    dao_id,
                    payload_hash,
                    response = ?sanitized_resp_body
                );
                let error = format!("{} response missing tokens", intent_type);
                self.mark_failed(dao_id, payload_hash, serde_json::json!({ "error": error }))
                    .await;
                return IntentSubmitOutcome::Rejected(error);
            };
            let expires_in = resp_body
                .get("expiresIn")
                .and_then(|v| v.as_i64())
                .unwrap_or(3600);
            let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in);

            let scope = if intent_type == "bulk_auth" {
                CredentialScope::BulkPayment
            } else {
                CredentialScope::Dao
            };
            let bundle = TokenBundle {
                access_token: access_token.to_string(),
                refresh_token: refresh_token.to_string(),
            };
            let store = self.state.confidential_credentials();
            let persisted = match store.store_new(dao_id, scope, &bundle, expires_at).await {
                Ok(()) => Ok(()),
                // A stale-generation fence rejection mid-rotation would
                // otherwise be terminal here: this trigger fires exactly
                // once, retrying on this pod can never pass the fence,
                // and 1Click has already issued the pair. Persist it
                // plaintext-only instead — the load-time heal
                // re-encrypts it under the active key on the next touch
                // from an up-to-date pod.
                Err(e) if e.is_retryable() => {
                    tracing::warn!(
                        "Generation fence rejected {} JWT persistence for DAO {} ({}); storing via plaintext fallback for heal-on-load",
                        intent_type,
                        dao_id,
                        e
                    );
                    store
                        .store_new_plaintext_fallback(dao_id, scope, &bundle, expires_at)
                        .await
                }
                Err(e) => Err(e),
            };
            if let Err(e) = persisted {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfJwtPersistFailed,
                    intent_type,
                    dao_id,
                    error = %e
                );
                let error = format!("failed to persist {} credentials: {}", intent_type, e);
                self.mark_failed(dao_id, payload_hash, serde_json::json!({ "error": error }))
                    .await;
                return IntentSubmitOutcome::Rejected(error);
            }
            tracing::info!(
                "Stored {} JWT for DAO {} (expires in {}s)",
                intent_type,
                dao_id,
                expires_in
            );
        }

        let update_result = sqlx::query(
            "UPDATE confidential_intents SET status = 'submitted', submit_result = $1, updated_at = NOW() WHERE dao_id = $2 AND payload_hash = $3",
        )
        .bind(&sanitized_resp_body)
        .bind(dao_id)
        .bind(payload_hash)
        .execute(&self.state.db_pool)
        .await;

        if update_result.is_ok() {
            match link_intent_to_history_event(&self.state.db_pool, dao_id, payload_hash).await {
                Ok(Some(history_event_id)) => {
                    tracing::info!(
                        "Linked submitted confidential intent for {} (hash={}) to history_event_id={}",
                        dao_id,
                        payload_hash,
                        history_event_id
                    );
                }
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!(
                        "Failed to link submitted confidential intent for {} (hash={}): {}",
                        dao_id,
                        payload_hash,
                        e
                    );
                }
            }

            // Pull fresh Bronze for this DAO so the just-submitted intent's
            // 1Click history row is available immediately. Resets the
            // activity timestamp + next_poll_at so the scheduler stays
            // in the hot tier.
            trigger_confidential_history_refresh(self.state, dao_id).await;

            // Must run after the refresh above so the Gold row exists.
            if let Err(e) =
                refresh_gold_metadata_for_intent(&self.state.db_pool, dao_id, payload_hash).await
            {
                tracing::warn!(
                    "Failed to refresh confidential gold metadata for {} (hash={}): {}",
                    dao_id,
                    payload_hash,
                    e
                );
            }
        }
        IntentSubmitOutcome::Submitted
    }

    /// Read the MPC signature from the execution transaction, then submit.
    /// `sender_hint` only routes the RPC lookup; the DAO id is accepted.
    pub async fn submit_from_chain(
        &self,
        dao_id: &str,
        payload_hash: &str,
        execution_tx_hash: &str,
        sender_hint: &str,
    ) -> IntentSubmitOutcome {
        let tx_hash = match execution_tx_hash.parse::<CryptoHash>() {
            Ok(tx_hash) => tx_hash,
            Err(e) => {
                return IntentSubmitOutcome::Deferred(format!(
                    "invalid execution tx hash {}: {}",
                    execution_tx_hash, e
                ));
            }
        };
        let sender_account_id = match sender_hint.parse::<RpcAccountId>() {
            Ok(sender) => sender,
            Err(e) => {
                return IntentSubmitOutcome::Deferred(format!(
                    "invalid sender {}: {}",
                    sender_hint, e
                ));
            }
        };
        let client = match create_rpc_client(&self.state.archival_network) {
            Ok(client) => client,
            Err(e) => return IntentSubmitOutcome::Deferred(e.to_string()),
        };

        // `None`: return whatever executed so far without waiting on the RPC.
        // A pending MPC callback simply shows up as a missing receipt.
        let response = with_transport_retry(CONFIDENTIAL_TX_STATUS_LABEL, || {
            let req = methods::EXPERIMENTAL_tx_status::RpcTransactionStatusRequest {
                transaction_info: methods::EXPERIMENTAL_tx_status::TransactionInfo::TransactionId {
                    tx_hash,
                    sender_account_id: sender_account_id.clone(),
                },
                wait_until: TxExecutionStatus::None,
            };
            client.call(req)
        })
        .await;
        let response = match response {
            Ok(response) => response,
            Err(e) => {
                tracing::warn!(
                    "tx_status {} for {} (hash={}) failed: {}",
                    execution_tx_hash,
                    dao_id,
                    payload_hash,
                    e
                );
                return IntentSubmitOutcome::Deferred(e.to_string());
            }
        };
        let raw_response = match serde_json::to_value(&response) {
            Ok(raw) => raw,
            Err(e) => return IntentSubmitOutcome::Deferred(e.to_string()),
        };

        match signature_for_payload(&raw_response, payload_hash) {
            Some(signature) => self.submit_signed(dao_id, payload_hash, &signature).await,
            None => IntentSubmitOutcome::NotSignedYet,
        }
    }

    /// Re-attempt this DAO's executed-but-unsubmitted single intents and retire
    /// the ones whose intent deadline has passed. A row whose 1Click answer was
    /// lost in transit is first reconciled against the DAO's ingested 1Click
    /// history (the poll fetches it just before this runs): a matching history
    /// row means 1Click accepted it, so it is marked submitted instead of being
    /// re-posted or expired. Returns how many ended up submitted. Called from
    /// the per-DAO 1Click history poll.
    pub async fn resubmit_awaiting_intents(&self, dao_id: &str) -> usize {
        let rows = sqlx::query_as::<_, AwaitingSubmitIntent>(
            r#"
            SELECT payload_hash, intent_payload, proposal_execution_transaction_hash
            FROM confidential_intents
            WHERE dao_id = $1
              AND intent_type = 'shield'
              AND status IN ('pending', 'submitted')
              AND submit_result IS NULL
              AND proposal_execution_transaction_hash IS NOT NULL
              AND (submit_claimed_at IS NULL
                   OR submit_claimed_at < NOW() - INTERVAL '10 minutes')
            ORDER BY proposal_executed_at NULLS LAST, id
            LIMIT $2
            "#,
        )
        .bind(dao_id)
        .bind(AWAITING_SUBMIT_BATCH)
        .fetch_all(&self.state.db_pool)
        .await;
        let rows = match rows {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!("awaiting-submit lookup failed for {}: {}", dao_id, e);
                return 0;
            }
        };

        let now = Utc::now();
        let mut submitted = 0;
        for row in rows {
            match self.recover_from_history(dao_id, &row.payload_hash).await {
                HistoryReconciliation::Recovered => {
                    submitted += 1;
                    continue;
                }
                HistoryReconciliation::NotInHistory => {}
                // Unknown whether 1Click has it: neither expire nor re-post
                // this round; the next poll retries.
                HistoryReconciliation::Unknown => continue,
            }
            if row.intent_deadline().is_some_and(|deadline| deadline < now) {
                self.mark_expired(dao_id, &row.payload_hash).await;
                continue;
            }
            let outcome = self
                .submit_from_chain(
                    dao_id,
                    &row.payload_hash,
                    &row.proposal_execution_transaction_hash,
                    dao_id,
                )
                .await;
            match outcome {
                IntentSubmitOutcome::Submitted => submitted += 1,
                IntentSubmitOutcome::NotSignedYet => tracing::debug!(
                    "intent {}/{} executed but MPC callback not on chain yet",
                    dao_id,
                    row.payload_hash
                ),
                other => tracing::info!(
                    "resubmit of {}/{} ended with {:?}",
                    dao_id,
                    row.payload_hash,
                    other
                ),
            }
        }
        submitted
    }

    async fn claim(
        &self,
        dao_id: &str,
        payload_hash: &str,
    ) -> Result<Option<ClaimedIntent>, sqlx::Error> {
        sqlx::query_as::<_, ClaimedIntent>(
            r#"
            UPDATE confidential_intents
            SET submit_claimed_at = NOW(), updated_at = NOW()
            WHERE dao_id = $1
              AND payload_hash = $2
              AND submit_result IS NULL
              AND status IN ('pending', 'submitted')
              AND (submit_claimed_at IS NULL
                   OR submit_claimed_at < NOW() - INTERVAL '10 minutes')
            RETURNING intent_payload, intent_type
            "#,
        )
        .bind(dao_id)
        .bind(payload_hash)
        .fetch_optional(&self.state.db_pool)
        .await
    }

    async fn release_claim(&self, dao_id: &str, payload_hash: &str) {
        if let Err(e) = sqlx::query(
            "UPDATE confidential_intents SET submit_claimed_at = NULL WHERE dao_id = $1 AND payload_hash = $2 AND submit_result IS NULL",
        )
        .bind(dao_id)
        .bind(payload_hash)
        .execute(&self.state.db_pool)
        .await
        {
            tracing::warn!(
                "failed to release submit claim for {} (hash={}): {}",
                dao_id,
                payload_hash,
                e
            );
        }
    }

    /// Promote the row to `submitted` when the DAO's 1Click history already
    /// carries it (the submit answer was lost after 1Click accepted it).
    async fn recover_from_history(
        &self,
        dao_id: &str,
        payload_hash: &str,
    ) -> HistoryReconciliation {
        match recover_unsubmitted_intent_from_history(&self.state.db_pool, dao_id, payload_hash)
            .await
        {
            Ok(Some(history_event_id)) => {
                tracing::warn!(
                    "intent {}/{} had no 1Click response but is in 1Click history; marked submitted (history_event_id={})",
                    dao_id,
                    payload_hash,
                    history_event_id
                );
                if let Err(e) =
                    refresh_gold_metadata_for_intent(&self.state.db_pool, dao_id, payload_hash)
                        .await
                {
                    tracing::warn!(
                        "Failed to refresh confidential gold metadata for {} (hash={}): {}",
                        dao_id,
                        payload_hash,
                        e
                    );
                }
                HistoryReconciliation::Recovered
            }
            Ok(None) => HistoryReconciliation::NotInHistory,
            Err(e) => {
                tracing::warn!(
                    "history reconciliation for {} (hash={}) failed: {}",
                    dao_id,
                    payload_hash,
                    e
                );
                HistoryReconciliation::Unknown
            }
        }
    }

    /// Record a final failure. Never overwrites a stored 1Click response: a
    /// concurrent path may have completed the submission in the meantime.
    async fn mark_failed(&self, dao_id: &str, payload_hash: &str, submit_result: Value) {
        if let Err(db_err) = sqlx::query(
            "UPDATE confidential_intents SET status = 'failed', submit_result = $1, updated_at = NOW() WHERE dao_id = $2 AND payload_hash = $3 AND submit_result IS NULL",
        )
        .bind(submit_result)
        .bind(dao_id)
        .bind(payload_hash)
        .execute(&self.state.db_pool)
        .await
        {
            // The intent now looks `pending` with nothing ever touching it
            // again — the one state no inline alert can catch later.
            crate::error_event!(
                crate::error_event::ErrorCode::ConfIntentMarkFailedLost,
                dao_id,
                payload_hash,
                error = %db_err
            );
        }
    }

    /// Retire an executed intent whose deadline passed. Runs without holding
    /// the claim, so the write is conditional: a stored 1Click response, an
    /// existing history link, or a live claim (an in-flight submission) wins
    /// and the row is left alone.
    async fn mark_expired(&self, dao_id: &str, payload_hash: &str) {
        let updated = sqlx::query(
            r#"
            UPDATE confidential_intents
            SET status = 'failed',
                submit_result = $1,
                updated_at = NOW()
            WHERE dao_id = $2
              AND payload_hash = $3
              AND submit_result IS NULL
              AND history_event_id IS NULL
              AND status IN ('pending', 'submitted')
              AND (submit_claimed_at IS NULL
                   OR submit_claimed_at < NOW() - INTERVAL '10 minutes')
            "#,
        )
        .bind(serde_json::json!({ "error": "intent deadline passed before submission to 1Click" }))
        .bind(dao_id)
        .bind(payload_hash)
        .execute(&self.state.db_pool)
        .await;
        match updated {
            Ok(result) if result.rows_affected() == 1 => {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfIntentExpiredUnsubmitted,
                    dao_id,
                    payload_hash
                );
            }
            Ok(_) => tracing::info!(
                "expiry of {}/{} skipped: submitted or claimed concurrently",
                dao_id,
                payload_hash
            ),
            Err(db_err) => {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfIntentMarkFailedLost,
                    dao_id,
                    payload_hash,
                    error = %db_err
                );
            }
        }
    }
}

/// Signature for `payload_hash` from an `EXPERIMENTAL_tx_status` response:
/// the `v1.signer` receipt whose `sign:` log names the hash points (via
/// `SuccessReceiptId`) at the MPC callback receipt whose `SuccessValue` is
/// the signature. A transaction can carry several votes, so the hash is
/// matched explicitly instead of taking the first signature in the outcome.
fn signature_for_payload(tx_status: &Value, payload_hash: &str) -> Option<Vec<u8>> {
    let outcomes = tx_status.get("receipts_outcome")?.as_array()?;
    let sign_receipt = outcomes
        .iter()
        .find(|entry| outcome_signs_payload(entry, payload_hash))?;
    let callback_id = sign_receipt
        .get("outcome")?
        .get("status")?
        .get("SuccessReceiptId")?
        .as_str()?;
    let callback = outcomes
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some(callback_id))?;
    let success_value = callback
        .get("outcome")?
        .get("status")?
        .get("SuccessValue")?
        .as_str()?;
    extract_mpc_signature(success_value)
}

fn outcome_signs_payload(entry: &Value, payload_hash: &str) -> bool {
    let Some(outcome) = entry.get("outcome") else {
        return false;
    };
    if outcome.get("executor_id").and_then(Value::as_str) != Some(V1_SIGNER_CONTRACT_ID.as_str()) {
        return false;
    }
    let Some(logs) = outcome.get("logs").and_then(Value::as_array) else {
        return false;
    };
    logs.iter().filter_map(Value::as_str).any(|log| {
        extract_sign_call_from_logs(log).is_some_and(|call| call.payload_hash == payload_hash)
    })
}

#[cfg(test)]
mod tests {
    use near_api::{NetworkConfig, RPCEndpoint};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

    use super::*;
    use crate::utils::test_utils::build_test_state;

    /// `EXPERIMENTAL_tx_status` of rri.sputnik-dao.near #29's execution
    /// (2026-10-09): the MPC callback landed 110 blocks after the vote, so the
    /// relay never saw the signature.
    const TX_STATUS_FIXTURE: &str =
        include_str!("testdata/tx_status_7UWLRNWxcnt49oa3zLCXEvxCQwMx7HWGWriB9fQo6h4s.json");
    const RRI_29_TX_HASH: &str = "7UWLRNWxcnt49oa3zLCXEvxCQwMx7HWGWriB9fQo6h4s";
    const RRI_29_PAYLOAD_HASH: &str =
        "bfbc53c1a2fcef411a4e331d56839c7ea53c500aec82f054e51cecdd5ac76026";
    const RRI_29_MPC_KEY: &str = "ed25519:BU1rVeTnU4JkAcEdhQJxZocZ4455hU1JswYvUEoWE5wo";
    const DAO: &str = "rri.sputnik-dao.near";

    fn tx_status_fixture() -> Value {
        serde_json::from_str(TX_STATUS_FIXTURE).expect("fixture is valid JSON")
    }

    fn intent_payload(deadline: &str) -> Value {
        serde_json::json!({
            "nonce": "Vij2xgDhEPMXwNDX3RMC4BhgKLUOfM208JMzR1YMzn0=",
            "recipient": "intents.far",
            "message": serde_json::json!({
                "deadline": deadline,
                "intents": [{
                    "intent": "transfer",
                    "receiver_id": "4c0dbb3b7dc3508a899be836568b564ceefa414d1b135e93e3933d1ea19bcba1",
                    "tokens": {
                        "imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:nep141:wrap.near":
                            "429140000000000000000000000"
                    }
                }],
                "signer_id": DAO
            })
            .to_string(),
        })
    }

    async fn seed_executed_intent(pool: &PgPool, payload_hash: &str, deadline: &str) {
        sqlx::query(
            r#"
            INSERT INTO confidential_intents (
                dao_id, payload_hash, intent_payload, intent_type, status, proposal_id,
                proposal_executed_at, proposal_execution_transaction_hash
            )
            VALUES ($1, $2, $3, 'shield', 'pending', 29, NOW() - INTERVAL '2 minutes', $4)
            "#,
        )
        .bind(DAO)
        .bind(payload_hash)
        .bind(intent_payload(deadline))
        .bind(RRI_29_TX_HASH)
        .execute(pool)
        .await
        .expect("seed intent");
    }

    const DEPOSIT_ADDRESS: &str =
        "4c0dbb3b7dc3508a899be836568b564ceefa414d1b135e93e3933d1ea19bcba1";

    /// Give the seeded intent the quote facts the history linker matches on.
    async fn attach_quote(pool: &PgPool, payload_hash: &str) {
        sqlx::query(
            "UPDATE confidential_intents SET deposit_address = $2, quote_metadata = $3 WHERE payload_hash = $1",
        )
        .bind(payload_hash)
        .bind(DEPOSIT_ADDRESS)
        .bind(serde_json::json!({ "quoteRequest": { "recipient": "alice.near" } }))
        .execute(pool)
        .await
        .expect("attach quote");
    }

    /// A 1Click history row as the forward poll ingests it.
    async fn seed_history_row(pool: &PgPool, deposit_address: &str) -> i64 {
        sqlx::query_scalar(
            r#"
            INSERT INTO bronze_confidential_history_events (
                account_id, created_at_external, deposit_address, status, deposit_type,
                recipient, destination_asset, raw_payload
            )
            VALUES ($1, NOW(), $2, 'SUCCESS', 'ORIGIN_CHAIN', 'alice.near', 'nep141:wrap.near', '{}'::jsonb)
            RETURNING id
            "#,
        )
        .bind(DAO)
        .bind(deposit_address)
        .fetch_one(pool)
        .await
        .expect("seed history row")
    }

    #[derive(sqlx::FromRow)]
    struct IntentRow {
        status: String,
        submit_result: Option<Value>,
        submit_claimed_at: Option<DateTime<Utc>>,
        history_event_id: Option<i64>,
    }

    async fn load_intent(pool: &PgPool, payload_hash: &str) -> IntentRow {
        sqlx::query_as::<_, IntentRow>(
            "SELECT status, submit_result, submit_claimed_at, history_event_id FROM confidential_intents WHERE dao_id = $1 AND payload_hash = $2",
        )
        .bind(DAO)
        .bind(payload_hash)
        .fetch_one(pool)
        .await
        .expect("intent row")
    }

    /// NEAR JSON-RPC stub: serves the archival `EXPERIMENTAL_tx_status` fixture
    /// and v1.signer's `derived_public_key` view, echoing the request id.
    struct NearRpcStub;

    impl Respond for NearRpcStub {
        fn respond(&self, request: &Request) -> ResponseTemplate {
            let body: Value = serde_json::from_slice(&request.body).expect("json-rpc body");
            let id = body.get("id").cloned().unwrap_or(Value::Null);
            let result = match body.get("method").and_then(Value::as_str) {
                Some("EXPERIMENTAL_tx_status") => tx_status_fixture(),
                Some("query")
                    if body["params"]["method_name"].as_str() == Some("derived_public_key") =>
                {
                    let encoded = serde_json::to_vec(RRI_29_MPC_KEY).expect("encode key");
                    serde_json::json!({
                        "result": encoded,
                        "logs": [],
                        "block_height": 219269521,
                        "block_hash": "11111111111111111111111111111111"
                    })
                }
                other => panic!("unexpected RPC method {:?}: {}", other, body),
            };
            ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": result
            }))
        }
    }

    fn state_with_mocks(pool: PgPool, rpc: &MockServer, oneclick: &MockServer) -> AppState {
        let mut state = build_test_state(pool);
        let network = NetworkConfig {
            rpc_endpoints: vec![RPCEndpoint::new(rpc.uri().parse().expect("mock url"))],
            ..NetworkConfig::mainnet()
        };
        state.archival_network = network.clone();
        state.network = network;
        state.env_vars.confidential_api_url = oneclick.uri();
        state.env_vars.oneclick_api_url = oneclick.uri();
        state
    }

    #[test]
    fn signature_for_payload_follows_sign_receipt_to_mpc_callback() {
        let signature = signature_for_payload(&tx_status_fixture(), RRI_29_PAYLOAD_HASH)
            .expect("signature present in fixture");
        assert_eq!(signature.len(), 64);
        assert_eq!(&signature[..4], &[138, 143, 59, 239]);
    }

    #[test]
    fn signature_for_payload_ignores_other_payload_hashes() {
        let other = "0".repeat(64);
        assert!(signature_for_payload(&tx_status_fixture(), &other).is_none());
    }

    #[test]
    fn signature_for_payload_is_none_before_the_callback_lands() {
        let mut fixture = tx_status_fixture();
        let outcomes = fixture["receipts_outcome"]
            .as_array_mut()
            .expect("receipts_outcome");
        outcomes.retain(|entry| {
            entry["outcome"]["status"]
                .get("SuccessValue")
                .and_then(Value::as_str)
                .is_none_or(|value| !value.starts_with(MPC_SIGNATURE_MARKER))
        });
        assert!(signature_for_payload(&fixture, RRI_29_PAYLOAD_HASH).is_none());
    }

    #[test]
    fn intent_deadline_reads_the_nep413_message() {
        let deadline =
            intent_deadline(&intent_payload("2026-10-19T18:35:36.043Z")).expect("deadline parses");
        assert_eq!(deadline.to_rfc3339(), "2026-10-19T18:35:36.043+00:00");
        assert!(intent_deadline(&serde_json::json!({ "message": "not json" })).is_none());
    }

    #[sqlx::test]
    async fn claim_is_exclusive_until_stale(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        let submitter = ConfidentialIntentSubmitter::new(&state);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2099-01-01T00:00:00Z").await;

        let first = submitter
            .claim(DAO, RRI_29_PAYLOAD_HASH)
            .await
            .expect("claim query");
        assert_eq!(
            first.expect("first claim wins").intent_type,
            "shield",
            "first claim returns the row"
        );
        let second = submitter
            .claim(DAO, RRI_29_PAYLOAD_HASH)
            .await
            .expect("claim query");
        assert!(
            second.is_none(),
            "second claim inside the window is refused"
        );

        sqlx::query(
            "UPDATE confidential_intents SET submit_claimed_at = NOW() - INTERVAL '11 minutes' WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .execute(&pool)
        .await
        .expect("age claim");
        let stale = submitter
            .claim(DAO, RRI_29_PAYLOAD_HASH)
            .await
            .expect("claim query");
        assert!(stale.is_some(), "stale claim is reclaimable");

        sqlx::query(
            "UPDATE confidential_intents SET submit_result = '{\"intentHash\":\"x\"}'::jsonb WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .execute(&pool)
        .await
        .expect("mark submitted");
        submitter.release_claim(DAO, RRI_29_PAYLOAD_HASH).await;
        let done = submitter
            .claim(DAO, RRI_29_PAYLOAD_HASH)
            .await
            .expect("claim query");
        assert!(done.is_none(), "a submitted row is never claimed again");
    }

    #[sqlx::test]
    async fn resubmit_marks_expired_intents_failed_without_touching_1click(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;

        let submitted = ConfidentialIntentSubmitter::new(&state)
            .resubmit_awaiting_intents(DAO)
            .await;
        assert_eq!(submitted, 0);

        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "failed");
        let error = row.submit_result.expect("expiry recorded")["error"]
            .as_str()
            .expect("error string")
            .to_string();
        assert!(error.contains("deadline passed"), "got {error}");
        assert!(
            rpc.received_requests().await.expect("rpc log").is_empty(),
            "expired rows are retired without an RPC call"
        );
    }

    #[sqlx::test]
    async fn resubmit_submits_the_signature_found_on_chain_exactly_once(pool: PgPool) {
        let rpc = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(NearRpcStub)
            .mount(&rpc)
            .await;
        let oneclick = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v0/submit-intent"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "intentHash": "mock-intent-hash",
                "correlationId": "mock-correlation"
            })))
            .expect(1)
            .mount(&oneclick)
            .await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2099-01-01T00:00:00Z").await;

        let submitter = ConfidentialIntentSubmitter::new(&state);
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 1);

        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "submitted");
        assert_eq!(
            row.submit_result.expect("1Click response stored")["intentHash"],
            "mock-intent-hash"
        );
        assert!(row.submit_claimed_at.is_some());

        // A second pass finds nothing to do and never re-posts (wiremock
        // enforces `expect(1)` on drop).
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
    }

    /// The 1Click answer was lost after 1Click accepted the intent: the poll
    /// ingested its history row, so the expired row is reconciled as
    /// submitted rather than failed, and nothing is re-posted.
    #[sqlx::test]
    async fn resubmit_recovers_an_intent_already_in_1click_history(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;
        // A transport failure left the claim behind, long enough ago to be stale.
        sqlx::query(
            "UPDATE confidential_intents SET submit_claimed_at = NOW() - INTERVAL '11 minutes' WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .execute(&pool)
        .await
        .expect("age claim");
        let history_event_id = seed_history_row(&pool, DEPOSIT_ADDRESS).await;

        let submitter = ConfidentialIntentSubmitter::new(&state);
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 1);

        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "submitted");
        assert_eq!(row.history_event_id, Some(history_event_id));
        let submit_result = row.submit_result.expect("synthetic submit_result");
        assert_eq!(submit_result["recoveredFromHistory"], true);
        assert_eq!(submit_result["historyEventId"], history_event_id);
        assert!(
            rpc.received_requests().await.expect("rpc log").is_empty(),
            "recovery needs no RPC"
        );
        assert!(
            oneclick
                .received_requests()
                .await
                .expect("1click log")
                .is_empty(),
            "recovery never re-posts to 1Click"
        );

        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
        assert_eq!(
            load_intent(&pool, RRI_29_PAYLOAD_HASH).await.status,
            "submitted"
        );
    }

    /// A legacy row: the old detector promoted it to `submitted` without a
    /// 1Click response and the ingest-time linker already attached its
    /// history row. The existing link is the proof; the row is backfilled, not
    /// expired.
    #[sqlx::test]
    async fn resubmit_backfills_an_already_linked_intent_instead_of_expiring_it(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;
        let history_event_id = seed_history_row(&pool, DEPOSIT_ADDRESS).await;
        sqlx::query(
            "UPDATE confidential_intents SET status = 'submitted', history_event_id = $2 WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .bind(history_event_id)
        .execute(&pool)
        .await
        .expect("link legacy row");

        let submitter = ConfidentialIntentSubmitter::new(&state);
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 1);

        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "submitted");
        assert_eq!(row.history_event_id, Some(history_event_id));
        let submit_result = row.submit_result.expect("synthetic submit_result");
        assert_eq!(submit_result["recoveredFromHistory"], true);
        assert_eq!(submit_result["historyEventId"], history_event_id);
        assert!(
            oneclick
                .received_requests()
                .await
                .expect("1click log")
                .is_empty()
        );
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
    }

    /// Expiry alone must also respect an existing link.
    #[sqlx::test]
    async fn expiry_yields_to_an_existing_history_link(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        let history_event_id = seed_history_row(&pool, DEPOSIT_ADDRESS).await;
        sqlx::query(
            "UPDATE confidential_intents SET status = 'submitted', history_event_id = $2 WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .bind(history_event_id)
        .execute(&pool)
        .await
        .expect("link row");

        ConfidentialIntentSubmitter::new(&state)
            .mark_expired(DAO, RRI_29_PAYLOAD_HASH)
            .await;
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "submitted");
        assert!(row.submit_result.is_none());
    }

    /// When the reconciliation lookup itself fails, nothing is known about
    /// the intent, so it is neither expired nor re-posted this round.
    #[sqlx::test]
    async fn resubmit_defers_expiry_when_reconciliation_fails(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        sqlx::query("DROP TABLE bronze_confidential_history_events CASCADE")
            .execute(&pool)
            .await
            .expect("break the history lookup");

        assert_eq!(
            ConfidentialIntentSubmitter::new(&state)
                .resubmit_awaiting_intents(DAO)
                .await,
            0
        );
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "pending", "expiry deferred");
        assert!(row.submit_result.is_none());
        assert!(
            rpc.received_requests().await.expect("rpc log").is_empty(),
            "nothing is re-posted either"
        );
    }

    /// An unrelated history row (different deposit address) proves nothing:
    /// the expired intent is still retired.
    #[sqlx::test]
    async fn resubmit_does_not_recover_from_an_unrelated_history_row(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;
        seed_history_row(&pool, "some-other-deposit-address").await;

        assert_eq!(
            ConfidentialIntentSubmitter::new(&state)
                .resubmit_awaiting_intents(DAO)
                .await,
            0
        );
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "failed");
        assert!(row.history_event_id.is_none());
    }

    /// Expiry runs without the claim, so it must yield to a submission that
    /// completed (stored response) or is in flight (live claim) meanwhile.
    #[sqlx::test]
    async fn expiry_yields_to_a_concurrent_submission(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        let submitter = ConfidentialIntentSubmitter::new(&state);

        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        sqlx::query(
            "UPDATE confidential_intents SET status = 'submitted', submit_result = '{\"intentHash\":\"x\"}'::jsonb WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .execute(&pool)
        .await
        .expect("mark submitted");
        submitter.mark_expired(DAO, RRI_29_PAYLOAD_HASH).await;
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "submitted");
        assert_eq!(row.submit_result.expect("response kept")["intentHash"], "x");

        let in_flight = format!("{}00", &RRI_29_PAYLOAD_HASH[2..]);
        seed_executed_intent(&pool, &in_flight, "2020-01-01T00:00:00Z").await;
        submitter
            .claim(DAO, &in_flight)
            .await
            .expect("claim query")
            .expect("claim taken");
        submitter.mark_expired(DAO, &in_flight).await;
        let row = load_intent(&pool, &in_flight).await;
        assert_eq!(row.status, "pending", "a live claim blocks expiry");
        assert!(row.submit_result.is_none());
    }
}

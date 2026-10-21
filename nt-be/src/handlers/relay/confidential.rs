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
        bronze::{
            fetch_history, mark_confidential_history_activity_due, store::upsert_history_events,
        },
        gold::history_events::refresh_gold_metadata_for_intent,
        link_intent_to_history_event,
        proposal_signals::extract_sign_call_from_logs,
        recover_unsubmitted_intent_from_history,
        types::normalize_quote_metadata_accounts,
    },
    handlers::relay::{effects::background, parse::ProposalKind},
    observability::sanitize_sensitive_json_value,
    services::{CredentialScope, TokenBundle},
    utils::{cache::CacheKey, jsonrpc::create_rpc_client, transport::with_transport_retry},
};
use base64::Engine;
use chrono::{DateTime, Utc};
use near_account_id::AccountIdRef;
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
            submit_state = 'idle',
            submit_next_attempt_at = NULL,
            submit_attempts = 0,
            submit_last_error = NULL,
            submit_lease_token = NULL,
            submit_lease_until = NULL,
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

/// Why 1Click did not accept a signed intent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OneclickSubmitError {
    /// 1Click never took the request (connection refused, 429, 503): the
    /// same signed payload is safe to post again.
    Transient(String),
    /// The answer never arrived or the server failed mid-request (timeout,
    /// 408, 500, 502, 504): 1Click may have accepted it, so the outcome has
    /// to be reconciled before anything is re-posted.
    Transport(String),
    /// 1Click refused the intent itself (other 4xx): final for this signature.
    Rejected(String),
}

impl OneclickSubmitError {
    fn from_status(status: reqwest::StatusCode, message: String) -> Self {
        use reqwest::StatusCode;
        match status {
            StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE => {
                Self::Transient(message)
            }
            StatusCode::REQUEST_TIMEOUT => Self::Transport(message),
            status if status.is_server_error() => Self::Transport(message),
            _ => Self::Rejected(message),
        }
    }

    fn from_request_error(path: &str, error: reqwest::Error) -> Self {
        let message = format!("1click {}: {}", path, error);
        if error.is_connect() {
            Self::Transient(message)
        } else {
            Self::Transport(message)
        }
    }
}

impl fmt::Display for OneclickSubmitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transient(message) | Self::Transport(message) | Self::Rejected(message) => {
                f.write_str(message)
            }
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
        .map_err(|e| OneclickSubmitError::from_request_error(path, e))?;
    let status = response.status();
    let resp_body: Value = response.json().await.unwrap_or_default();
    if !status.is_success() {
        let sanitized_body = sanitize_sensitive_json_value(&resp_body);
        return Err(OneclickSubmitError::from_status(
            status,
            format!("1click {} {}: {:?}", path, status, sanitized_body),
        ));
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

    let outcome = ConfidentialIntentSubmitter::new(state)
        .submit_signed(treasury_id, payload_hash, &sig_bytes)
        .await;
    if outcome.needs_poll()
        && let Err(e) = mark_confidential_history_activity_due(&state.db_pool, treasury_id).await
    {
        tracing::warn!(
            "failed to pull the 1Click poll forward for {} (hash={}): {}",
            treasury_id,
            payload_hash,
            e
        );
    }
}

/// How one attempt to hand a signed intent to 1Click ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IntentSubmitOutcome {
    /// 1Click accepted it; `submit_result` holds the response.
    Submitted,
    /// 1Click rejected it; the row is `failed` with the error in `submit_result`.
    Rejected(String),
    /// Failed before anything reached 1Click (RPC, key fetch, DB). The row
    /// is back to `due`; the poll retries after a short backoff.
    Deferred(String),
    /// The request may have reached 1Click but no answer came back. The row
    /// is `unknown`: the poll reconciles it against 1Click history before it
    /// re-posts or retires it.
    Unknown(String),
    /// The execution transaction does not carry the MPC callback receipt yet.
    NotSignedYet,
    /// Already submitted, failed, or leased by another path.
    AlreadyHandled,
}

impl IntentSubmitOutcome {
    /// The per-DAO poll still has to look at this intent.
    pub fn needs_poll(&self) -> bool {
        matches!(
            self,
            Self::Deferred(_) | Self::Unknown(_) | Self::NotSignedYet
        )
    }
}

/// `confidential_intents.submit_state`: where a row is in the submission
/// work queue. Terminal states are `done` and `failed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmitState {
    Idle,
    Due,
    InFlight,
    Unknown,
    Done,
    Failed,
}

impl SubmitState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Due => "due",
            Self::InFlight => "in_flight",
            Self::Unknown => "unknown",
            Self::Done => "done",
            Self::Failed => "failed",
        }
    }
}

/// A leased intent: until `submit_lease_until` only this holder may write
/// its outcome, and every write carries the token.
#[derive(Debug, sqlx::FromRow)]
struct SubmitLease {
    token: String,
    intent_payload: Value,
    intent_type: String,
    submit_attempts: i32,
}

impl SubmitLease {
    /// Delay before the next attempt: 30 s, 1 m, 2 m, 4 m, then 5 m.
    fn backoff(&self) -> chrono::Duration {
        submit_backoff(self.submit_attempts)
    }
}

fn submit_backoff(attempts: i32) -> chrono::Duration {
    let exponent = attempts.saturating_sub(1).clamp(0, 8);
    let secs = (SUBMIT_BACKOFF_BASE_SECS << exponent).min(SUBMIT_BACKOFF_CAP_SECS);
    chrono::Duration::seconds(secs)
}

/// Whether the DAO's ingested 1Click history vouches for an unsubmitted intent.
#[derive(Debug, Clone, PartialEq, Eq)]
enum HistoryReconciliation {
    /// 1Click has it; the row is now `submitted` / `done`.
    Recovered,
    /// No matching history row: safe to re-post or expire.
    NotInHistory,
    /// The lookup itself failed; nothing is known, so leave the row alone.
    Unknown(String),
}

/// What 1Click itself says about one deposit address.
#[derive(Debug, Clone, PartialEq, Eq)]
enum OneclickLookup {
    /// 1Click has a history row for it; the row is now in Bronze.
    /// `deposit_seen` is false when every row is still `PENDING_DEPOSIT`: the
    /// quote exists but nothing ever reached its deposit address, which is
    /// what a never-submitted intent looks like from 1Click.
    Found { deposit_seen: bool },
    /// 1Click has nothing for it: the intent was never accepted.
    NotFound,
    /// The intent carries no deposit address, so there is nothing to ask and
    /// nothing can ever prove non-acceptance.
    NoDepositAddress,
    /// The lookup or its ingest failed; nothing is known.
    Failed(String),
}

/// Executed on chain and still owed to 1Click: what the per-DAO poll works on.
#[derive(Debug, sqlx::FromRow)]
struct AwaitingSubmitIntent {
    payload_hash: String,
    intent_payload: Value,
    proposal_execution_transaction_hash: String,
    submit_state: String,
    deposit_address: Option<String>,
}

impl AwaitingSubmitIntent {
    /// NEP-413 message deadline. Past it the intents contract rejects the
    /// signature, so there is nothing left to submit.
    fn intent_deadline(&self) -> Option<DateTime<Utc>> {
        intent_deadline(&self.intent_payload)
    }

    /// A previous attempt may have reached 1Click (`unknown`, or a lease
    /// that expired mid-attempt), as opposed to a row never posted (`due`).
    fn outcome_uncertain(&self) -> bool {
        self.submit_state != SubmitState::Due.as_str()
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

/// Intent types the per-DAO poll submits from chain. The bulk flavours have
/// their own processor.
pub const POLL_SUBMITTED_INTENT_TYPES: &[&str] = &["shield"];
/// Rows worked per poll of one DAO.
const AWAITING_SUBMIT_BATCH: i64 = 20;
/// How long one attempt may own a row: one 1Click POST (30 s timeout) plus
/// the RPC lookups. A holder that outlives it is treated as crashed.
const SUBMIT_LEASE_SECS: i64 = 120;
const SUBMIT_BACKOFF_BASE_SECS: i64 = 30;
const SUBMIT_BACKOFF_CAP_SECS: i64 = 300;
const CONFIDENTIAL_TX_STATUS_LABEL: &str = "confidential_intent_tx_status";

/// Hands a signed confidential intent to 1Click exactly once, from whichever
/// path sees the MPC signature first: the vote relay (signature in the relay
/// outcome), or the per-DAO 1Click poll (signature read from the execution
/// transaction). An expiring lease on the row serialises them; the poll owns
/// every retry.
pub struct ConfidentialIntentSubmitter<'a> {
    state: &'a AppState,
}

impl<'a> ConfidentialIntentSubmitter<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    /// Submit with a signature already in hand (vote relay).
    pub async fn submit_signed(
        &self,
        dao_id: &str,
        payload_hash: &str,
        signature: &[u8],
    ) -> IntentSubmitOutcome {
        let lease = match self.lease(dao_id, payload_hash).await {
            Ok(Some(lease)) => lease,
            Ok(None) => {
                tracing::info!(
                    "MPC signature found but intent {}/{} is already handled or leased",
                    dao_id,
                    payload_hash
                );
                return IntentSubmitOutcome::AlreadyHandled;
            }
            Err(e) => {
                tracing::error!(
                    "DB error leasing intent for {} (hash={}): {}",
                    dao_id,
                    payload_hash,
                    e
                );
                return IntentSubmitOutcome::Deferred(e.to_string());
            }
        };
        self.submit_leased(dao_id, payload_hash, &lease, signature)
            .await
    }

    async fn submit_leased(
        &self,
        dao_id: &str,
        payload_hash: &str,
        lease: &SubmitLease,
        signature: &[u8],
    ) -> IntentSubmitOutcome {
        let intent_type = lease.intent_type.as_str();

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
                let error = format!("mpc public key: {:?}", e);
                self.release(dao_id, payload_hash, lease, SubmitState::Due, &error)
                    .await;
                return IntentSubmitOutcome::Deferred(error);
            }
        };

        tracing::info!(
            "Auto-submitting {} for {} (hash={}, mpc_key={}, attempt={})",
            intent_type,
            dao_id,
            payload_hash,
            mpc_public_key,
            lease.submit_attempts
        );

        let kind = if intent_type == "auth" || intent_type == "bulk_auth" {
            IntentSubmitKind::Auth
        } else {
            IntentSubmitKind::Shield
        };
        let submitted = submit_intent_to_oneclick(
            self.state,
            kind,
            &lease.intent_payload,
            &mpc_public_key,
            signature,
        )
        .await;
        let resp_body = match submitted {
            Ok(resp_body) => resp_body,
            Err(OneclickSubmitError::Transient(err)) => {
                tracing::warn!(
                    "1Click did not take {} for {} (hash={}); re-posting after backoff: {}",
                    intent_type,
                    dao_id,
                    payload_hash,
                    err
                );
                self.release(dao_id, payload_hash, lease, SubmitState::Due, &err)
                    .await;
                return IntentSubmitOutcome::Deferred(err);
            }
            Err(OneclickSubmitError::Transport(err)) => {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfIntentSubmitFailed,
                    dao_id,
                    payload_hash,
                    intent_type,
                    error = %err
                );
                // The request may have reached 1Click: the poll reconciles
                // the row against 1Click history before re-posting it.
                self.release(dao_id, payload_hash, lease, SubmitState::Unknown, &err)
                    .await;
                return IntentSubmitOutcome::Unknown(err);
            }
            Err(OneclickSubmitError::Rejected(err)) => {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfIntentSubmitFailed,
                    dao_id,
                    payload_hash,
                    intent_type,
                    error = %err
                );
                self.finish_failed(dao_id, payload_hash, lease, &err).await;
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
                self.finish_failed(dao_id, payload_hash, lease, &error)
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
                self.finish_failed(dao_id, payload_hash, lease, &error)
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

        if !self
            .finish_submitted(dao_id, payload_hash, lease, &sanitized_resp_body)
            .await
        {
            // The lease expired mid-attempt and another holder owns the row;
            // it re-posts (1Click dedupes by payload hash) or reconciles.
            return IntentSubmitOutcome::Submitted;
        }

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
        IntentSubmitOutcome::Submitted
    }

    /// Read the MPC signature from the execution transaction, then submit.
    /// `sender_hint` only routes the RPC lookup; the DAO id is accepted.
    async fn submit_from_chain(
        &self,
        dao_id: &str,
        payload_hash: &str,
        execution_tx_hash: &str,
        sender_hint: &str,
        lease: &SubmitLease,
    ) -> IntentSubmitOutcome {
        let signature = match self
            .signature_from_chain(dao_id, payload_hash, execution_tx_hash, sender_hint)
            .await
        {
            Ok(SignatureLookup::Found(signature)) => signature,
            Ok(SignatureLookup::CallbackPending) => {
                self.release(
                    dao_id,
                    payload_hash,
                    lease,
                    SubmitState::Due,
                    "MPC callback not on chain yet",
                )
                .await;
                return IntentSubmitOutcome::NotSignedYet;
            }
            Ok(SignatureLookup::NotInTransaction) => {
                // The stamped execution transaction does not vote on this
                // payload: a detector mismatch, not a timing issue. Bounded
                // by the intent deadline.
                let error = format!(
                    "execution tx {} carries no sign call for this payload",
                    execution_tx_hash
                );
                tracing::error!("{}/{}: {}", dao_id, payload_hash, error);
                self.release(dao_id, payload_hash, lease, SubmitState::Due, &error)
                    .await;
                return IntentSubmitOutcome::Deferred(error);
            }
            Ok(SignatureLookup::Failed(error)) => {
                crate::error_event!(
                    crate::error_event::ErrorCode::ConfIntentSigParseFailed,
                    dao_id,
                    payload_hash,
                    error = %error
                );
                self.finish_failed(dao_id, payload_hash, lease, &error)
                    .await;
                return IntentSubmitOutcome::Rejected(error);
            }
            Err(error) => {
                self.release(dao_id, payload_hash, lease, SubmitState::Due, &error)
                    .await;
                return IntentSubmitOutcome::Deferred(error);
            }
        };
        self.submit_leased(dao_id, payload_hash, lease, &signature)
            .await
    }

    async fn signature_from_chain(
        &self,
        dao_id: &str,
        payload_hash: &str,
        execution_tx_hash: &str,
        sender_hint: &str,
    ) -> Result<SignatureLookup, String> {
        let tx_hash = execution_tx_hash
            .parse::<CryptoHash>()
            .map_err(|e| format!("invalid execution tx hash {}: {}", execution_tx_hash, e))?;
        let sender_account_id = sender_hint
            .parse::<RpcAccountId>()
            .map_err(|e| format!("invalid sender {}: {}", sender_hint, e))?;
        let client = create_rpc_client(&self.state.archival_network).map_err(|e| e.to_string())?;

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
        .await
        .map_err(|e| {
            tracing::warn!(
                "tx_status {} for {} (hash={}) failed: {}",
                execution_tx_hash,
                dao_id,
                payload_hash,
                e
            );
            e.to_string()
        })?;
        let raw_response = serde_json::to_value(&response).map_err(|e| e.to_string())?;
        Ok(signature_for_payload(&raw_response, payload_hash))
    }

    /// Work this DAO's submission queue: rows that are `due`, `unknown`, or
    /// `in_flight` under an expired lease. Each row is leased and reconciled
    /// against the DAO's ingested 1Click history (the poll fetches the latest
    /// page just before this runs). Before a row is retired, or re-posted
    /// when its last attempt may have reached 1Click, 1Click is asked
    /// directly for its deposit address: the latest-page poll can miss a row
    /// after an ingestion gap, and a finished backfill does not cover that.
    /// Returns how many ended up submitted. Called from the per-DAO 1Click
    /// history poll.
    pub async fn resubmit_awaiting_intents(&self, dao_id: &str) -> usize {
        let rows = sqlx::query_as::<_, AwaitingSubmitIntent>(
            r#"
            SELECT payload_hash, intent_payload, proposal_execution_transaction_hash,
                   submit_state,
                   COALESCE(deposit_address, quote_metadata->'quote'->>'depositAddress')
                       AS deposit_address
            FROM confidential_intents
            WHERE dao_id = $1
              AND intent_type = ANY($2)
              AND proposal_execution_transaction_hash IS NOT NULL
              AND (
                  (submit_state IN ('due', 'unknown') AND submit_next_attempt_at <= NOW())
                  OR (submit_state = 'in_flight' AND submit_lease_until < NOW())
              )
            ORDER BY submit_next_attempt_at NULLS FIRST, id
            LIMIT $3
            "#,
        )
        .bind(dao_id)
        .bind(POLL_SUBMITTED_INTENT_TYPES)
        .bind(AWAITING_SUBMIT_BATCH)
        .fetch_all(&self.state.db_pool)
        .await;
        let rows = match rows {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!("submission queue lookup failed for {}: {}", dao_id, e);
                return 0;
            }
        };
        let now = Utc::now();
        let mut submitted = 0;
        for row in rows {
            let lease = match self.lease(dao_id, &row.payload_hash).await {
                Ok(Some(lease)) => lease,
                Ok(None) => continue,
                Err(e) => {
                    tracing::warn!(
                        "DB error leasing intent for {} (hash={}): {}",
                        dao_id,
                        row.payload_hash,
                        e
                    );
                    continue;
                }
            };
            match self
                .recover_from_history(dao_id, &row.payload_hash, &lease)
                .await
            {
                HistoryReconciliation::Recovered => {
                    submitted += 1;
                    continue;
                }
                HistoryReconciliation::NotInHistory => {}
                // Unknown whether 1Click has it: neither expire nor re-post
                // this round; the next poll retries.
                HistoryReconciliation::Unknown(error) => {
                    self.release(
                        dao_id,
                        &row.payload_hash,
                        &lease,
                        SubmitState::Unknown,
                        &error,
                    )
                    .await;
                    continue;
                }
            }
            let expired = row.intent_deadline().is_some_and(|deadline| deadline < now);
            if expired || row.outcome_uncertain() {
                match self
                    .lookup_in_1click(dao_id, row.deposit_address.as_deref())
                    .await
                {
                    OneclickLookup::Found { deposit_seen } => {
                        match self
                            .recover_from_history(dao_id, &row.payload_hash, &lease)
                            .await
                        {
                            HistoryReconciliation::Recovered => submitted += 1,
                            // 1Click only knows the quote: nothing ever reached
                            // its deposit address, and past the deadline nothing
                            // can. The intent was never submitted.
                            HistoryReconciliation::NotInHistory if expired && !deposit_seen => {
                                self.mark_expired(dao_id, &row.payload_hash, &lease).await;
                            }
                            HistoryReconciliation::NotInHistory => {
                                self.release(
                                    dao_id,
                                    &row.payload_hash,
                                    &lease,
                                    SubmitState::Unknown,
                                    "1Click has a history row for the deposit address but no single row links to this intent",
                                )
                                .await;
                            }
                            HistoryReconciliation::Unknown(error) => {
                                self.release(
                                    dao_id,
                                    &row.payload_hash,
                                    &lease,
                                    SubmitState::Unknown,
                                    &error,
                                )
                                .await;
                            }
                        }
                        continue;
                    }
                    OneclickLookup::NotFound => {}
                    OneclickLookup::Failed(error) => {
                        self.release(
                            dao_id,
                            &row.payload_hash,
                            &lease,
                            SubmitState::Unknown,
                            &error,
                        )
                        .await;
                        continue;
                    }
                    OneclickLookup::NoDepositAddress => {
                        // Nothing to ask 1Click about, so an uncertain
                        // outcome stays unresolved rather than being retired
                        // on the strength of a missing local row.
                        self.release(
                            dao_id,
                            &row.payload_hash,
                            &lease,
                            SubmitState::Unknown,
                            "no deposit address to verify with 1Click; outcome left unresolved",
                        )
                        .await;
                        continue;
                    }
                }
            }
            if expired {
                self.mark_expired(dao_id, &row.payload_hash, &lease).await;
                continue;
            }
            let outcome = self
                .submit_from_chain(
                    dao_id,
                    &row.payload_hash,
                    &row.proposal_execution_transaction_hash,
                    dao_id,
                    &lease,
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

    /// Take the row for one attempt. Refused while another holder's lease is
    /// live or once the row is terminal. Counts the attempt.
    async fn lease(
        &self,
        dao_id: &str,
        payload_hash: &str,
    ) -> Result<Option<SubmitLease>, sqlx::Error> {
        let token = uuid::Uuid::new_v4().to_string();
        let lease_until = Utc::now() + chrono::Duration::seconds(SUBMIT_LEASE_SECS);
        sqlx::query_as::<_, SubmitLease>(
            r#"
            UPDATE confidential_intents
            SET submit_state = 'in_flight',
                submit_lease_token = $3,
                submit_lease_until = $4,
                submit_attempts = submit_attempts + 1,
                updated_at = NOW()
            WHERE dao_id = $1
              AND payload_hash = $2
              AND submit_result IS NULL
              AND status IN ('pending', 'submitted')
              AND (
                  submit_state IN ('idle', 'due', 'unknown')
                  OR (submit_state = 'in_flight' AND submit_lease_until < NOW())
              )
            RETURNING submit_lease_token AS token, intent_payload, intent_type, submit_attempts
            "#,
        )
        .bind(dao_id)
        .bind(payload_hash)
        .bind(&token)
        .bind(lease_until)
        .fetch_optional(&self.state.db_pool)
        .await
    }

    /// Hand the row back to the queue in `state` with the attempt's error and
    /// the next attempt time set by the backoff.
    async fn release(
        &self,
        dao_id: &str,
        payload_hash: &str,
        lease: &SubmitLease,
        state: SubmitState,
        last_error: &str,
    ) {
        debug_assert!(matches!(state, SubmitState::Due | SubmitState::Unknown));
        let next_attempt_at = Utc::now() + lease.backoff();
        if let Err(e) = sqlx::query(
            r#"
            UPDATE confidential_intents
            SET submit_state = $4,
                submit_next_attempt_at = $5,
                submit_last_error = $6,
                submit_lease_token = NULL,
                submit_lease_until = NULL,
                updated_at = NOW()
            WHERE dao_id = $1
              AND payload_hash = $2
              AND submit_lease_token = $3
            "#,
        )
        .bind(dao_id)
        .bind(payload_hash)
        .bind(&lease.token)
        .bind(state.as_str())
        .bind(next_attempt_at)
        .bind(last_error)
        .execute(&self.state.db_pool)
        .await
        {
            tracing::warn!(
                "failed to release submit lease for {} (hash={}): {}",
                dao_id,
                payload_hash,
                e
            );
        }
    }

    /// Record 1Click's acceptance. `false` when the lease was lost meanwhile.
    async fn finish_submitted(
        &self,
        dao_id: &str,
        payload_hash: &str,
        lease: &SubmitLease,
        submit_result: &Value,
    ) -> bool {
        let updated = sqlx::query(
            r#"
            UPDATE confidential_intents
            SET status = 'submitted',
                submit_result = $4,
                submit_state = 'done',
                submit_next_attempt_at = NULL,
                submit_last_error = NULL,
                submit_lease_token = NULL,
                submit_lease_until = NULL,
                updated_at = NOW()
            WHERE dao_id = $1
              AND payload_hash = $2
              AND submit_lease_token = $3
            "#,
        )
        .bind(dao_id)
        .bind(payload_hash)
        .bind(&lease.token)
        .bind(submit_result)
        .execute(&self.state.db_pool)
        .await;
        match updated {
            Ok(result) if result.rows_affected() == 1 => true,
            Ok(_) => {
                tracing::error!(
                    "1Click accepted {}/{} but the submit lease was lost; response not recorded",
                    dao_id,
                    payload_hash
                );
                false
            }
            Err(e) => {
                tracing::error!(
                    "failed to record 1Click acceptance for {} (hash={}): {}",
                    dao_id,
                    payload_hash,
                    e
                );
                false
            }
        }
    }

    /// Record a final failure for this signature. Never overwrites a stored
    /// 1Click response.
    async fn finish_failed(
        &self,
        dao_id: &str,
        payload_hash: &str,
        lease: &SubmitLease,
        error: &str,
    ) {
        if let Err(db_err) = sqlx::query(
            r#"
            UPDATE confidential_intents
            SET status = 'failed',
                submit_result = $4,
                submit_state = 'failed',
                submit_next_attempt_at = NULL,
                submit_last_error = $5,
                submit_lease_token = NULL,
                submit_lease_until = NULL,
                updated_at = NOW()
            WHERE dao_id = $1
              AND payload_hash = $2
              AND submit_lease_token = $3
              AND submit_result IS NULL
            "#,
        )
        .bind(dao_id)
        .bind(payload_hash)
        .bind(&lease.token)
        .bind(serde_json::json!({ "error": error }))
        .bind(error)
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

    /// Promote the row when the DAO's 1Click history already carries it (the
    /// submit answer was lost after 1Click accepted it).
    async fn recover_from_history(
        &self,
        dao_id: &str,
        payload_hash: &str,
        lease: &SubmitLease,
    ) -> HistoryReconciliation {
        match recover_unsubmitted_intent_from_history(
            &self.state.db_pool,
            dao_id,
            payload_hash,
            &lease.token,
        )
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
                HistoryReconciliation::Unknown(format!("history reconciliation failed: {}", e))
            }
        }
    }

    /// Retire an executed intent whose deadline passed and whose deposit
    /// address 1Click never saw funds on. A link to a history row that did
    /// see a deposit (appeared meanwhile, or the legacy link the queue was
    /// reopened with) wins.
    async fn mark_expired(&self, dao_id: &str, payload_hash: &str, lease: &SubmitLease) {
        const ERROR: &str = "intent deadline passed before submission to 1Click";
        let updated = sqlx::query(
            r#"
            UPDATE confidential_intents
            SET status = 'failed',
                submit_result = $4,
                submit_state = 'failed',
                submit_next_attempt_at = NULL,
                submit_last_error = $5,
                submit_lease_token = NULL,
                submit_lease_until = NULL,
                updated_at = NOW()
            WHERE dao_id = $1
              AND payload_hash = $2
              AND submit_lease_token = $3
              AND submit_result IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM bronze_confidential_history_events he
                  WHERE he.id = confidential_intents.history_event_id
                    AND UPPER(he.status) <> 'PENDING_DEPOSIT'
              )
            "#,
        )
        .bind(dao_id)
        .bind(payload_hash)
        .bind(&lease.token)
        .bind(serde_json::json!({ "error": ERROR }))
        .bind(ERROR)
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
            Ok(_) => {
                tracing::info!(
                    "expiry of {}/{} skipped: linked or submitted concurrently",
                    dao_id,
                    payload_hash
                );
                self.release(dao_id, payload_hash, lease, SubmitState::Unknown, ERROR)
                    .await;
            }
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

    /// Ask 1Click for the history row of one deposit address and ingest it,
    /// so the standard linker can attach it.
    async fn lookup_in_1click(
        &self,
        dao_id: &str,
        deposit_address: Option<&str>,
    ) -> OneclickLookup {
        let Some(deposit_address) = deposit_address else {
            return OneclickLookup::NoDepositAddress;
        };
        let account = match AccountIdRef::new(dao_id) {
            Ok(account) => account,
            Err(e) => return OneclickLookup::Failed(format!("invalid dao id {}: {}", dao_id, e)),
        };
        let page =
            match fetch_history(self.state, account, 1, None, None, Some(deposit_address)).await {
                Ok(page) => page,
                Err((status, message)) => {
                    return OneclickLookup::Failed(format!(
                        "1Click history lookup for {} failed ({}): {}",
                        deposit_address, status, message
                    ));
                }
            };
        if page.items.is_empty() {
            return OneclickLookup::NotFound;
        }
        let deposit_seen = page.items.iter().any(|event| {
            !event
                .item
                .status
                .trim()
                .eq_ignore_ascii_case("PENDING_DEPOSIT")
        });
        match upsert_history_events(&self.state.db_pool, dao_id, &page.items).await {
            Ok(_) => OneclickLookup::Found { deposit_seen },
            Err(e) => OneclickLookup::Failed(format!(
                "ingest of the 1Click history lookup for {} failed: {}",
                deposit_address, e
            )),
        }
    }
}

/// Signature for `payload_hash` from an `EXPERIMENTAL_tx_status` response:
/// the `v1.signer` receipt whose `sign:` log names the hash points (via
/// `SuccessReceiptId`) at the MPC callback receipt whose `SuccessValue` is
/// the signature. A transaction can carry several votes, so the hash is
/// matched explicitly instead of taking the first signature in the outcome.
/// What an execution transaction says about the MPC signature for one payload.
#[derive(Debug, Clone, PartialEq, Eq)]
enum SignatureLookup {
    Found(Vec<u8>),
    /// The `v1.signer` call succeeded but its callback receipt is not in the
    /// transaction yet: ask again later.
    CallbackPending,
    /// The transaction carries no `sign:` call for this payload at all.
    NotInTransaction,
    /// Signing failed on chain, or the callback carries nothing usable: no
    /// retry will ever produce a signature for this payload.
    Failed(String),
}

fn signature_for_payload(tx_status: &Value, payload_hash: &str) -> SignatureLookup {
    let Some(outcomes) = tx_status.get("receipts_outcome").and_then(Value::as_array) else {
        return SignatureLookup::NotInTransaction;
    };
    let Some(sign_receipt) = outcomes
        .iter()
        .find(|entry| outcome_signs_payload(entry, payload_hash))
    else {
        return SignatureLookup::NotInTransaction;
    };
    let sign_status = sign_receipt.get("outcome").and_then(|o| o.get("status"));
    let Some(callback_id) = sign_status
        .and_then(|s| s.get("SuccessReceiptId"))
        .and_then(Value::as_str)
    else {
        return SignatureLookup::Failed(format!(
            "v1.signer sign call did not succeed: {}",
            sign_status.map(Value::to_string).unwrap_or_default()
        ));
    };
    let Some(callback) = outcomes
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some(callback_id))
    else {
        return SignatureLookup::CallbackPending;
    };
    let callback_status = callback.get("outcome").and_then(|o| o.get("status"));
    let Some(success_value) = callback_status
        .and_then(|s| s.get("SuccessValue"))
        .and_then(Value::as_str)
    else {
        return SignatureLookup::Failed(format!(
            "MPC callback did not succeed: {}",
            callback_status.map(Value::to_string).unwrap_or_default()
        ));
    };
    match extract_mpc_signature(success_value) {
        Some(signature) => SignatureLookup::Found(signature),
        None => {
            SignatureLookup::Failed("MPC callback value carries no parseable signature".to_string())
        }
    }
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
    use wiremock::matchers::{method, path, query_param};
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

    /// An executed single intent the poll is owed: `due`, attempt now.
    async fn seed_executed_intent(pool: &PgPool, payload_hash: &str, deadline: &str) {
        seed_executed_intent_in(pool, payload_hash, deadline, SubmitState::Due).await;
    }

    async fn seed_executed_intent_in(
        pool: &PgPool,
        payload_hash: &str,
        deadline: &str,
        submit_state: SubmitState,
    ) {
        sqlx::query(
            r#"
            INSERT INTO confidential_intents (
                dao_id, payload_hash, intent_payload, intent_type, status, proposal_id,
                proposal_executed_at, proposal_execution_transaction_hash,
                submit_state, submit_next_attempt_at
            )
            VALUES ($1, $2, $3, 'shield', 'pending', 29, NOW() - INTERVAL '2 minutes', $4, $5, NOW())
            "#,
        )
        .bind(DAO)
        .bind(payload_hash)
        .bind(intent_payload(deadline))
        .bind(RRI_29_TX_HASH)
        .bind(submit_state.as_str())
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

    /// The quote row 1Click lists before any deposit reaches it.
    async fn seed_pending_quote_row(pool: &PgPool, deposit_address: &str) -> i64 {
        sqlx::query_scalar(
            r#"
            INSERT INTO bronze_confidential_history_events (
                account_id, created_at_external, deposit_address, status, deposit_type,
                recipient, destination_asset, raw_payload
            )
            VALUES ($1, NOW(), $2, 'PENDING_DEPOSIT', 'ORIGIN_CHAIN', 'alice.near', 'nep141:wrap.near', '{}'::jsonb)
            RETURNING id
            "#,
        )
        .bind(DAO)
        .bind(deposit_address)
        .fetch_one(pool)
        .await
        .expect("seed pending quote row")
    }

    /// Link the intent to a history row the way the standard linker does.
    async fn link_history_row(pool: &PgPool, payload_hash: &str, history_event_id: i64) {
        sqlx::query(
            "UPDATE confidential_intents SET history_event_id = $2 WHERE dao_id = $3 AND payload_hash = $1",
        )
        .bind(payload_hash)
        .bind(history_event_id)
        .bind(DAO)
        .execute(pool)
        .await
        .expect("link history row");
    }

    #[derive(sqlx::FromRow)]
    struct IntentRow {
        status: String,
        submit_result: Option<Value>,
        submit_state: String,
        submit_attempts: i32,
        submit_last_error: Option<String>,
        submit_next_attempt_at: Option<DateTime<Utc>>,
        submit_lease_token: Option<String>,
        history_event_id: Option<i64>,
    }

    impl IntentRow {
        fn seconds_until_next_attempt(&self) -> i64 {
            (self.submit_next_attempt_at.expect("next attempt scheduled") - Utc::now())
                .num_seconds()
        }
    }

    async fn load_intent(pool: &PgPool, payload_hash: &str) -> IntentRow {
        sqlx::query_as::<_, IntentRow>(
            r#"
            SELECT status, submit_result, submit_state, submit_attempts, submit_last_error,
                   submit_next_attempt_at, submit_lease_token, history_event_id
            FROM confidential_intents
            WHERE dao_id = $1 AND payload_hash = $2
            "#,
        )
        .bind(DAO)
        .bind(payload_hash)
        .fetch_one(pool)
        .await
        .expect("intent row")
    }

    /// Any 64 bytes: the stub 1Click never checks the signature.
    fn fake_signature() -> Vec<u8> {
        vec![7u8; 64]
    }

    /// A DAO JWT fresh enough that the history client never refreshes it.
    async fn seed_dao_jwt(pool: &PgPool, state: &AppState) {
        sqlx::query(
            "INSERT INTO monitored_accounts (account_id, is_confidential_account) VALUES ($1, TRUE)",
        )
        .bind(DAO)
        .execute(pool)
        .await
        .expect("seed monitored account");
        state
            .confidential_credentials()
            .store_new_plaintext_fallback(
                DAO,
                CredentialScope::Dao,
                &TokenBundle {
                    access_token: "test-access".to_string(),
                    refresh_token: "test-refresh".to_string(),
                },
                Utc::now() + chrono::Duration::hours(1),
            )
            .await
            .expect("seed jwt");
    }

    /// 1Click's answer to `GET /v0/account/history?depositAddress=…`.
    async fn mount_history_lookup(oneclick: &MockServer, items: Value, expected_calls: u64) {
        Mock::given(method("GET"))
            .and(path("/v0/account/history"))
            .and(query_param("depositAddress", DEPOSIT_ADDRESS))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "items": items,
                "nextCursor": null,
                "prevCursor": null
            })))
            .expect(expected_calls)
            .mount(oneclick)
            .await;
    }

    fn history_item_for_intent() -> Value {
        serde_json::json!([{
            "amountOutFormatted": "429.14",
            "amountOutUsd": "1000",
            "createdAt": "2026-10-12T12:00:00.000000Z",
            "depositAddress": DEPOSIT_ADDRESS,
            "depositMemo": null,
            "depositType": "CONFIDENTIAL_INTENTS",
            "destinationAsset": "nep141:wrap.near",
            "recipient": "alice.near",
            "recipientType": "CONFIDENTIAL_INTENTS",
            "refundType": "CONFIDENTIAL_INTENTS",
            "status": "SUCCESS"
        }])
    }

    async fn mount_rpc_stub(rpc: &MockServer) {
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(NearRpcStub)
            .mount(rpc)
            .await;
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

    /// `oneclick` serves the confidential API, the public 1Click API and the
    /// confidential history host.
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
        state.env_vars.confidential_history_base_url = oneclick.uri();
        state
    }

    #[test]
    fn signature_for_payload_follows_sign_receipt_to_mpc_callback() {
        let SignatureLookup::Found(signature) =
            signature_for_payload(&tx_status_fixture(), RRI_29_PAYLOAD_HASH)
        else {
            panic!("signature present in fixture");
        };
        assert_eq!(signature.len(), 64);
        assert_eq!(&signature[..4], &[138, 143, 59, 239]);
    }

    #[test]
    fn signature_for_payload_ignores_other_payload_hashes() {
        let other = "0".repeat(64);
        assert_eq!(
            signature_for_payload(&tx_status_fixture(), &other),
            SignatureLookup::NotInTransaction
        );
    }

    /// An on-chain execution failure in the shape the RPC types accept.
    fn failed_status(message: &str) -> Value {
        serde_json::json!({
            "Failure": {
                "ActionError": {
                    "index": 0,
                    "kind": { "FunctionCallError": { "ExecutionError": message } }
                }
            }
        })
    }

    /// The sign receipt and the callback receipt in the fixture.
    fn fixture_receipt_indexes() -> (usize, usize) {
        let fixture = tx_status_fixture();
        let outcomes = fixture["receipts_outcome"]
            .as_array()
            .expect("receipts_outcome");
        let sign = outcomes
            .iter()
            .position(|entry| outcome_signs_payload(entry, RRI_29_PAYLOAD_HASH))
            .expect("sign receipt");
        let callback_id = outcomes[sign]["outcome"]["status"]["SuccessReceiptId"]
            .as_str()
            .expect("callback id");
        let callback = outcomes
            .iter()
            .position(|entry| entry["id"].as_str() == Some(callback_id))
            .expect("callback receipt");
        (sign, callback)
    }

    #[test]
    fn signature_for_payload_is_pending_before_the_callback_lands() {
        let (_, callback) = fixture_receipt_indexes();
        let mut fixture = tx_status_fixture();
        fixture["receipts_outcome"]
            .as_array_mut()
            .expect("receipts_outcome")
            .remove(callback);
        assert_eq!(
            signature_for_payload(&fixture, RRI_29_PAYLOAD_HASH),
            SignatureLookup::CallbackPending
        );
    }

    #[test]
    fn signature_for_payload_fails_when_the_sign_call_failed() {
        let (sign, _) = fixture_receipt_indexes();
        let mut fixture = tx_status_fixture();
        fixture["receipts_outcome"][sign]["outcome"]["status"] =
            failed_status("signature request rejected");
        let lookup = signature_for_payload(&fixture, RRI_29_PAYLOAD_HASH);
        let SignatureLookup::Failed(error) = lookup else {
            panic!("expected Failed, got {lookup:?}");
        };
        assert!(error.contains("sign call did not succeed"), "{error}");
    }

    #[test]
    fn signature_for_payload_fails_when_the_callback_failed_or_is_unparseable() {
        let (_, callback) = fixture_receipt_indexes();
        let mut fixture = tx_status_fixture();
        fixture["receipts_outcome"][callback]["outcome"]["status"] =
            failed_status("callback panicked");
        assert!(matches!(
            signature_for_payload(&fixture, RRI_29_PAYLOAD_HASH),
            SignatureLookup::Failed(ref e) if e.contains("callback did not succeed")
        ));

        let mut fixture = tx_status_fixture();
        fixture["receipts_outcome"][callback]["outcome"]["status"] =
            serde_json::json!({ "SuccessValue": "bm90IGEgc2lnbmF0dXJl" });
        assert!(matches!(
            signature_for_payload(&fixture, RRI_29_PAYLOAD_HASH),
            SignatureLookup::Failed(ref e) if e.contains("no parseable signature")
        ));
    }

    #[test]
    fn intent_deadline_reads_the_nep413_message() {
        let deadline =
            intent_deadline(&intent_payload("2026-10-19T18:35:36.043Z")).expect("deadline parses");
        assert_eq!(deadline.to_rfc3339(), "2026-10-19T18:35:36.043+00:00");
        assert!(intent_deadline(&serde_json::json!({ "message": "not json" })).is_none());
    }

    #[test]
    fn submit_backoff_doubles_from_30s_and_caps_at_5m() {
        let secs: Vec<i64> = (0..7).map(|n| submit_backoff(n).num_seconds()).collect();
        assert_eq!(secs, vec![30, 30, 60, 120, 240, 300, 300]);
    }

    #[test]
    fn oneclick_statuses_split_into_retry_classes() {
        use reqwest::StatusCode;
        let class = |status: StatusCode| OneclickSubmitError::from_status(status, String::new());
        assert!(matches!(
            class(StatusCode::TOO_MANY_REQUESTS),
            OneclickSubmitError::Transient(_)
        ));
        assert!(matches!(
            class(StatusCode::SERVICE_UNAVAILABLE),
            OneclickSubmitError::Transient(_)
        ));
        for status in [
            StatusCode::REQUEST_TIMEOUT,
            StatusCode::INTERNAL_SERVER_ERROR,
            StatusCode::BAD_GATEWAY,
            StatusCode::GATEWAY_TIMEOUT,
        ] {
            assert!(
                matches!(class(status), OneclickSubmitError::Transport(_)),
                "{status}"
            );
        }
        for status in [
            StatusCode::BAD_REQUEST,
            StatusCode::UNAUTHORIZED,
            StatusCode::UNPROCESSABLE_ENTITY,
        ] {
            assert!(
                matches!(class(status), OneclickSubmitError::Rejected(_)),
                "{status}"
            );
        }
    }

    #[test]
    fn needs_poll_covers_every_non_final_outcome() {
        assert!(IntentSubmitOutcome::Deferred(String::new()).needs_poll());
        assert!(IntentSubmitOutcome::Unknown(String::new()).needs_poll());
        assert!(IntentSubmitOutcome::NotSignedYet.needs_poll());
        assert!(!IntentSubmitOutcome::Submitted.needs_poll());
        assert!(!IntentSubmitOutcome::Rejected(String::new()).needs_poll());
        assert!(!IntentSubmitOutcome::AlreadyHandled.needs_poll());
    }

    #[sqlx::test]
    async fn lease_is_exclusive_until_it_expires_and_writes_need_the_token(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        let submitter = ConfidentialIntentSubmitter::new(&state);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2099-01-01T00:00:00Z").await;

        let first = submitter
            .lease(DAO, RRI_29_PAYLOAD_HASH)
            .await
            .expect("lease query")
            .expect("first lease wins");
        assert_eq!(first.intent_type, "shield");
        assert_eq!(first.submit_attempts, 1);
        assert!(
            submitter
                .lease(DAO, RRI_29_PAYLOAD_HASH)
                .await
                .expect("lease query")
                .is_none(),
            "a live lease is exclusive"
        );
        assert_eq!(
            load_intent(&pool, RRI_29_PAYLOAD_HASH).await.submit_state,
            "in_flight"
        );

        // The first holder outlives its lease: the row is reclaimable.
        sqlx::query(
            "UPDATE confidential_intents SET submit_lease_until = NOW() - INTERVAL '1 second' WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .execute(&pool)
        .await
        .expect("expire lease");
        let second = submitter
            .lease(DAO, RRI_29_PAYLOAD_HASH)
            .await
            .expect("lease query")
            .expect("expired lease is reclaimable");
        assert_ne!(second.token, first.token);
        assert_eq!(second.submit_attempts, 2);

        // The stale holder's outcome is ignored; the live holder's lands.
        let response = serde_json::json!({ "intentHash": "stale" });
        assert!(
            !submitter
                .finish_submitted(DAO, RRI_29_PAYLOAD_HASH, &first, &response)
                .await
        );
        submitter
            .finish_failed(DAO, RRI_29_PAYLOAD_HASH, &first, "stale")
            .await;
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.submit_state, "in_flight");
        assert!(row.submit_result.is_none());

        let response = serde_json::json!({ "intentHash": "live" });
        assert!(
            submitter
                .finish_submitted(DAO, RRI_29_PAYLOAD_HASH, &second, &response)
                .await
        );
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "submitted");
        assert_eq!(row.submit_state, "done");
        assert_eq!(row.submit_result.expect("response")["intentHash"], "live");
        assert!(row.submit_lease_token.is_none());
        assert!(
            submitter
                .lease(DAO, RRI_29_PAYLOAD_HASH)
                .await
                .expect("lease query")
                .is_none(),
            "a done row is never leased again"
        );
    }

    /// Retiring an intent needs 1Click's own word: a targeted lookup for the
    /// deposit address that comes back empty.
    #[sqlx::test]
    async fn resubmit_marks_expired_intents_failed_once_1click_confirms_nothing(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_dao_jwt(&pool, &state).await;
        mount_history_lookup(&oneclick, serde_json::json!([]), 1).await;
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;

        let submitted = ConfidentialIntentSubmitter::new(&state)
            .resubmit_awaiting_intents(DAO)
            .await;
        assert_eq!(submitted, 0);

        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "failed");
        assert_eq!(row.submit_state, "failed");
        let error = row.submit_result.expect("expiry recorded")["error"]
            .as_str()
            .expect("error string")
            .to_string();
        assert!(error.contains("deadline passed"), "got {error}");
        assert_eq!(row.submit_last_error.as_deref(), Some(error.as_str()));
        assert!(row.submit_lease_token.is_none());
        assert!(
            rpc.received_requests().await.expect("rpc log").is_empty(),
            "expired rows are retired without an RPC call"
        );
    }

    /// A quote 1Click still lists as PENDING_DEPOSIT is not proof of a
    /// submission: the quote exists before the intent runs. Past the deadline
    /// with nothing on the deposit address, the intent was never submitted
    /// and is retired. This is the legacy shape the submit-state migration
    /// reopens as `unknown` (linked to the quote row, no 1Click response).
    #[sqlx::test]
    async fn resubmit_retires_expired_intents_whose_quote_never_saw_a_deposit(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_dao_jwt(&pool, &state).await;
        let mut pending_quote = history_item_for_intent();
        pending_quote[0]["status"] = Value::from("PENDING_DEPOSIT");
        mount_history_lookup(&oneclick, pending_quote, 1).await;
        seed_executed_intent_in(
            &pool,
            RRI_29_PAYLOAD_HASH,
            "2020-01-01T00:00:00Z",
            SubmitState::Unknown,
        )
        .await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;
        let quote_row = seed_pending_quote_row(&pool, DEPOSIT_ADDRESS).await;
        link_history_row(&pool, RRI_29_PAYLOAD_HASH, quote_row).await;

        let submitted = ConfidentialIntentSubmitter::new(&state)
            .resubmit_awaiting_intents(DAO)
            .await;
        assert_eq!(submitted, 0);

        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "failed");
        assert_eq!(row.submit_state, "failed");
        assert_eq!(
            row.history_event_id,
            Some(quote_row),
            "the quote link is kept"
        );
        let error = row.submit_result.expect("expiry recorded")["error"]
            .as_str()
            .expect("error string")
            .to_string();
        assert!(error.contains("deadline passed"), "got {error}");
        assert!(row.submit_lease_token.is_none());
        assert!(
            rpc.received_requests().await.expect("rpc log").is_empty(),
            "expired rows are retired without an RPC call"
        );
    }

    /// Same quote-only history, deadline still ahead: an uncertain outcome is
    /// neither retired nor re-posted. It waits for a deposit to show up or
    /// the deadline to pass.
    #[sqlx::test]
    async fn resubmit_leaves_unexpired_intents_with_a_deposit_free_quote_unresolved(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_dao_jwt(&pool, &state).await;
        let mut pending_quote = history_item_for_intent();
        pending_quote[0]["status"] = Value::from("PENDING_DEPOSIT");
        mount_history_lookup(&oneclick, pending_quote, 1).await;
        seed_executed_intent_in(
            &pool,
            RRI_29_PAYLOAD_HASH,
            "2999-01-01T00:00:00Z",
            SubmitState::Unknown,
        )
        .await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;
        let quote_row = seed_pending_quote_row(&pool, DEPOSIT_ADDRESS).await;
        link_history_row(&pool, RRI_29_PAYLOAD_HASH, quote_row).await;

        assert_eq!(
            ConfidentialIntentSubmitter::new(&state)
                .resubmit_awaiting_intents(DAO)
                .await,
            0
        );
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "pending");
        assert_eq!(row.submit_state, "unknown");
        assert!(row.submit_result.is_none());
        assert!(row.submit_lease_token.is_none());
        assert!(
            rpc.received_requests().await.expect("rpc log").is_empty(),
            "an uncertain outcome is never re-posted"
        );
    }

    /// The latest-page poll missed the payment (ingestion gap): the targeted
    /// 1Click lookup finds it, ingests it, and the intent is reconciled as
    /// submitted instead of retired.
    #[sqlx::test]
    async fn resubmit_recovers_from_a_targeted_1click_lookup_when_local_history_missed_it(
        pool: PgPool,
    ) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_dao_jwt(&pool, &state).await;
        mount_history_lookup(&oneclick, history_item_for_intent(), 1).await;
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;

        let submitter = ConfidentialIntentSubmitter::new(&state);
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 1);

        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "submitted");
        assert_eq!(row.submit_state, "done");
        let history_event_id = row.history_event_id.expect("linked to the ingested row");
        let ingested: (String, Option<String>) = sqlx::query_as(
            "SELECT deposit_address, recipient FROM bronze_confidential_history_events WHERE id = $1",
        )
        .bind(history_event_id)
        .fetch_one(&pool)
        .await
        .expect("ingested history row");
        assert_eq!(ingested.0, DEPOSIT_ADDRESS);
        assert_eq!(ingested.1.as_deref(), Some("alice.near"));
        assert_eq!(
            row.submit_result.expect("synthetic submit_result")["historyEventId"],
            history_event_id
        );
        assert!(
            rpc.received_requests().await.expect("rpc log").is_empty(),
            "nothing is re-posted"
        );
    }

    /// 1Click unreachable for the lookup: nothing is known, so the expired
    /// intent waits with backoff instead of failing.
    #[sqlx::test]
    async fn resubmit_defers_expiry_when_the_1click_lookup_fails(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_dao_jwt(&pool, &state).await;
        Mock::given(method("GET"))
            .and(path("/v0/account/history"))
            .respond_with(ResponseTemplate::new(503))
            .expect(1)
            .mount(&oneclick)
            .await;
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;

        assert_eq!(
            ConfidentialIntentSubmitter::new(&state)
                .resubmit_awaiting_intents(DAO)
                .await,
            0
        );
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "pending");
        assert_eq!(row.submit_state, "unknown");
        assert!(row.submit_result.is_none());
        assert!(
            row.submit_last_error
                .as_deref()
                .is_some_and(|e| e.contains("history lookup"))
        );
        assert!((25..=35).contains(&row.seconds_until_next_attempt()));
    }

    /// Without a deposit address nothing can prove 1Click never accepted the
    /// intent, so an uncertain outcome is left unresolved, never retired.
    #[sqlx::test]
    async fn intent_without_a_deposit_address_is_never_retired_blind(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;

        let submitter = ConfidentialIntentSubmitter::new(&state);
        for _ in 0..2 {
            assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
            let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
            assert_eq!(row.status, "pending");
            assert_eq!(row.submit_state, "unknown");
            assert!(row.submit_result.is_none());
            assert!(
                row.submit_last_error
                    .as_deref()
                    .is_some_and(|e| e.contains("no deposit address"))
            );
            sqlx::query("UPDATE confidential_intents SET submit_next_attempt_at = NOW()")
                .execute(&pool)
                .await
                .expect("make due");
        }
        assert!(
            oneclick
                .received_requests()
                .await
                .expect("1click log")
                .is_empty(),
            "nothing to look up, nothing to re-post"
        );
    }

    /// A bulk-payment header stored before the column was persisted: the
    /// address lives only in quote metadata, and reconciliation still finds
    /// the payment through it.
    #[sqlx::test]
    async fn reconciliation_reads_the_deposit_address_from_quote_metadata(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_dao_jwt(&pool, &state).await;
        mount_history_lookup(&oneclick, history_item_for_intent(), 1).await;
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        sqlx::query(
            "UPDATE confidential_intents SET deposit_address = NULL, quote_metadata = $2 WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .bind(serde_json::json!({
            "quote": { "depositAddress": DEPOSIT_ADDRESS },
            "quoteRequest": { "recipient": "alice.near" }
        }))
        .execute(&pool)
        .await
        .expect("metadata-only address");

        assert_eq!(
            ConfidentialIntentSubmitter::new(&state)
                .resubmit_awaiting_intents(DAO)
                .await,
            1
        );
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "submitted");
        assert_eq!(row.submit_state, "done");
        assert!(row.history_event_id.is_some());
    }

    #[sqlx::test]
    async fn resubmit_submits_the_signature_found_on_chain_exactly_once(pool: PgPool) {
        let rpc = MockServer::start().await;
        mount_rpc_stub(&rpc).await;
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
        assert_eq!(row.submit_state, "done");
        assert_eq!(row.submit_attempts, 1);
        assert_eq!(
            row.submit_result.expect("1Click response stored")["intentHash"],
            "mock-intent-hash"
        );
        assert!(row.submit_lease_token.is_none());
        assert!(row.submit_next_attempt_at.is_none());

        // A second pass finds nothing to do and never re-posts (wiremock
        // enforces `expect(1)` on drop).
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
    }

    /// Signing failed on chain: no retry can help, so the poll fails the
    /// row instead of re-reading the transaction until the deadline.
    #[sqlx::test]
    async fn resubmit_fails_the_row_when_the_sign_call_failed_on_chain(pool: PgPool) {
        struct FailedSignStub;
        impl Respond for FailedSignStub {
            fn respond(&self, request: &Request) -> ResponseTemplate {
                let body: Value = serde_json::from_slice(&request.body).expect("json-rpc body");
                let (sign, _) = fixture_receipt_indexes();
                let mut fixture = tx_status_fixture();
                fixture["receipts_outcome"][sign]["outcome"]["status"] = failed_status("rejected");
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": body.get("id").cloned().unwrap_or(Value::Null),
                    "result": fixture
                }))
            }
        }
        let rpc = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(FailedSignStub)
            .expect(1)
            .mount(&rpc)
            .await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2099-01-01T00:00:00Z").await;

        let submitter = ConfidentialIntentSubmitter::new(&state);
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "failed");
        assert_eq!(row.submit_state, "failed");
        assert!(
            row.submit_result.expect("error stored")["error"]
                .as_str()
                .is_some_and(|e| e.contains("sign call did not succeed"))
        );
        // Terminal: a second pass does not touch the chain again.
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
    }

    /// One 1Click answer to the submit POST, then the relay-path submit.
    async fn submit_against(
        pool: &PgPool,
        rpc: &MockServer,
        oneclick: &MockServer,
        response: ResponseTemplate,
    ) -> (IntentSubmitOutcome, IntentRow) {
        mount_rpc_stub(rpc).await;
        Mock::given(method("POST"))
            .and(path("/v0/submit-intent"))
            .respond_with(response)
            .expect(1)
            .mount(oneclick)
            .await;
        let state = state_with_mocks(pool.clone(), rpc, oneclick);
        seed_executed_intent(pool, RRI_29_PAYLOAD_HASH, "2099-01-01T00:00:00Z").await;
        let outcome = ConfidentialIntentSubmitter::new(&state)
            .submit_signed(DAO, RRI_29_PAYLOAD_HASH, &fake_signature())
            .await;
        (outcome, load_intent(pool, RRI_29_PAYLOAD_HASH).await)
    }

    /// 1Click is rate limiting: the request was not taken, so the row goes
    /// straight back to `due` and is re-posted after backoff.
    #[sqlx::test]
    async fn rate_limit_returns_the_row_to_due(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let (outcome, row) =
            submit_against(&pool, &rpc, &oneclick, ResponseTemplate::new(429)).await;
        assert!(
            matches!(outcome, IntentSubmitOutcome::Deferred(_)),
            "{outcome:?}"
        );
        assert!(outcome.needs_poll());
        assert_eq!(row.status, "pending");
        assert_eq!(row.submit_state, "due");
        assert!(row.submit_result.is_none());
        assert!(row.submit_lease_token.is_none());
        assert!(
            row.submit_last_error
                .as_deref()
                .is_some_and(|e| e.contains("429"))
        );
        assert!((25..=35).contains(&row.seconds_until_next_attempt()));
    }

    /// 1Click failed mid-request: it may have accepted the intent, so the
    /// row is `unknown` and reconciled before any re-post.
    #[sqlx::test]
    async fn server_error_leaves_the_row_unknown(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let (outcome, row) =
            submit_against(&pool, &rpc, &oneclick, ResponseTemplate::new(500)).await;
        assert!(
            matches!(outcome, IntentSubmitOutcome::Unknown(_)),
            "{outcome:?}"
        );
        assert_eq!(row.status, "pending");
        assert_eq!(row.submit_state, "unknown");
        assert!(row.submit_result.is_none());
        assert!((25..=35).contains(&row.seconds_until_next_attempt()));
    }

    /// 1Click refused the intent itself: final for this signature.
    #[sqlx::test]
    async fn validation_error_fails_the_row(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let (outcome, row) = submit_against(
            &pool,
            &rpc,
            &oneclick,
            ResponseTemplate::new(400).set_body_json(serde_json::json!({ "message": "bad nonce" })),
        )
        .await;
        assert!(
            matches!(outcome, IntentSubmitOutcome::Rejected(_)),
            "{outcome:?}"
        );
        assert!(!outcome.needs_poll());
        assert_eq!(row.status, "failed");
        assert_eq!(row.submit_state, "failed");
        assert!(
            row.submit_result.expect("1Click error stored")["error"]
                .as_str()
                .is_some_and(|e| e.contains("bad nonce"))
        );
        assert!(row.submit_next_attempt_at.is_none());
    }

    /// Nothing listens at 1Click: the request was never taken, so the row
    /// returns to `due` with a growing backoff and the poll re-posts it.
    #[sqlx::test]
    async fn connection_refusal_returns_the_row_to_due_with_backoff(pool: PgPool) {
        let rpc = MockServer::start().await;
        mount_rpc_stub(&rpc).await;
        let oneclick = MockServer::start().await;
        let mut state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        // A closed port: the connection is refused.
        state.env_vars.confidential_api_url = "http://127.0.0.1:1".to_string();
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2099-01-01T00:00:00Z").await;

        let submitter = ConfidentialIntentSubmitter::new(&state);
        let outcome = submitter
            .submit_signed(DAO, RRI_29_PAYLOAD_HASH, &fake_signature())
            .await;
        assert!(
            matches!(outcome, IntentSubmitOutcome::Deferred(_)),
            "{outcome:?}"
        );
        assert!(outcome.needs_poll());
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "pending");
        assert_eq!(row.submit_state, "due");
        assert_eq!(row.submit_attempts, 1);
        assert!(row.submit_result.is_none());
        assert!(row.submit_lease_token.is_none());
        assert!(
            row.submit_last_error
                .as_deref()
                .is_some_and(|e| e.contains("1click"))
        );
        assert!((25..=35).contains(&row.seconds_until_next_attempt()));

        // Not due yet: the poll leaves it alone.
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
        assert_eq!(
            load_intent(&pool, RRI_29_PAYLOAD_HASH)
                .await
                .submit_attempts,
            1
        );

        // Due again: never posted, so no 1Click lookup; the poll re-posts
        // from the on-chain signature and backs off longer.
        sqlx::query("UPDATE confidential_intents SET submit_next_attempt_at = NOW()")
            .execute(&pool)
            .await
            .expect("make due");
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.submit_state, "due");
        assert_eq!(row.submit_attempts, 2);
        assert!((55..=65).contains(&row.seconds_until_next_attempt()));
        assert!(
            oneclick
                .received_requests()
                .await
                .expect("1click log")
                .is_empty(),
            "a never-posted row is not looked up"
        );
    }

    /// A stale holder's reconciliation must not clear the lease a newer
    /// holder took meanwhile. The newer lease is written in an open
    /// transaction so the stale UPDATE blocks on the row lock and re-checks
    /// its conditions on the committed row version.
    #[sqlx::test]
    async fn stale_reconciliation_does_not_clear_a_replacement_lease(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        let submitter = ConfidentialIntentSubmitter::new(&state);
        seed_executed_intent_in(
            &pool,
            RRI_29_PAYLOAD_HASH,
            "2099-01-01T00:00:00Z",
            SubmitState::Unknown,
        )
        .await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;
        seed_history_row(&pool, DEPOSIT_ADDRESS).await;

        let stale = submitter
            .lease(DAO, RRI_29_PAYLOAD_HASH)
            .await
            .expect("lease query")
            .expect("stale lease taken");
        sqlx::query(
            "UPDATE confidential_intents SET submit_lease_until = NOW() - INTERVAL '1 second' WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .execute(&pool)
        .await
        .expect("expire stale lease");

        let mut replacement = pool.begin().await.expect("begin");
        sqlx::query(
            "UPDATE confidential_intents SET submit_lease_token = 'replacement', submit_lease_until = NOW() + INTERVAL '2 minutes' WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .execute(&mut *replacement)
        .await
        .expect("replacement lease");

        let stale_pool = pool.clone();
        let stale_token = stale.token.clone();
        let stale_recovery = tokio::spawn(async move {
            recover_unsubmitted_intent_from_history(
                &stale_pool,
                DAO,
                RRI_29_PAYLOAD_HASH,
                &stale_token,
            )
            .await
        });
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        replacement.commit().await.expect("commit replacement");

        let recovered = stale_recovery.await.expect("task").expect("recovery query");
        assert!(recovered.is_none(), "stale holder recovered nothing");
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.submit_lease_token.as_deref(), Some("replacement"));
        assert_eq!(row.submit_state, "in_flight");
        assert!(row.history_event_id.is_none());
        assert!(row.submit_result.is_none());
    }

    /// The 1Click answer was lost after 1Click accepted the intent: the poll
    /// ingested its history row, so the expired row is reconciled as
    /// submitted rather than failed, and nothing is re-posted.
    #[sqlx::test]
    async fn resubmit_recovers_an_intent_already_in_1click_history(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent_in(
            &pool,
            RRI_29_PAYLOAD_HASH,
            "2020-01-01T00:00:00Z",
            SubmitState::Unknown,
        )
        .await;
        attach_quote(&pool, RRI_29_PAYLOAD_HASH).await;
        let history_event_id = seed_history_row(&pool, DEPOSIT_ADDRESS).await;

        let submitter = ConfidentialIntentSubmitter::new(&state);
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 1);

        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "submitted");
        assert_eq!(row.submit_state, "done");
        assert_eq!(row.history_event_id, Some(history_event_id));
        let submit_result = row.submit_result.expect("synthetic submit_result");
        assert_eq!(submit_result["recoveredFromHistory"], true);
        assert_eq!(submit_result["historyEventId"], history_event_id);
        assert!(row.submit_lease_token.is_none());
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

    /// A row the ingest-time linker already attached to its history row
    /// while it was still owed to 1Click: the link is the proof.
    #[sqlx::test]
    async fn resubmit_backfills_an_already_linked_intent_instead_of_expiring_it(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        seed_executed_intent_in(
            &pool,
            RRI_29_PAYLOAD_HASH,
            "2020-01-01T00:00:00Z",
            SubmitState::Unknown,
        )
        .await;
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
        assert_eq!(row.submit_state, "done");
        assert_eq!(row.history_event_id, Some(history_event_id));
        assert_eq!(
            row.submit_result.expect("synthetic submit_result")["historyEventId"],
            history_event_id
        );
        assert!(
            oneclick
                .received_requests()
                .await
                .expect("1click log")
                .is_empty()
        );
        assert_eq!(submitter.resubmit_awaiting_intents(DAO).await, 0);
    }

    /// Expiry alone must also respect a link that appeared meanwhile.
    #[sqlx::test]
    async fn expiry_yields_to_an_existing_history_link(pool: PgPool) {
        let rpc = MockServer::start().await;
        let oneclick = MockServer::start().await;
        let state = state_with_mocks(pool.clone(), &rpc, &oneclick);
        let submitter = ConfidentialIntentSubmitter::new(&state);
        seed_executed_intent(&pool, RRI_29_PAYLOAD_HASH, "2020-01-01T00:00:00Z").await;
        let lease = submitter
            .lease(DAO, RRI_29_PAYLOAD_HASH)
            .await
            .expect("lease query")
            .expect("lease taken");
        let history_event_id = seed_history_row(&pool, DEPOSIT_ADDRESS).await;
        sqlx::query(
            "UPDATE confidential_intents SET history_event_id = $2 WHERE payload_hash = $1",
        )
        .bind(RRI_29_PAYLOAD_HASH)
        .bind(history_event_id)
        .execute(&pool)
        .await
        .expect("link row");

        submitter
            .mark_expired(DAO, RRI_29_PAYLOAD_HASH, &lease)
            .await;
        let row = load_intent(&pool, RRI_29_PAYLOAD_HASH).await;
        assert_eq!(row.status, "pending");
        assert_eq!(
            row.submit_state, "unknown",
            "handed back for reconciliation"
        );
        assert!(row.submit_result.is_none());
        assert!(row.submit_lease_token.is_none());
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
        assert_eq!(row.submit_state, "unknown");
        assert!(row.submit_result.is_none());
        assert!(row.submit_lease_token.is_none());
        assert!(
            row.submit_last_error
                .as_deref()
                .is_some_and(|e| e.contains("reconciliation failed"))
        );
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
        seed_dao_jwt(&pool, &state).await;
        mount_history_lookup(&oneclick, serde_json::json!([]), 1).await;
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
        assert_eq!(row.submit_state, "failed");
        assert!(row.history_event_id.is_none());
    }
}

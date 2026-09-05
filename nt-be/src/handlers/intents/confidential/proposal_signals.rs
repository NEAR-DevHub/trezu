//! Confidential proposal signals from indexed DAO outcomes.
//!
//! When a confidential DAO approves a swap proposal, `act_proposal` spawns a
//! cross-contract call to `v1.signer`, whose execution outcome emits one
//! `sign: predecessor=…` log. That log proves the proposal executed and names
//! the matching intent via the payload hash; `add_proposal` SuccessValues
//! carry the on-chain proposal id. These helpers parse both signals and stamp
//! the linkage facts (`proposal_id`, `proposal_created_at`,
//! `proposal_executed_at`, execution block/tx) onto `confidential_intents`.
//!
//! Consumed by the public-history detector at the Goldsky sink tip (no
//! per-outcome RPC beyond the proposal fetch on an add_proposal match).

use base64::Engine as _;
use near_api::NetworkConfig;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use sqlx::PgPool;

use crate::handlers::intents::confidential::bronze::store::link_intent_to_history_event;
use crate::handlers::intents::confidential::gold::history_events::refresh_gold_metadata_for_intent;
use crate::handlers::intents::confidential::types::bare_account;
use crate::handlers::proposals::scraper::{extract_payload_hash_from_kind, fetch_proposal};

/// Legacy payload form: `predecessor=AccountId("…") … payload_v2: Some(Eddsa(Bytes("<hex>")))`.
static V1_SIGNER_HEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"predecessor=AccountId\("(?P<dao>[^"]+)"\).*payload_v2:\s*Some\(Eddsa\(Bytes\("(?P<hash>[0-9a-fA-F]+)"\)"#,
    )
    .expect("v1.signer hex sign-log regex is valid")
});

/// `payload_v2: Some(Eddsa(BoundedVec { inner: [u8, …] }))` form (2026-05).
static V1_SIGNER_BYTES: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"predecessor=AccountId\("(?P<dao>[^"]+)"\).*payload_v2:\s*Some\(Eddsa\(BoundedVec\s*\{\s*inner:\s*\[(?P<bytes>[0-9,\s]+)\]"#,
    )
    .expect("v1.signer bytes sign-log regex is valid")
});

/// `payload: Eddsa(BoundedVec { inner: [u8, …], witness: … })` form (2026-06+).
static V1_SIGNER_PAYLOAD_BOUNDED: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"predecessor=AccountId\("(?P<dao>[^"]+)"\).*payload:\s*Eddsa\(BoundedVec\s*\{\s*inner:\s*\[(?P<bytes>[0-9,\s]+)\]"#,
    )
    .expect("v1.signer payload bounded sign-log regex is valid")
});

/// Extracted signal that a confidential sign call ran.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfidentialSignCall {
    pub dao_id: String,
    pub payload_hash: String,
}

#[derive(Debug, Clone)]
pub struct SubmittedIntentInfo {
    pub recipient: Option<String>,
}

fn decode_bounded_vec_bytes(captured: &str) -> Option<String> {
    let mut hex = String::with_capacity(64);
    for token in captured.split(',') {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            continue;
        }
        let byte: u8 = trimmed.parse().ok()?;
        hex.push_str(&format!("{:02x}", byte));
    }
    if hex.is_empty() { None } else { Some(hex) }
}

/// Scan a `v1.signer` outcome's logs for a `sign: predecessor=…` line and
/// extract the DAO + payload hash if present. Supports `Bytes("<hex>")`,
/// `payload_v2: Some(Eddsa(BoundedVec …))`, and `payload: Eddsa(BoundedVec …)`.
pub fn extract_sign_call_from_logs(logs: &str) -> Option<ConfidentialSignCall> {
    for raw_line in logs.split('\n').flat_map(|l| l.split("\\n")) {
        let line = raw_line.trim();
        if !line.starts_with("sign:") {
            continue;
        }
        if let Some(cap) = V1_SIGNER_HEX.captures(line) {
            return Some(ConfidentialSignCall {
                dao_id: cap.name("dao")?.as_str().to_string(),
                payload_hash: cap.name("hash")?.as_str().to_ascii_lowercase(),
            });
        }
        if let Some(cap) = V1_SIGNER_BYTES.captures(line) {
            return Some(ConfidentialSignCall {
                dao_id: cap.name("dao")?.as_str().to_string(),
                payload_hash: decode_bounded_vec_bytes(cap.name("bytes")?.as_str())?,
            });
        }
        if let Some(cap) = V1_SIGNER_PAYLOAD_BOUNDED.captures(line) {
            return Some(ConfidentialSignCall {
                dao_id: cap.name("dao")?.as_str().to_string(),
                payload_hash: decode_bounded_vec_bytes(cap.name("bytes")?.as_str())?,
            });
        }
    }
    None
}

fn quote_recipient(quote_metadata: Option<&Value>) -> Option<String> {
    let recipient = quote_metadata?
        .get("quoteRequest")
        .and_then(|q| q.get("recipient"))
        .and_then(|v| v.as_str())?;
    Some(bare_account(recipient))
}

pub async fn mark_confidential_intent_submitted(
    app_pool: &PgPool,
    dao_id: &str,
    payload_hash: &str,
    proposal_executed_at: chrono::DateTime<chrono::Utc>,
    proposal_execution_block_height: Option<i64>,
    proposal_execution_transaction_hash: Option<&str>,
) -> Result<Option<SubmittedIntentInfo>, Box<dyn std::error::Error>> {
    let row = sqlx::query_as::<_, (Option<Value>,)>(
        r#"
        SELECT quote_metadata
        FROM confidential_intents
        WHERE dao_id = $1
          AND payload_hash = $2
        "#,
    )
    .bind(dao_id)
    .bind(payload_hash)
    .fetch_optional(app_pool)
    .await?;

    let Some((quote_metadata,)) = row else {
        return Ok(None);
    };
    let recipient = quote_recipient(quote_metadata.as_ref());

    sqlx::query(
        r#"
        UPDATE confidential_intents
        SET status = 'submitted',
            proposal_executed_at = COALESCE(proposal_executed_at, $3),
            proposal_execution_block_height = COALESCE(proposal_execution_block_height, $4),
            proposal_execution_transaction_hash = COALESCE(proposal_execution_transaction_hash, $5),
            updated_at = NOW()
        WHERE dao_id = $1
          AND payload_hash = $2
        "#,
    )
    .bind(dao_id)
    .bind(payload_hash)
    .bind(proposal_executed_at)
    .bind(proposal_execution_block_height)
    .bind(proposal_execution_transaction_hash)
    .execute(app_pool)
    .await?;

    if let Some(history_event_id) =
        link_intent_to_history_event(app_pool, dao_id, payload_hash).await?
    {
        tracing::info!(
            "linked submitted intent {}/{} to history_event_id={}",
            dao_id,
            payload_hash,
            history_event_id
        );
    }

    refresh_gold_metadata_for_intent(app_pool, dao_id, payload_hash).await?;

    Ok(Some(SubmittedIntentInfo { recipient }))
}

pub(crate) fn decode_success_value_u64(status: &str) -> Option<u64> {
    fn extract_encoded(status: &str) -> Option<String> {
        let status = status.trim();
        if status.is_empty() {
            return None;
        }

        if let Ok(value) = serde_json::from_str::<serde_json::Value>(status) {
            return value
                .get("SuccessValue")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToString::to_string);
        }

        let inner = status
            .strip_prefix("SuccessValue(")?
            .strip_suffix(')')?
            .trim();
        let encoded = inner.strip_prefix('"')?.strip_suffix('"')?.trim();
        (!encoded.is_empty()).then(|| encoded.to_string())
    }

    let encoded = extract_encoded(status)?;

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    decoded.trim().parse::<u64>().ok()
}

async fn update_confidential_intent_proposal(
    app_pool: &PgPool,
    dao_id: &str,
    payload_hash: &str,
    proposal_id: u64,
    proposal_created_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, Box<dyn std::error::Error>> {
    let proposal_id = i64::try_from(proposal_id)?;
    let result = sqlx::query(
        r#"
        UPDATE confidential_intents
        SET proposal_id = COALESCE(proposal_id, $3),
            proposal_created_at = COALESCE(proposal_created_at, $4),
            updated_at = NOW()
        WHERE dao_id = $1
          AND payload_hash = $2
        "#,
    )
    .bind(dao_id)
    .bind(payload_hash)
    .bind(proposal_id)
    .bind(proposal_created_at)
    .execute(app_pool)
    .await?;

    if result.rows_affected() > 0 {
        if let Some(history_event_id) =
            link_intent_to_history_event(app_pool, dao_id, payload_hash).await?
        {
            tracing::info!(
                "linked proposal intent {}/{} to history_event_id={}",
                dao_id,
                payload_hash,
                history_event_id
            );
        }
        refresh_gold_metadata_for_intent(app_pool, dao_id, payload_hash).await?;
        return Ok(true);
    }

    Ok(false)
}

pub(crate) async fn handle_confidential_add_proposal(
    app_pool: &PgPool,
    network: &NetworkConfig,
    dao_id: &str,
    proposal_id: u64,
    proposal_created_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, Box<dyn std::error::Error>> {
    let dao_account: near_api::AccountId = match dao_id.parse() {
        Ok(account) => account,
        Err(e) => {
            tracing::warn!(
                "invalid DAO account id for proposal lookup {}: {}",
                dao_id,
                e
            );
            return Ok(false);
        }
    };

    let proposal = match fetch_proposal(network, &dao_account, proposal_id).await {
        Ok(proposal) => proposal,
        Err(e) => {
            tracing::warn!(
                "failed to fetch proposal {}/{}: {:?}",
                dao_id,
                proposal_id,
                e
            );
            return Ok(false);
        }
    };

    let Some(payload_hash) = extract_payload_hash_from_kind(&proposal.kind) else {
        return Ok(false);
    };

    let updated = update_confidential_intent_proposal(
        app_pool,
        dao_id,
        &payload_hash,
        proposal_id,
        proposal_created_at,
    )
    .await?;

    if updated {
        tracing::info!(
            "linked confidential proposal {}/{} to payload_hash={}",
            dao_id,
            proposal_id,
            payload_hash
        );
    }

    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_v1_signer_sign_log() {
        let log = r#"sign: predecessor=AccountId("confidential-yuriik.sputnik-dao.near"), request=SignRequestArgs { path: "confidential-yuriik.sputnik-dao.near", payload_v2: Some(Eddsa(Bytes("2591e2441a7d9c0b3b9fed73da21609cd708db1e5316f8b244630191d574adb4"))), deprecated_payload: None, domain_id: Some(DomainId(1)), deprecated_key_version: None }"#;
        let got = extract_sign_call_from_logs(log).expect("should parse");
        assert_eq!(got.dao_id, "confidential-yuriik.sputnik-dao.near");
        assert_eq!(
            got.payload_hash,
            "2591e2441a7d9c0b3b9fed73da21609cd708db1e5316f8b244630191d574adb4"
        );
    }

    #[test]
    fn ignores_non_sign_logs() {
        assert!(extract_sign_call_from_logs("EVENT_JSON:{\"standard\":\"nep141\"}").is_none());
        assert!(extract_sign_call_from_logs("Transfer 100 from a to b").is_none());
    }

    #[test]
    fn parses_v1_signer_bounded_vec_payload() {
        // Real on-chain log captured 2026-05-08, block 197405271 (tobi.sputnik-dao.near).
        // The signer contract upgraded from `Bytes("<hex>")` to `BoundedVec { inner: [u8;32] }`.
        let log = r#"sign: predecessor=AccountId("tobi.sputnik-dao.near"), request=SignRequestArgs { path: "tobi.sputnik-dao.near", payload_v2: Some(Eddsa(BoundedVec { inner: [123, 162, 50, 88, 71, 237, 138, 108, 13, 213, 18, 249, 177, 240, 169, 135, 202, 61, 156, 80, 85, 206, 77, 114, 62, 140, 72, 88, 191, 215, 42, 171] })), deprecated_payload: None, domain_id: Some(DomainId(1)), deprecated_key_version: None }"#;
        let got = extract_sign_call_from_logs(log).expect("should parse new format");
        assert_eq!(got.dao_id, "tobi.sputnik-dao.near");
        assert_eq!(
            got.payload_hash,
            "7ba2325847ed8a6c0dd512f9b1f0a987ca3d9c5055ce4d723e8c4858bfd72aab"
        );
    }

    #[test]
    fn parses_v1_signer_payload_bounded_vec_with_witness() {
        // Real on-chain log captured 2026-06-04, block 201255187 (dedupingggg.sputnik-dao.near).
        let log = r#"sign: predecessor=AccountId("dedupingggg.sputnik-dao.near"), request=SignRequestArgs { path: "dedupingggg.sputnik-dao.near", payload: Eddsa(BoundedVec { inner: [87, 249, 7, 178, 173, 216, 20, 193, 248, 189, 160, 114, 81, 65, 8, 58, 29, 224, 170, 146, 94, 100, 237, 122, 74, 216, 231, 25, 0, 252, 238, 243], witness: NonEmpty(()) }), domain_id: DomainId(1) }"#;
        let got = extract_sign_call_from_logs(log).expect("should parse payload: form");
        assert_eq!(got.dao_id, "dedupingggg.sputnik-dao.near");
        assert_eq!(
            got.payload_hash,
            "57f907b2add814c1f8bda0725141083a1de0aa925e64ed7a4ad8e71900fceef3"
        );
    }
}

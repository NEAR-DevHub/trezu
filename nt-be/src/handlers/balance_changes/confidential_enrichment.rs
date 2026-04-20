//! Goldsky enrichment helpers for confidential DAO outgoing legs.
//!
//! When a Goldsky outcome represents an `act_proposal` call that approved a
//! confidential (v1.signer) signing proposal, we can't observe the balance
//! change on-chain — confidential balances live in the 1Click system. Instead
//! we resolve the proposal's payload_hash, look up the matching quote stored
//! in `confidential_intents.quote_metadata`, and synthesize an outgoing
//! balance_change row from `quote.amountIn`.

use base64::Engine;
use bigdecimal::{BigDecimal, Zero};
use near_api::{AccountId, NetworkConfig};
use serde_json::{Value, json};
use sqlx::PgPool;

use super::counterparty::{convert_raw_to_decimal, ensure_ft_metadata};
use crate::handlers::proposals::scraper::{
    extract_payload_hash_from_kind, fetch_proposal_at_block,
};

/// Walk a serialized `Vec<ActionView>` and return the `proposal_id` argument
/// of the first `act_proposal` `FunctionCall`, whether top-level or nested in
/// a `Delegate` (meta-transaction).
pub fn extract_act_proposal_id_from_tx_actions(actions: &Value) -> Option<u64> {
    let arr = actions.as_array()?;

    let find_act_proposal_args = |func_call: &Value| -> Option<String> {
        if func_call.get("method_name")?.as_str()? != "act_proposal" {
            return None;
        }
        Some(func_call.get("args")?.as_str()?.to_string())
    };

    let args_b64 = arr
        .iter()
        .find_map(|a| a.get("FunctionCall").and_then(find_act_proposal_args))
        .or_else(|| {
            arr.iter().find_map(|a| {
                a.get("Delegate")?
                    .get("delegate_action")?
                    .get("actions")?
                    .as_array()?
                    .iter()
                    .find_map(|inner| inner.get("FunctionCall").and_then(find_act_proposal_args))
            })
        })?;

    let args_bytes = base64::engine::general_purpose::STANDARD
        .decode(&args_b64)
        .ok()?;
    let args: Value = serde_json::from_slice(&args_bytes).ok()?;
    args.get("id")?.as_u64()
}

/// Resolve the confidential payload_hash for an `act_proposal` outcome by:
/// 1. Extracting the `proposal_id` from the tx_status actions.
/// 2. Fetching the proposal from the DAO contract at the given block.
/// 3. Walking the proposal `kind` (v1.signer sign call) to the `payload_v2.Eddsa` hash.
///
/// Returns `None` if the outcome doesn't correspond to a confidential sign proposal.
pub async fn resolve_confidential_payload_hash(
    network: &NetworkConfig,
    dao_id: &str,
    block_height: u64,
    actions: &Value,
) -> Option<String> {
    let proposal_id = extract_act_proposal_id_from_tx_actions(actions)?;
    let dao: AccountId = dao_id.parse().ok()?;
    let proposal = fetch_proposal_at_block(network, &dao, proposal_id, block_height)
        .await
        .ok()?;
    extract_payload_hash_from_kind(&proposal.kind)
}

/// Synthesize an outgoing `balance_change` row for a confidential DAO's swap
/// based on the stored `confidential_intents.quote_metadata`.
///
/// Returns `Ok(true)` if a row was written, `Ok(false)` if no matching intent
/// record was found (caller should fall through to the normal pipeline).
#[allow(clippy::too_many_arguments)]
pub async fn handle_confidential_outgoing(
    app_pool: &PgPool,
    network: &NetworkConfig,
    dao_id: &str,
    payload_hash: &str,
    block_height: i64,
    block_timestamp_nanos: i64,
    block_time: chrono::DateTime<chrono::Utc>,
    transaction_hash: Option<String>,
    signer_id: Option<&str>,
) -> Result<bool, Box<dyn std::error::Error>> {
    let row = sqlx::query!(
        r#"
        SELECT quote_metadata, correlation_id
        FROM confidential_intents
        WHERE dao_id = $1 AND payload_hash = $2
        "#,
        dao_id,
        payload_hash,
    )
    .fetch_optional(app_pool)
    .await?;

    let Some(row) = row else {
        log::warn!(
            "[goldsky-enrichment] No confidential_intents row for dao={} payload_hash={}",
            dao_id,
            payload_hash
        );
        return Ok(false);
    };

    let Some(quote_metadata) = row.quote_metadata else {
        log::warn!(
            "[goldsky-enrichment] confidential_intents for dao={} payload_hash={} has no quote_metadata",
            dao_id,
            payload_hash
        );
        return Ok(false);
    };

    let origin_raw = quote_metadata
        .get("quoteRequest")
        .and_then(|q| q.get("originAsset"))
        .and_then(|v| v.as_str());
    let amount_in_raw = quote_metadata
        .get("quote")
        .and_then(|q| q.get("amountIn"))
        .and_then(|v| v.as_str());
    let (Some(origin_raw), Some(amount_in_raw)) = (origin_raw, amount_in_raw) else {
        log::warn!(
            "[goldsky-enrichment] quote_metadata for dao={} payload_hash={} missing originAsset or amountIn",
            dao_id,
            payload_hash
        );
        return Ok(false);
    };

    let storage_token_id = format!("intents.near:{}", origin_raw);
    let decimals = ensure_ft_metadata(app_pool, network, &storage_token_id).await?;
    let amount_in = convert_raw_to_decimal(amount_in_raw, decimals)?;

    let last_balance: Option<BigDecimal> = sqlx::query_scalar!(
        r#"
        SELECT balance_after
        FROM balance_changes
        WHERE account_id = $1 AND token_id = $2
        ORDER BY block_height DESC, id DESC
        LIMIT 1
        "#,
        dao_id,
        storage_token_id,
    )
    .fetch_optional(app_pool)
    .await?;

    let balance_before = last_balance.unwrap_or_else(|| amount_in.clone());
    let mut balance_after = &balance_before - &amount_in;
    if balance_after < BigDecimal::zero() {
        balance_after = BigDecimal::zero();
    }
    let amount = -amount_in.clone();

    let transaction_hashes: Vec<String> = transaction_hash.map(|h| vec![h]).unwrap_or_default();
    let raw_data = json!({
        "payload_hash": payload_hash,
        "correlation_id": row.correlation_id,
        "source": "goldsky+1click",
    });

    sqlx::query!(
        r#"
        INSERT INTO balance_changes
        (account_id, token_id, block_height, block_timestamp, block_time,
         amount, balance_before, balance_after,
         transaction_hashes, receipt_id, signer_id, receiver_id,
         counterparty, actions, raw_data, action_kind, method_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (account_id, block_height, token_id) DO UPDATE SET
          amount = EXCLUDED.amount,
          balance_before = EXCLUDED.balance_before,
          balance_after = EXCLUDED.balance_after,
          transaction_hashes = EXCLUDED.transaction_hashes,
          counterparty = EXCLUDED.counterparty,
          raw_data = EXCLUDED.raw_data,
          action_kind = EXCLUDED.action_kind,
          method_name = EXCLUDED.method_name,
          updated_at = NOW()
        "#,
        dao_id,
        storage_token_id,
        block_height,
        block_timestamp_nanos,
        block_time,
        amount,
        balance_before,
        balance_after,
        &transaction_hashes,
        &Vec::<String>::new() as &[String],
        signer_id,
        Some("v1.signer"),
        "intents-solver",
        json!({}),
        raw_data,
        "TRANSFER",
        Some("act_proposal"),
    )
    .execute(app_pool)
    .await?;

    log::info!(
        "[goldsky-enrichment] Confidential outgoing leg for {}/{} amount=-{} (payload_hash={})",
        dao_id,
        storage_token_id,
        amount_in,
        payload_hash,
    );

    Ok(true)
}

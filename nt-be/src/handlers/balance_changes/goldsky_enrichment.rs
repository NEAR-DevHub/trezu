//! Goldsky Enrichment Worker
//!
//! Reads indexed execution outcomes from the Neon database (Goldsky sink)
//! and writes enriched balance_changes records to the app database.
//!
//! Architecture:
//! - Neon DB (read-only): `indexed_dao_outcomes` populated by Goldsky pipeline
//! - App DB (read-write): `balance_changes` + `goldsky_cursors` for progress tracking
//!
//! Idempotent: uses INSERT ... ON CONFLICT DO UPDATE so replays overwrite
//! with potentially higher-quality data.

use super::balance::get_balance_change_at_block;
use super::counterparty::ensure_ft_metadata;
use super::transfer_hints::tx_resolver::resolve_transaction_blocks;
use super::utils::block_timestamp_to_datetime;
use near_api::NetworkConfig;
use serde::Deserialize;
use sqlx::PgPool;

// ---------------------------------------------------------------------------
// Neon row struct (runtime query — Neon DB is not managed by sqlx migrations)
// ---------------------------------------------------------------------------

#[derive(Debug, sqlx::FromRow)]
struct IndexedDaoOutcome {
    id: String,
    executor_id: String,
    logs: Option<String>,
    #[allow(dead_code)]
    status: Option<String>,
    transaction_hash: Option<String>,
    signer_id: Option<String>,
    receiver_id: Option<String>,
    #[allow(dead_code)]
    gas_burnt: Option<i64>,
    #[allow(dead_code)]
    tokens_burnt: Option<String>,
    trigger_block_height: i64,
    #[allow(dead_code)]
    trigger_block_hash: Option<String>,
    trigger_block_timestamp: i64, // milliseconds since epoch
}

// ---------------------------------------------------------------------------
// Parsed event
// ---------------------------------------------------------------------------

/// A single balance-affecting event parsed from an IndexedDaoOutcome.
/// One outcome can produce multiple ParsedEvents (Path A + Path B + Path C).
#[derive(Debug, Clone)]
struct ParsedEvent {
    account_id: String,
    token_id: String,
    counterparty: String,
    action_kind: Option<String>,
    #[allow(dead_code)]
    method_name: Option<String>,
    /// Path C events: trigger_block_height may be 2-3 blocks before the actual
    /// state change. When true, the enrichment loop scans forward to find the
    /// correct block.
    forward_scan: bool,
}

// ---------------------------------------------------------------------------
// Cursor management
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct Cursor {
    last_processed_id: String,
    last_processed_block: i64,
}

async fn get_cursor(
    app_pool: &PgPool,
    consumer_name: &str,
) -> Result<Cursor, Box<dyn std::error::Error>> {
    let row = sqlx::query_as::<_, (String, i64)>(
        "SELECT last_processed_id, last_processed_block FROM goldsky_cursors WHERE consumer_name = $1",
    )
    .bind(consumer_name)
    .fetch_optional(app_pool)
    .await?;

    match row {
        Some((id, block)) => Ok(Cursor {
            last_processed_id: id,
            last_processed_block: block,
        }),
        None => Ok(Cursor {
            last_processed_id: String::new(),
            last_processed_block: 0,
        }),
    }
}

async fn update_cursor(
    app_pool: &PgPool,
    consumer_name: &str,
    last_id: &str,
    last_block: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query(
        "INSERT INTO goldsky_cursors (consumer_name, last_processed_id, last_processed_block, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (consumer_name) DO UPDATE SET
           last_processed_id = EXCLUDED.last_processed_id,
           last_processed_block = EXCLUDED.last_processed_block,
           updated_at = NOW()",
    )
    .bind(consumer_name)
    .bind(last_id)
    .bind(last_block)
    .execute(app_pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Log parsing — EVENT_JSON structs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct EventJson {
    standard: String,
    #[serde(default)]
    event: String,
    #[serde(default)]
    data: Vec<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Event parsing (all local, no RPC)
// ---------------------------------------------------------------------------

/// Parse all balance-affecting events from a single IndexedDaoOutcome.
/// A single outcome can produce events from Path A (logs), Path B (receiver), and/or Path C (executor).
fn parse_outcome_events(outcome: &IndexedDaoOutcome) -> Vec<ParsedEvent> {
    let mut events = Vec::new();

    // Path A: Log-based events (logs mention sputnik-dao.near)
    if let Some(logs) = &outcome.logs {
        events.extend(parse_log_events(logs, &outcome.executor_id));
    }

    // Path B: Receiver-based events (receiver_id is a DAO)
    let receiver_is_dao = outcome
        .receiver_id
        .as_ref()
        .is_some_and(|r| r.ends_with(".sputnik-dao.near"));

    if receiver_is_dao {
        events.push(ParsedEvent {
            account_id: outcome.receiver_id.clone().unwrap(),
            token_id: "near".to_string(),
            counterparty: outcome
                .signer_id
                .clone()
                .unwrap_or_else(|| "UNKNOWN".to_string()),
            action_kind: None,
            method_name: None,
            forward_scan: false,
        });
    }

    // Path C: Executor-based events (DAO executes cross-contract call)
    // Captures add_proposal / act_proposal outcomes where the DAO is the executor
    // but the receipt is sent to another contract (e.g., olskik.near).
    // forward_scan=true because trigger_block_height is typically 2-3 blocks before
    // the actual NEAR state change (cross-shard receipt processing).
    if outcome.executor_id.ends_with(".sputnik-dao.near") && !receiver_is_dao {
        events.push(ParsedEvent {
            account_id: outcome.executor_id.clone(),
            token_id: "near".to_string(),
            counterparty: outcome
                .receiver_id
                .clone()
                .unwrap_or_else(|| "UNKNOWN".to_string()),
            action_kind: None,
            method_name: None,
            forward_scan: true,
        });
    }

    events
}

/// Parse log lines into events (Path A).
/// Handles NEP-141, NEP-245, and wrap.near plain-text formats.
fn parse_log_events(logs: &str, executor_id: &str) -> Vec<ParsedEvent> {
    let mut events = Vec::new();

    // Goldsky stores log line separators as literal "\n" (two chars: backslash + n),
    // not actual newline bytes. Handle both.
    for line in logs.split('\n').flat_map(|l| l.split("\\n")) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Only process lines that mention a sputnik-dao account
        if !line.contains("sputnik-dao.near") {
            continue;
        }

        if let Some(json_str) = line.strip_prefix("EVENT_JSON:") {
            // Parse EVENT_JSON (NEP-141 or NEP-245)
            if let Ok(event) = serde_json::from_str::<EventJson>(json_str) {
                match event.standard.as_str() {
                    "nep141" => {
                        events.extend(parse_nep141_event(&event, executor_id));
                    }
                    "nep245" => {
                        events.extend(parse_nep245_event(&event, executor_id));
                    }
                    _ => {
                        log::debug!(
                            "[goldsky-enrichment] Unknown event standard: {}",
                            event.standard
                        );
                    }
                }
            }
        } else {
            // Plain-text log (wrap.near style)
            events.extend(parse_plain_text_transfer(line, executor_id));
        }
    }

    events
}

/// Parse NEP-141 ft_transfer event.
fn parse_nep141_event(event: &EventJson, executor_id: &str) -> Vec<ParsedEvent> {
    let mut events = Vec::new();
    if event.event != "ft_transfer" {
        return events;
    }

    for datum in &event.data {
        let old_owner = datum.get("old_owner_id").and_then(|v| v.as_str());
        let new_owner = datum.get("new_owner_id").and_then(|v| v.as_str());

        if let (Some(old_owner), Some(new_owner)) = (old_owner, new_owner) {
            if old_owner.contains("sputnik-dao.near") {
                events.push(ParsedEvent {
                    account_id: old_owner.to_string(),
                    token_id: executor_id.to_string(),
                    counterparty: new_owner.to_string(),
                    action_kind: Some("TRANSFER".to_string()),
                    method_name: None,
                    forward_scan: false,
                });
            }
            if new_owner.contains("sputnik-dao.near") {
                events.push(ParsedEvent {
                    account_id: new_owner.to_string(),
                    token_id: executor_id.to_string(),
                    counterparty: old_owner.to_string(),
                    action_kind: Some("TRANSFER".to_string()),
                    method_name: None,
                    forward_scan: false,
                });
            }
        }
    }

    events
}

/// Parse NEP-245 mt_transfer event (intents).
fn parse_nep245_event(event: &EventJson, executor_id: &str) -> Vec<ParsedEvent> {
    let mut events = Vec::new();
    if event.event != "mt_transfer" {
        return events;
    }

    for datum in &event.data {
        let old_owner = datum.get("old_owner_id").and_then(|v| v.as_str());
        let new_owner = datum.get("new_owner_id").and_then(|v| v.as_str());
        let token_ids = datum.get("token_ids").and_then(|v| v.as_array());

        if let (Some(old_owner), Some(new_owner), Some(token_ids)) =
            (old_owner, new_owner, token_ids)
        {
            for token_value in token_ids {
                if let Some(token_id_str) = token_value.as_str() {
                    let full_token_id = format!("{}:{}", executor_id, token_id_str);

                    if old_owner.contains("sputnik-dao.near") {
                        events.push(ParsedEvent {
                            account_id: old_owner.to_string(),
                            token_id: full_token_id.clone(),
                            counterparty: new_owner.to_string(),
                            action_kind: Some("TRANSFER".to_string()),
                            method_name: None,
                            forward_scan: false,
                        });
                    }
                    if new_owner.contains("sputnik-dao.near") {
                        events.push(ParsedEvent {
                            account_id: new_owner.to_string(),
                            token_id: full_token_id,
                            counterparty: old_owner.to_string(),
                            action_kind: Some("TRANSFER".to_string()),
                            method_name: None,
                            forward_scan: false,
                        });
                    }
                }
            }
        }
    }

    events
}

/// Parse wrap.near plain-text transfer log.
/// Format: "Transfer NNN from alice.near to bob.sputnik-dao.near"
fn parse_plain_text_transfer(line: &str, executor_id: &str) -> Vec<ParsedEvent> {
    let mut events = Vec::new();

    if !line.starts_with("Transfer ") {
        return events;
    }

    // Parse: "Transfer <amount> from <sender> to <receiver>"
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 6 && parts[2] == "from" && parts[4] == "to" {
        let sender = parts[3];
        let receiver = parts[5];

        if sender.contains("sputnik-dao.near") {
            events.push(ParsedEvent {
                account_id: sender.to_string(),
                token_id: executor_id.to_string(),
                counterparty: receiver.to_string(),
                action_kind: Some("TRANSFER".to_string()),
                method_name: None,
                forward_scan: false,
            });
        }
        if receiver.contains("sputnik-dao.near") {
            events.push(ParsedEvent {
                account_id: receiver.to_string(),
                token_id: executor_id.to_string(),
                counterparty: sender.to_string(),
                action_kind: Some("TRANSFER".to_string()),
                method_name: None,
                forward_scan: false,
            });
        }
    }

    events
}

// ---------------------------------------------------------------------------
// Upsert to app DB
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn upsert_balance_change(
    app_pool: &PgPool,
    account_id: &str,
    token_id: &str,
    block_height: i64,
    block_timestamp_nanos: i64,
    block_time: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>,
    amount: &bigdecimal::BigDecimal,
    balance_before: &bigdecimal::BigDecimal,
    balance_after: &bigdecimal::BigDecimal,
    transaction_hashes: &[String],
    signer_id: Option<&str>,
    receiver_id: Option<&str>,
    counterparty: &str,
    action_kind: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
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
          signer_id = EXCLUDED.signer_id,
          receiver_id = EXCLUDED.receiver_id,
          counterparty = EXCLUDED.counterparty,
          action_kind = EXCLUDED.action_kind,
          method_name = EXCLUDED.method_name,
          updated_at = NOW()
        "#,
        account_id,
        token_id,
        block_height,
        block_timestamp_nanos,
        block_time,
        amount,
        balance_before,
        balance_after,
        transaction_hashes,
        &Vec::<String>::new() as &[String], // receipt_id — not available from Goldsky
        signer_id,
        receiver_id,
        counterparty,
        serde_json::json!({"source": "goldsky"}),
        serde_json::json!({}),
        action_kind,
        None::<String>, // method_name — not extracted yet
    )
    .execute(app_pool)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Main enrichment cycle
// ---------------------------------------------------------------------------

/// Fetch the set of monitored account IDs from the app DB.
async fn get_monitored_accounts(
    app_pool: &PgPool,
) -> Result<std::collections::HashSet<String>, Box<dyn std::error::Error>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT account_id FROM monitored_accounts WHERE enabled = true")
            .fetch_all(app_pool)
            .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Run one enrichment cycle: fetch unprocessed outcomes from Neon, enrich with RPC,
/// write to app DB.
///
/// Returns the number of outcomes processed (not the number of balance_changes written,
/// since one outcome can produce multiple events and some may be skipped).
pub async fn run_enrichment_cycle(
    neon_pool: &PgPool,
    app_pool: &PgPool,
    network: &NetworkConfig,
) -> Result<usize, Box<dyn std::error::Error>> {
    let consumer_name = "balance_enrichment";
    let cursor = get_cursor(app_pool, consumer_name).await?;

    // Only enrich accounts that are being monitored — avoids wasting RPC calls
    // on unmonitored DAOs (e.g., hot-dao produces thousands of outcomes)
    let monitored = get_monitored_accounts(app_pool).await?;

    // Fetch next batch from Neon (runtime query — Neon is not managed by sqlx migrations)
    let outcomes: Vec<IndexedDaoOutcome> = sqlx::query_as(
        "SELECT id, executor_id, logs, status, transaction_hash, signer_id, receiver_id,
                gas_burnt, tokens_burnt, trigger_block_height, trigger_block_hash, trigger_block_timestamp
         FROM indexed_dao_outcomes
         WHERE trigger_block_height > $1
            OR (trigger_block_height = $1 AND id > $2)
         ORDER BY trigger_block_height ASC, id ASC
         LIMIT 100",
    )
    .bind(cursor.last_processed_block)
    .bind(&cursor.last_processed_id)
    .fetch_all(neon_pool)
    .await?;

    if outcomes.is_empty() {
        return Ok(0);
    }

    let batch_size = outcomes.len();
    log::info!(
        "[goldsky-enrichment] Processing batch of {} outcomes (cursor: block={}, id={})",
        batch_size,
        cursor.last_processed_block,
        if cursor.last_processed_id.is_empty() {
            "<start>"
        } else {
            &cursor.last_processed_id
        },
    );

    let mut last_processed_id = cursor.last_processed_id.clone();
    let mut last_processed_block = cursor.last_processed_block;

    for outcome in &outcomes {
        let events = parse_outcome_events(outcome);

        if events.is_empty() {
            // No balance-affecting events parsed — still advance cursor
            last_processed_id = outcome.id.clone();
            last_processed_block = outcome.trigger_block_height;
            continue;
        }

        // Timestamp conversion: Goldsky ms → balance_changes nanos
        let block_timestamp_nanos = outcome.trigger_block_timestamp * 1_000_000;
        let block_time = block_timestamp_to_datetime(block_timestamp_nanos);
        let block_height = outcome.trigger_block_height as u64;

        // Cache tx_status resolution per outcome to avoid redundant RPC calls
        // when one outcome produces multiple FT events.
        let mut resolved_ft_blocks: std::collections::HashMap<String, Option<u64>> =
            std::collections::HashMap::new();

        for event in &events {
            // Skip unmonitored accounts — no point calling RPC for accounts nobody tracks
            if !monitored.contains(&event.account_id) {
                continue;
            }

            // Ensure FT metadata is cached (needed for decimal conversion in RPC balance queries)
            if event.token_id != "near"
                && event.token_id != "NEAR"
                && !event.token_id.contains(':')
                && let Err(e) = ensure_ft_metadata(app_pool, network, &event.token_id).await
            {
                log::warn!(
                    "[goldsky-enrichment] Failed to ensure FT metadata for {}: {} — skipping",
                    event.token_id,
                    e
                );
                continue;
            }

            // For FT events, trigger_block_height is the transaction block, but the actual
            // FT balance change happens in a later block (NEAR cross-shard receipt processing).
            // Use experimental_tx_status to find the block where the FT contract executed the receipt.
            let query_block = if event.token_id != "near"
                && event.token_id != "NEAR"
                && outcome.transaction_hash.is_some()
                && outcome.signer_id.is_some()
            {
                // Find receipts that executed on the FT contract (where balance actually changes)
                let ft_contract = if event.token_id.contains(':') {
                    // Intents token: executor is intents.near, not the underlying FT contract
                    event.token_id.split(':').next().unwrap_or(&event.token_id)
                } else {
                    &event.token_id
                };

                // Use cached result if we already resolved this FT contract for this outcome
                if let Some(cached) = resolved_ft_blocks.get(ft_contract) {
                    cached.unwrap_or(block_height)
                } else {
                    let tx_hash = outcome.transaction_hash.as_ref().unwrap();
                    let signer = outcome.signer_id.as_ref().unwrap();
                    let resolved_block = match resolve_transaction_blocks(
                        network, tx_hash, ft_contract, signer,
                    )
                    .await
                    {
                        Ok(resolved) if !resolved.receipt_blocks.is_empty() => {
                            let receipt_block = resolved
                                .receipt_blocks
                                .iter()
                                .map(|rb| rb.block_height)
                                .max()
                                .unwrap();
                            log::debug!(
                                "[goldsky-enrichment] Resolved FT receipt block {} for tx {} (trigger was {})",
                                receipt_block,
                                tx_hash,
                                block_height,
                            );
                            Some(receipt_block)
                        }
                        Ok(_) => {
                            log::debug!(
                                "[goldsky-enrichment] No receipts on {} for tx {} — using trigger block {}",
                                ft_contract,
                                tx_hash,
                                block_height,
                            );
                            None
                        }
                        Err(e) => {
                            log::warn!(
                                "[goldsky-enrichment] Failed to resolve tx {} for {}: {} — using trigger block {}",
                                tx_hash,
                                event.token_id,
                                e,
                                block_height,
                            );
                            None
                        }
                    };
                    resolved_ft_blocks.insert(ft_contract.to_string(), resolved_block);
                    resolved_block.unwrap_or(block_height)
                }
            } else {
                // NEAR token or no tx hash — trigger_block_height is correct
                block_height
            };

            // RPC: get balance before and after
            let (mut balance_before, mut balance_after) = match get_balance_change_at_block(
                app_pool,
                network,
                &event.account_id,
                &event.token_id,
                query_block,
            )
            .await
            {
                Ok(result) => result,
                Err(e) => {
                    log::warn!(
                        "[goldsky-enrichment] RPC error for {}/{} at block {}: {} — skipping",
                        event.account_id,
                        event.token_id,
                        query_block,
                        e
                    );
                    continue;
                }
            };

            // Path C forward scan: trigger_block_height for executor_id outcomes
            // is typically 2-3 blocks before the actual NEAR state change (cross-shard
            // receipt processing). Scan forward to find the correct block.
            let mut actual_block = block_height;
            if event.forward_scan && balance_before == balance_after {
                for offset in 1..=10u64 {
                    match get_balance_change_at_block(
                        app_pool,
                        network,
                        &event.account_id,
                        &event.token_id,
                        query_block + offset,
                    )
                    .await
                    {
                        Ok((fb, fa)) if fb != fa => {
                            log::info!(
                                "[goldsky-enrichment] Forward scan: {}/{} balance changed at block {} (trigger was {})",
                                event.account_id,
                                event.token_id,
                                query_block + offset,
                                query_block,
                            );
                            balance_before = fb;
                            balance_after = fa;
                            actual_block = query_block + offset;
                            break;
                        }
                        Ok(_) => continue,
                        Err(_) => break,
                    }
                }
            }

            let amount = &balance_after - &balance_before;

            let transaction_hashes: Vec<String> = outcome
                .transaction_hash
                .as_ref()
                .map(|h| vec![h.clone()])
                .unwrap_or_default();

            if let Err(e) = upsert_balance_change(
                app_pool,
                &event.account_id,
                &event.token_id,
                actual_block as i64,
                block_timestamp_nanos,
                block_time,
                &amount,
                &balance_before,
                &balance_after,
                &transaction_hashes,
                outcome.signer_id.as_deref(),
                outcome.receiver_id.as_deref(),
                &event.counterparty,
                event.action_kind.as_deref(),
            )
            .await
            {
                log::error!(
                    "[goldsky-enrichment] Failed to upsert {}/{} at block {}: {}",
                    event.account_id,
                    event.token_id,
                    block_height,
                    e
                );
            }
        }

        // Advance cursor after each outcome (even if some events failed)
        last_processed_id = outcome.id.clone();
        last_processed_block = outcome.trigger_block_height;
    }

    // Persist cursor in app DB
    update_cursor(
        app_pool,
        consumer_name,
        &last_processed_id,
        last_processed_block,
    )
    .await?;

    log::info!(
        "[goldsky-enrichment] Batch complete: {} outcomes, cursor now at block={}, id={}",
        batch_size,
        last_processed_block,
        last_processed_id,
    );

    Ok(batch_size)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_nep141_ft_transfer_to_dao() {
        let logs = r#"EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{"old_owner_id":"alice.near","new_owner_id":"treasury.sputnik-dao.near","amount":"1000000"}]}"#;
        let events = parse_log_events(logs, "usdc.near");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].token_id, "usdc.near");
        assert_eq!(events[0].counterparty, "alice.near");
    }

    #[test]
    fn test_parse_nep141_ft_transfer_from_dao() {
        let logs = r#"EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{"old_owner_id":"treasury.sputnik-dao.near","new_owner_id":"bob.near","amount":"5000000"}]}"#;
        let events = parse_log_events(logs, "usdc.near");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].token_id, "usdc.near");
        assert_eq!(events[0].counterparty, "bob.near");
    }

    #[test]
    fn test_parse_nep245_mt_transfer() {
        let logs = r#"EVENT_JSON:{"standard":"nep245","event":"mt_transfer","data":[{"old_owner_id":"solver.near","new_owner_id":"treasury.sputnik-dao.near","token_ids":["nep141:wrap.near"],"amounts":["100"]}]}"#;
        let events = parse_log_events(logs, "intents.near");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].token_id, "intents.near:nep141:wrap.near");
        assert_eq!(events[0].counterparty, "solver.near");
    }

    #[test]
    fn test_parse_wrap_near_plain_text() {
        let logs = "Transfer 100000000000000000000000 from alice.near to treasury.sputnik-dao.near";
        let events = parse_log_events(logs, "wrap.near");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].token_id, "wrap.near");
        assert_eq!(events[0].counterparty, "alice.near");
    }

    #[test]
    fn test_parse_wrap_near_plain_text_from_dao() {
        let logs = "Transfer 100000000000000000000000 from treasury.sputnik-dao.near to alice.near";
        let events = parse_log_events(logs, "wrap.near");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].token_id, "wrap.near");
        assert_eq!(events[0].counterparty, "alice.near");
    }

    #[test]
    fn test_parse_outcome_both_paths() {
        let outcome = IndexedDaoOutcome {
            id: "test-id".to_string(),
            executor_id: "usdc.near".to_string(),
            logs: Some(
                r#"EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{"old_owner_id":"alice.near","new_owner_id":"treasury.sputnik-dao.near","amount":"1000000"}]}"#
                    .to_string(),
            ),
            status: Some("SuccessValue".to_string()),
            transaction_hash: Some("abc123".to_string()),
            signer_id: Some("alice.near".to_string()),
            receiver_id: Some("treasury.sputnik-dao.near".to_string()),
            gas_burnt: Some(1000),
            tokens_burnt: Some("100".to_string()),
            trigger_block_height: 180000000,
            trigger_block_hash: Some("hash".to_string()),
            trigger_block_timestamp: 1709000000000,
        };

        let events = parse_outcome_events(&outcome);
        // Path A (FT log) + Path B (receiver is DAO)
        assert_eq!(events.len(), 2);

        // Path A event
        assert_eq!(events[0].token_id, "usdc.near");
        assert_eq!(events[0].counterparty, "alice.near");

        // Path B event
        assert_eq!(events[1].token_id, "near");
        assert_eq!(events[1].counterparty, "alice.near");
    }

    #[test]
    fn test_parse_receiver_only_path_b() {
        let outcome = IndexedDaoOutcome {
            id: "test-id-2".to_string(),
            executor_id: "system".to_string(),
            logs: None,
            status: Some("SuccessValue".to_string()),
            transaction_hash: Some("tx123".to_string()),
            signer_id: Some("bob.near".to_string()),
            receiver_id: Some("treasury.sputnik-dao.near".to_string()),
            gas_burnt: Some(500),
            tokens_burnt: Some("50".to_string()),
            trigger_block_height: 180000001,
            trigger_block_hash: Some("hash2".to_string()),
            trigger_block_timestamp: 1709000001000,
        };

        let events = parse_outcome_events(&outcome);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].token_id, "near");
        assert_eq!(events[0].counterparty, "bob.near");
    }

    #[test]
    fn test_parse_irrelevant_log_skipped() {
        let logs = r#"EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{"old_owner_id":"alice.near","new_owner_id":"bob.near","amount":"100"}]}"#;
        let events = parse_log_events(logs, "usdc.near");
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_parse_multiple_log_lines() {
        let logs = "Some irrelevant log\nTransfer 100 from alice.near to treasury.sputnik-dao.near\nAnother log";
        let events = parse_log_events(logs, "wrap.near");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
    }

    #[test]
    fn test_parse_non_dao_receiver_no_path_b() {
        let outcome = IndexedDaoOutcome {
            id: "test-id-3".to_string(),
            executor_id: "usdc.near".to_string(),
            logs: Some(
                r#"EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{"old_owner_id":"alice.near","new_owner_id":"treasury.sputnik-dao.near","amount":"100"}]}"#
                    .to_string(),
            ),
            status: Some("SuccessValue".to_string()),
            transaction_hash: Some("tx456".to_string()),
            signer_id: Some("alice.near".to_string()),
            receiver_id: Some("usdc.near".to_string()), // NOT a DAO
            gas_burnt: Some(500),
            tokens_burnt: Some("50".to_string()),
            trigger_block_height: 180000002,
            trigger_block_hash: Some("hash3".to_string()),
            trigger_block_timestamp: 1709000002000,
        };

        let events = parse_outcome_events(&outcome);
        // Only Path A, no Path B
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].token_id, "usdc.near");
    }

    #[test]
    fn test_timestamp_conversion() {
        let goldsky_ms: i64 = 1709000000000;
        let nanos = goldsky_ms * 1_000_000;
        assert_eq!(nanos, 1709000000000000000);

        let dt = block_timestamp_to_datetime(nanos);
        assert_eq!(dt.timestamp(), 1709000000);
    }

    #[test]
    fn test_parse_nep141_both_parties_are_daos() {
        // Transfer between two DAOs — should produce 2 events
        let logs = r#"EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{"old_owner_id":"dao-a.sputnik-dao.near","new_owner_id":"dao-b.sputnik-dao.near","amount":"100"}]}"#;
        let events = parse_log_events(logs, "usdc.near");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].account_id, "dao-a.sputnik-dao.near");
        assert_eq!(events[0].counterparty, "dao-b.sputnik-dao.near");
        assert_eq!(events[1].account_id, "dao-b.sputnik-dao.near");
        assert_eq!(events[1].counterparty, "dao-a.sputnik-dao.near");
    }

    #[test]
    fn test_parse_empty_logs() {
        let events = parse_log_events("", "usdc.near");
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_parse_nep141_non_transfer_event_skipped() {
        let logs = r#"EVENT_JSON:{"standard":"nep141","event":"ft_mint","data":[{"owner_id":"treasury.sputnik-dao.near","amount":"1000"}]}"#;
        let events = parse_log_events(logs, "usdc.near");
        // ft_mint is not ft_transfer — currently skipped
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_parse_literal_backslash_n_separator() {
        // Goldsky stores log separators as literal "\n" (backslash + n), not real newlines
        let logs = r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint","data":[{"owner_id":"hot-dao.sputnik-dao.near","token_ids":["137_abc"],"amounts":["142"]}]}\nEVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_transfer","data":[{"old_owner_id":"hot-dao.sputnik-dao.near","new_owner_id":"intents.near","token_ids":["137_abc"],"amounts":["142"]}]}"#;
        let events = parse_log_events(logs, "v2_1.omni.hot.tg");
        // mt_mint is skipped, mt_transfer produces 1 event (old_owner is DAO)
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "hot-dao.sputnik-dao.near");
        assert_eq!(events[0].token_id, "v2_1.omni.hot.tg:137_abc");
        assert_eq!(events[0].counterparty, "intents.near");
    }

    #[test]
    fn test_parse_executor_only_path_c() {
        // executor_id is a DAO, receiver_id is NOT — Path C fires
        let outcome = IndexedDaoOutcome {
            id: "test-path-c".to_string(),
            executor_id: "treasury.sputnik-dao.near".to_string(),
            logs: None,
            status: Some("{\"SuccessValue\":\"NDg=\"}".to_string()),
            transaction_hash: Some("tx789".to_string()),
            signer_id: Some("sponsor.trezu.near".to_string()),
            receiver_id: Some("olskik.near".to_string()),
            gas_burnt: Some(1000),
            tokens_burnt: Some("100".to_string()),
            trigger_block_height: 188066404,
            trigger_block_hash: Some("hash".to_string()),
            trigger_block_timestamp: 1772623617359,
        };

        let events = parse_outcome_events(&outcome);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].token_id, "near");
        assert_eq!(events[0].counterparty, "olskik.near");
    }

    #[test]
    fn test_parse_executor_and_receiver_both_dao() {
        // Both executor_id and receiver_id are DAOs — only Path B, no Path C duplicate
        let outcome = IndexedDaoOutcome {
            id: "test-both-dao".to_string(),
            executor_id: "treasury.sputnik-dao.near".to_string(),
            logs: None,
            status: Some("{\"SuccessValue\":\"\"}".to_string()),
            transaction_hash: Some("tx-both".to_string()),
            signer_id: Some("sponsor.trezu.near".to_string()),
            receiver_id: Some("treasury.sputnik-dao.near".to_string()),
            gas_burnt: Some(500),
            tokens_burnt: Some("50".to_string()),
            trigger_block_height: 188066398,
            trigger_block_hash: Some("hash2".to_string()),
            trigger_block_timestamp: 1772623613898,
        };

        let events = parse_outcome_events(&outcome);
        // Only Path B fires (receiver is DAO), Path C skipped
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].token_id, "near");
        assert_eq!(events[0].counterparty, "sponsor.trezu.near");
    }

    #[test]
    fn test_parse_path_a_and_path_c() {
        // Executor is a DAO, receiver is NOT a DAO, and logs mention the DAO.
        // Path A fires (log event) + Path C fires (executor is DAO, receiver isn't).
        // Path B does NOT fire (receiver isn't a DAO).
        let outcome = IndexedDaoOutcome {
            id: "test-a-and-c".to_string(),
            executor_id: "treasury.sputnik-dao.near".to_string(),
            logs: Some(
                r#"EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{"old_owner_id":"treasury.sputnik-dao.near","new_owner_id":"alice.near","amount":"100"}]}"#
                    .to_string(),
            ),
            status: Some("{\"SuccessValue\":\"\"}".to_string()),
            transaction_hash: Some("tx-ac".to_string()),
            signer_id: Some("sponsor.trezu.near".to_string()),
            receiver_id: Some("usdc.near".to_string()),
            gas_burnt: Some(1000),
            tokens_burnt: Some("100".to_string()),
            trigger_block_height: 188000000,
            trigger_block_hash: Some("hash3".to_string()),
            trigger_block_timestamp: 1772600000000,
        };

        let events = parse_outcome_events(&outcome);
        assert_eq!(events.len(), 2);
        // Path A: FT transfer from treasury DAO
        assert_eq!(events[0].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].token_id, "treasury.sputnik-dao.near");
        assert_eq!(events[0].counterparty, "alice.near");
        // Path C: executor DAO gets NEAR event
        assert_eq!(events[1].account_id, "treasury.sputnik-dao.near");
        assert_eq!(events[1].token_id, "near");
        assert_eq!(events[1].counterparty, "usdc.near");
    }
}

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};

use crate::AppState;
use crate::handlers::intents::swap_status::{FullSwapStatusResponse, fetch_public_swap_status};
use crate::handlers::public_history::quotes::{
    QuoteProposalType, merge_quote_status, proposal_quote_from_metadata, quote_status_is_failed,
    quote_status_is_terminal, quote_status_text_from_metadata, quote_status_value_from_metadata,
};
use crate::handlers::public_history::silver::cursors::mark_silver_dirty_tx;

const QUOTE_REFRESH_BATCH_SIZE: i64 = 50;

#[derive(Debug, Clone, sqlx::FromRow)]
struct StaleQuoteProposal {
    dao_id: String,
    proposal_id: i64,
    quote_deposit_address: String,
    quote_metadata: Option<Value>,
    proposal_created_at: Option<DateTime<Utc>>,
    proposal_executed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default)]
pub struct QuoteRefreshStats {
    pub claimed: usize,
    pub updated: u64,
    pub fetch_failed: usize,
}

async fn claim_stale_quote_proposals(
    pool: &PgPool,
) -> Result<Vec<StaleQuoteProposal>, sqlx::Error> {
    sqlx::query_as::<_, StaleQuoteProposal>(
        r#"
        UPDATE dao_proposals
        SET quote_status_checked_at = NOW()
        WHERE id IN (
            SELECT id
            FROM dao_proposals
            WHERE quote_deposit_address IS NOT NULL
              AND COALESCE(proposal_executed_at, proposal_created_at) > NOW() - INTERVAL '30 days'
              AND (
                  quote_status_checked_at IS NULL
                  OR quote_status_checked_at < NOW() - INTERVAL '2 minutes'
              )
              AND (
                  quote_metadata IS NULL
                  OR COALESCE(
                      UPPER(quote_metadata->'status'->>'status'),
                      UPPER(quote_metadata->>'status')
                  ) IS NULL
                  OR COALESCE(
                      UPPER(quote_metadata->'status'->>'status'),
                      UPPER(quote_metadata->>'status')
                  ) NOT IN ('SUCCESS', 'FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT')
              )
            ORDER BY COALESCE(proposal_executed_at, proposal_created_at) DESC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING
            dao_id,
            proposal_id,
            quote_deposit_address,
            quote_metadata,
            proposal_created_at,
            proposal_executed_at
        "#,
    )
    .bind(QUOTE_REFRESH_BATCH_SIZE)
    .fetch_all(pool)
    .await
}

/// Returns the merged metadata when a new status was written (`None` when the
/// write was skipped), so the caller can see terminal-failure transitions.
async fn apply_quote_status(
    tx: &mut Transaction<'_, Postgres>,
    proposal: &StaleQuoteProposal,
    status: Value,
) -> Result<Option<Value>, sqlx::Error> {
    // The claim lock is released before the 1Click fetch, so the linker may
    // have merged newer metadata meanwhile; reload under lock and merge
    // against the current value, never regressing a terminal status.
    let current: Option<Value> = sqlx::query_scalar(
        r#"
        SELECT quote_metadata
        FROM dao_proposals
        WHERE dao_id = $1
          AND proposal_id = $2
        FOR UPDATE
        "#,
    )
    .bind(&proposal.dao_id)
    .bind(proposal.proposal_id)
    .fetch_optional(&mut **tx)
    .await?
    .flatten();

    if quote_status_is_terminal(current.as_ref()) {
        return Ok(None);
    }
    if quote_status_value_from_metadata(current.as_ref()) == Some(&status) {
        return Ok(None);
    }

    let merged = merge_quote_status(current.as_ref(), status);
    let updated = sqlx::query(
        r#"
        UPDATE dao_proposals
        SET quote_metadata = $3,
            quote_status_checked_at = NOW(),
            updated_at = NOW()
        WHERE dao_id = $1
          AND proposal_id = $2
        "#,
    )
    .bind(&proposal.dao_id)
    .bind(proposal.proposal_id)
    .bind(&merged)
    .execute(&mut **tx)
    .await?
    .rows_affected();

    if updated > 0 {
        mark_silver_dirty_tx(
            tx,
            &proposal.dao_id,
            proposal
                .proposal_executed_at
                .or(proposal.proposal_created_at),
        )
        .await?;
        return Ok(Some(merged));
    }

    Ok(None)
}

/// Report the transition into a terminal failed 1Click status — a user's
/// exchange or cross-chain payment permanently failing. Edge-triggered:
/// `apply_quote_status` never rewrites a terminal status, so this fires
/// exactly once per proposal. Routed to Telegram by a Sentry alert rule on
/// `alert_priority:p1`.
fn report_terminal_failure(proposal: &StaleQuoteProposal, merged: &Value) {
    if !quote_status_is_failed(Some(merged)) {
        return;
    }

    let code = match proposal_quote_from_metadata(Some(merged)).map(|q| q.quote_type) {
        Some(QuoteProposalType::PaymentTransfer) => {
            crate::error_event::ErrorCode::PaymentTerminalFailed
        }
        _ => crate::error_event::ErrorCode::ExchangeTerminalFailed,
    };
    let status_text =
        quote_status_text_from_metadata(Some(merged)).unwrap_or_else(|| "failed".to_string());

    crate::error_event!(
        code,
        dao_id = proposal.dao_id,
        proposal_id = proposal.proposal_id,
        deposit_address = proposal.quote_deposit_address,
        status = status_text
    );
}

pub async fn refresh_public_quote_statuses(
    state: &AppState,
) -> Result<QuoteRefreshStats, sqlx::Error> {
    let proposals = claim_stale_quote_proposals(&state.db_pool).await?;
    let mut stats = QuoteRefreshStats {
        claimed: proposals.len(),
        ..QuoteRefreshStats::default()
    };

    for proposal in proposals {
        if quote_status_is_terminal(proposal.quote_metadata.as_ref()) {
            continue;
        }
        match fetch_public_swap_status(
            &state.http_client,
            &state.env_vars.oneclick_api_url,
            state.env_vars.oneclick_jwt_token.as_ref(),
            &proposal.quote_deposit_address,
            None,
        )
        .await
        {
            Ok(response) => {
                if let Ok(status) = serde_json::to_value(response) {
                    let mut tx = state.db_pool.begin().await?;
                    let merged = apply_quote_status(&mut tx, &proposal, status).await?;
                    tx.commit().await?;
                    if let Some(merged) = merged {
                        stats.updated += 1;
                        report_terminal_failure(&proposal, &merged);
                    }
                }
            }
            Err((status, reason)) => {
                stats.fetch_failed += 1;
                tracing::warn!(
                    dao_id = proposal.dao_id,
                    proposal_id = proposal.proposal_id,
                    deposit_address = proposal.quote_deposit_address,
                    status = %status,
                    reason = %reason,
                    "failed to refresh public quote status"
                );
            }
        }
    }

    Ok(stats)
}

/// Record a settled 1Click outcome the live swap-status endpoint fetched for a
/// public swap. The refresher stops polling proposals older than 30 days, so
/// a row whose status went stale before 1Click settled it is only ever
/// looked at again when a viewer opens it; this writes that answer back so
/// the next list load buckets the request from the stored status, like every
/// other swap. Only terminal statuses are recorded: an in-flight one brings
/// nothing the refresher would not write itself while it still covers the
/// row.
pub async fn record_settled_quote_status(
    pool: &PgPool,
    dao_id: &str,
    deposit_address: &str,
    response: &FullSwapStatusResponse,
) -> Result<bool, sqlx::Error> {
    if !response.status.is_terminal() {
        return Ok(false);
    }
    let Some(proposal) = sqlx::query_as::<_, StaleQuoteProposal>(
        r#"
        SELECT dao_id, proposal_id, quote_deposit_address, quote_metadata,
               proposal_created_at, proposal_executed_at
        FROM dao_proposals
        WHERE dao_id = $1
          AND quote_deposit_address = $2
        ORDER BY proposal_id DESC
        LIMIT 1
        "#,
    )
    .bind(dao_id)
    .bind(deposit_address)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(false);
    };
    if quote_status_is_terminal(proposal.quote_metadata.as_ref()) {
        return Ok(false);
    }
    let Ok(status) = serde_json::to_value(response) else {
        return Ok(false);
    };
    let mut tx = pool.begin().await?;
    let merged = apply_quote_status(&mut tx, &proposal, status).await?;
    tx.commit().await?;
    match merged {
        Some(merged) => {
            report_terminal_failure(&proposal, &merged);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::intents::swap_status::SwapStatus;
    use serde_json::json;

    const DAO_ID: &str = "qa-stage.sputnik-dao.near";
    const DEPOSIT_ADDRESS: &str = "deposit-7";

    fn response(status: SwapStatus) -> FullSwapStatusResponse {
        serde_json::from_value(json!({
            "status": status,
            "updatedAt": "2026-10-19T00:00:00Z",
            "quoteResponse": null,
            "swapDetails": null
        }))
        .expect("status response")
    }

    async fn seed(pool: &PgPool, quote_metadata: Value) {
        sqlx::query(
            r#"
            INSERT INTO dao_proposals (dao_id, proposal_id, status, quote_deposit_address, quote_metadata,
                                       proposal_executed_at)
            VALUES ($1, 7, 'approved', $2, $3, NOW() - INTERVAL '90 days')
            "#,
        )
        .bind(DAO_ID)
        .bind(DEPOSIT_ADDRESS)
        .bind(quote_metadata)
        .execute(pool)
        .await
        .expect("seed dao_proposals");
    }

    async fn stored_status(pool: &PgPool) -> Option<String> {
        let metadata: Option<Value> = sqlx::query_scalar(
            "SELECT quote_metadata FROM dao_proposals WHERE dao_id = $1 AND proposal_id = 7",
        )
        .bind(DAO_ID)
        .fetch_one(pool)
        .await
        .expect("row");
        quote_status_text_from_metadata(metadata.as_ref())
    }

    #[sqlx::test]
    async fn settled_live_status_is_written_over_a_stale_in_flight_one(pool: PgPool) {
        seed(
            &pool,
            json!({ "proposalQuote": {}, "status": { "status": "PROCESSING" } }),
        )
        .await;

        // Still in flight: nothing to record.
        assert!(
            !record_settled_quote_status(
                &pool,
                DAO_ID,
                DEPOSIT_ADDRESS,
                &response(SwapStatus::Processing)
            )
            .await
            .expect("record")
        );
        assert_eq!(stored_status(&pool).await.as_deref(), Some("processing"));

        assert!(
            record_settled_quote_status(
                &pool,
                DAO_ID,
                DEPOSIT_ADDRESS,
                &response(SwapStatus::Failed)
            )
            .await
            .expect("record")
        );
        assert_eq!(stored_status(&pool).await.as_deref(), Some("failed"));

        // Terminal statuses are never rewritten, and unknown addresses are a no-op.
        assert!(
            !record_settled_quote_status(
                &pool,
                DAO_ID,
                DEPOSIT_ADDRESS,
                &response(SwapStatus::Success)
            )
            .await
            .expect("record")
        );
        assert_eq!(stored_status(&pool).await.as_deref(), Some("failed"));
        assert!(
            !record_settled_quote_status(
                &pool,
                DAO_ID,
                "unknown-address",
                &response(SwapStatus::Success)
            )
            .await
            .expect("record")
        );
    }
}

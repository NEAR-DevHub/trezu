//! Persisted 1Click outcome of the swap an approved intents-routed request
//! paid for.
//!
//! The outcome is owned by the pipelines that already track it — the quote
//! refresher keeps `dao_proposals.quote_metadata` current for public swaps,
//! and the confidential ingest worker keeps `bronze_confidential_history_events`
//! and the submit queue on `confidential_intents` current for confidential
//! ones. This lookup only reads those tables, so a list request never calls
//! 1Click and every surface (tab buckets, status pills, the details banner)
//! derives from the same stored value.

use std::collections::HashMap;

use sqlx::PgPool;

use crate::handlers::intents::swap_status::{SwapStatus, resolve_confidential_swap_status};
use crate::handlers::proposals::scraper::{
    Proposal, ProposalStatus, extract_payload_hash_from_kind,
};

#[derive(sqlx::FromRow)]
struct SwapStatusRow {
    /// `dao_proposals.proposal_id` as text for public swaps, the intent's
    /// payload hash for confidential ones.
    proposal_ref: String,
    confidential: bool,
    /// Latest 1Click status on record; `None` until one is ingested.
    status: Option<String>,
    /// The submit queue retired the intent (never handed to 1Click).
    intent_failed: bool,
}

pub struct SwapStatusLookup<'a> {
    pool: &'a PgPool,
    dao_id: &'a str,
}

impl<'a> SwapStatusLookup<'a> {
    pub fn new(pool: &'a PgPool, dao_id: &'a str) -> Self {
        Self { pool, dao_id }
    }

    /// Stamp `swap_status` on every approved proposal that has a persisted
    /// outcome. Proposals without one are left untouched: either they are not
    /// intents-routed, or the outcome has not been ingested yet.
    pub async fn attach(&self, proposals: &mut [Proposal]) -> Result<(), sqlx::Error> {
        let approved: Vec<&Proposal> = proposals
            .iter()
            .filter(|proposal| proposal.status == ProposalStatus::Approved)
            .collect();
        let proposal_ids: Vec<i64> = approved
            .iter()
            .filter_map(|proposal| i64::try_from(proposal.id).ok())
            .collect();
        // Confidential requests are keyed by the payload hash signed on-chain,
        // the same key the confidential enrichment uses. It is always present,
        // whereas `confidential_intents.proposal_id` is only stamped later by
        // the public-history linker.
        let id_by_payload_hash: HashMap<String, u64> = approved
            .iter()
            .filter_map(|proposal| {
                extract_payload_hash_from_kind(&proposal.kind).map(|hash| (hash, proposal.id))
            })
            .collect();
        if proposal_ids.is_empty() && id_by_payload_hash.is_empty() {
            return Ok(());
        }

        let payload_hashes: Vec<&str> = id_by_payload_hash.keys().map(String::as_str).collect();
        let statuses = self
            .statuses_for(&proposal_ids, &payload_hashes, &id_by_payload_hash)
            .await?;
        for proposal in proposals.iter_mut() {
            if let Some(status) = statuses.get(&proposal.id) {
                proposal.swap_status = Some(*status);
            }
        }
        Ok(())
    }

    /// One round trip over both sources. The public status path mirrors the
    /// quote refresher's claim query (1Click's raw response or the
    /// `{proposalQuote, status}` envelope); the confidential path mirrors
    /// `fetch_confidential_swap_status` (latest bronze row per deposit
    /// address, plus the intent row the submit queue may have retired).
    async fn statuses_for(
        &self,
        proposal_ids: &[i64],
        payload_hashes: &[&str],
        id_by_payload_hash: &HashMap<String, u64>,
    ) -> Result<HashMap<u64, SwapStatus>, sqlx::Error> {
        let rows = sqlx::query_as::<_, SwapStatusRow>(
            r#"
            SELECT
                dp.proposal_id::text AS proposal_ref,
                FALSE AS confidential,
                COALESCE(
                    dp.quote_metadata->'status'->>'status',
                    dp.quote_metadata->>'status'
                ) AS status,
                FALSE AS intent_failed
            FROM dao_proposals dp
            WHERE dp.dao_id = $1
              AND dp.proposal_id = ANY($2)
              AND dp.quote_deposit_address IS NOT NULL

            UNION ALL

            SELECT
                ci.payload_hash AS proposal_ref,
                TRUE AS confidential,
                he.status,
                ci.status = 'failed' AS intent_failed
            FROM confidential_intents ci
            LEFT JOIN LATERAL (
                SELECT status
                FROM bronze_confidential_history_events
                WHERE account_id = ci.dao_id
                  AND deposit_address = ci.deposit_address
                ORDER BY created_at_external DESC
                LIMIT 1
            ) he ON TRUE
            WHERE ci.dao_id = $1
              AND ci.payload_hash = ANY($3)
            "#,
        )
        .bind(self.dao_id)
        .bind(proposal_ids)
        .bind(payload_hashes)
        .fetch_all(self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let proposal_id = if row.confidential {
                    id_by_payload_hash.get(&row.proposal_ref).copied()?
                } else {
                    row.proposal_ref.parse::<u64>().ok()?
                };
                let status =
                    resolve_confidential_swap_status(row.status.as_deref(), row.intent_failed)?;
                Some((proposal_id, status))
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use near_api::types::json::U64;
    use serde_json::json;

    const DAO_ID: &str = "qa-stage.sputnik-dao.near";

    fn proposal(id: u64, status: ProposalStatus) -> Proposal {
        Proposal {
            id,
            proposer: "alice.near".to_string(),
            description: String::new(),
            kind: json!({}),
            status,
            vote_counts: HashMap::new(),
            votes: HashMap::new(),
            submission_time: U64(0),
            last_actions_log: None,
            confidential_metadata: None,
            public_metadata: None,
            swap_status: None,
        }
    }

    /// A v1.signer `sign` proposal whose payload hash is `hash-{id}`.
    fn confidential_proposal(id: u64, status: ProposalStatus) -> Proposal {
        let args = base64::engine::general_purpose::STANDARD.encode(
            json!({ "request": { "payload_v2": { "Eddsa": format!("hash-{id}") } } }).to_string(),
        );
        let mut proposal = proposal(id, status);
        proposal.kind = json!({
            "FunctionCall": {
                "receiver_id": "v1.signer",
                "actions": [{ "method_name": "sign", "args": args, "deposit": "1", "gas": "300000000000000" }]
            }
        });
        proposal
    }

    async fn seed_public_quote(pool: &PgPool, proposal_id: i64, quote_metadata: serde_json::Value) {
        sqlx::query(
            r#"
            INSERT INTO dao_proposals (dao_id, proposal_id, status, quote_deposit_address, quote_metadata)
            VALUES ($1, $2, 'approved', 'deposit-' || $2::text, $3)
            "#,
        )
        .bind(DAO_ID)
        .bind(proposal_id)
        .bind(quote_metadata)
        .execute(pool)
        .await
        .expect("seed dao_proposals");
    }

    /// The intent row as the relay writes it: keyed by payload hash, with no
    /// proposal id yet (that is stamped later by the public-history linker).
    async fn seed_confidential_quote(pool: &PgPool, proposal_id: i64, bronze_statuses: &[&str]) {
        seed_confidential_quote_with_status(pool, proposal_id, "submitted", bronze_statuses).await;
    }

    async fn seed_confidential_quote_with_status(
        pool: &PgPool,
        proposal_id: i64,
        intent_status: &str,
        bronze_statuses: &[&str],
    ) {
        let deposit_address = format!("confidential-deposit-{proposal_id}");
        sqlx::query(
            r#"
            INSERT INTO confidential_intents (dao_id, payload_hash, intent_payload, deposit_address, status)
            VALUES ($1, 'hash-' || $2::text, '{}'::jsonb, $3, $4)
            "#,
        )
        .bind(DAO_ID)
        .bind(proposal_id)
        .bind(&deposit_address)
        .bind(intent_status)
        .execute(pool)
        .await
        .expect("seed confidential_intents");
        for (index, status) in bronze_statuses.iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO bronze_confidential_history_events
                    (account_id, created_at_external, deposit_address, status, deposit_type, destination_asset, raw_payload)
                VALUES ($1, NOW() + ($2::int * INTERVAL '1 minute'), $3, $4, 'ORIGIN_CHAIN', 'nep141:sol.omft.near', '{}'::jsonb)
                "#,
            )
            .bind(DAO_ID)
            .bind(index as i32)
            .bind(&deposit_address)
            .bind(status)
            .execute(pool)
            .await
            .expect("seed bronze row");
        }
    }

    #[sqlx::test]
    async fn attaches_outcomes_from_both_sources_to_approved_proposals_only(pool: PgPool) {
        // Public: raw 1Click response and the proposalQuote envelope.
        seed_public_quote(&pool, 1, json!({ "status": "FAILED" })).await;
        seed_public_quote(
            &pool,
            2,
            json!({ "proposalQuote": {}, "status": { "status": "SUCCESS" } }),
        )
        .await;
        // Public, no status refreshed yet.
        seed_public_quote(&pool, 3, serde_json::Value::Null).await;
        // Confidential: the latest bronze row wins.
        seed_confidential_quote(&pool, 146, &["PENDING_DEPOSIT", "REFUNDED"]).await;
        // Confidential, still settling.
        seed_confidential_quote(&pool, 147, &["PROCESSING"]).await;
        // Confidential intent with no bronze row ingested yet.
        seed_confidential_quote(&pool, 148, &[]).await;
        // Rejected on-chain: never looked up even with a persisted outcome.
        seed_public_quote(&pool, 9, json!({ "status": "FAILED" })).await;

        let mut proposals = vec![
            proposal(1, ProposalStatus::Approved),
            proposal(2, ProposalStatus::Approved),
            proposal(3, ProposalStatus::Approved),
            confidential_proposal(146, ProposalStatus::Approved),
            confidential_proposal(147, ProposalStatus::Approved),
            confidential_proposal(148, ProposalStatus::Approved),
            proposal(9, ProposalStatus::Rejected),
            proposal(500, ProposalStatus::Approved),
        ];
        SwapStatusLookup::new(&pool, DAO_ID)
            .attach(&mut proposals)
            .await
            .expect("lookup");

        let by_id: HashMap<u64, Option<SwapStatus>> =
            proposals.iter().map(|p| (p.id, p.swap_status)).collect();
        assert_eq!(by_id[&1], Some(SwapStatus::Failed));
        assert_eq!(by_id[&2], Some(SwapStatus::Success));
        assert_eq!(by_id[&3], None);
        assert_eq!(by_id[&146], Some(SwapStatus::Refunded));
        assert_eq!(by_id[&147], Some(SwapStatus::Processing));
        assert_eq!(by_id[&148], None);
        assert_eq!(by_id[&9], None);
        assert_eq!(by_id[&500], None);
    }

    /// An intent the submit queue retired never reached 1Click, so 1Click
    /// still shows the untouched quote (or nothing at all). The request is
    /// failed either way; a settled 1Click outcome recorded meanwhile wins.
    #[sqlx::test]
    async fn retired_intent_reads_as_failed_unless_1click_settled_it(pool: PgPool) {
        seed_confidential_quote_with_status(&pool, 201, "failed", &["PENDING_DEPOSIT"]).await;
        seed_confidential_quote_with_status(&pool, 202, "failed", &[]).await;
        seed_confidential_quote_with_status(&pool, 203, "failed", &["SUCCESS"]).await;

        let mut proposals = vec![
            confidential_proposal(201, ProposalStatus::Approved),
            confidential_proposal(202, ProposalStatus::Approved),
            confidential_proposal(203, ProposalStatus::Approved),
        ];
        SwapStatusLookup::new(&pool, DAO_ID)
            .attach(&mut proposals)
            .await
            .expect("lookup");

        let by_id: HashMap<u64, Option<SwapStatus>> =
            proposals.iter().map(|p| (p.id, p.swap_status)).collect();
        assert_eq!(by_id[&201], Some(SwapStatus::Failed));
        assert_eq!(by_id[&202], Some(SwapStatus::Failed));
        assert_eq!(by_id[&203], Some(SwapStatus::Success));
    }

    #[sqlx::test]
    async fn other_daos_outcomes_are_not_visible(pool: PgPool) {
        sqlx::query(
            r#"
            INSERT INTO dao_proposals (dao_id, proposal_id, status, quote_deposit_address, quote_metadata)
            VALUES ('other.sputnik-dao.near', 1, 'approved', 'deposit-1', '{"status":"FAILED"}'::jsonb)
            "#,
        )
        .execute(&pool)
        .await
        .expect("seed other dao");
        sqlx::query(
            r#"
            INSERT INTO confidential_intents (dao_id, payload_hash, intent_payload, deposit_address)
            VALUES ('other.sputnik-dao.near', 'hash-146', '{}'::jsonb, 'confidential-deposit-146')
            "#,
        )
        .execute(&pool)
        .await
        .expect("seed other dao intent");
        sqlx::query(
            r#"
            INSERT INTO bronze_confidential_history_events
                (account_id, created_at_external, deposit_address, status, deposit_type, destination_asset, raw_payload)
            VALUES ('other.sputnik-dao.near', NOW(), 'confidential-deposit-146', 'FAILED', 'ORIGIN_CHAIN', 'nep141:sol.omft.near', '{}'::jsonb)
            "#,
        )
        .execute(&pool)
        .await
        .expect("seed other dao bronze");

        let mut proposals = vec![
            proposal(1, ProposalStatus::Approved),
            confidential_proposal(146, ProposalStatus::Approved),
        ];
        SwapStatusLookup::new(&pool, DAO_ID)
            .attach(&mut proposals)
            .await
            .expect("lookup");
        assert!(proposals.iter().all(|p| p.swap_status.is_none()));
    }
}

#[cfg(test)]
mod status_display_tests {
    use super::*;
    use crate::handlers::proposals::scraper::get_status_display;
    use near_api::types::json::U64;
    use serde_json::json;

    fn approved_with(swap_status: Option<SwapStatus>) -> Proposal {
        Proposal {
            id: 146,
            proposer: "alice.near".to_string(),
            description: String::new(),
            kind: json!({}),
            status: ProposalStatus::Approved,
            vote_counts: HashMap::new(),
            votes: HashMap::new(),
            submission_time: U64(0),
            last_actions_log: None,
            confidential_metadata: None,
            public_metadata: None,
            swap_status,
        }
    }

    fn display(proposal: &Proposal) -> String {
        get_status_display(&proposal.status, 0, 0, "InProgress", Some(proposal))
    }

    #[test]
    fn approved_request_whose_swap_failed_or_refunded_is_failed() {
        assert_eq!(display(&approved_with(Some(SwapStatus::Failed))), "Failed");
        assert_eq!(
            display(&approved_with(Some(SwapStatus::Refunded))),
            "Failed"
        );
    }

    #[test]
    fn approved_request_stays_approved_until_the_swap_fails() {
        // Settled, still settling, or not intents-routed at all: the request
        // sits under the Executed tab (Processing has no tab of its own).
        for status in [
            Some(SwapStatus::Success),
            Some(SwapStatus::Processing),
            Some(SwapStatus::PendingDeposit),
            Some(SwapStatus::KnownDepositTx),
            Some(SwapStatus::IncompleteDeposit),
            None,
        ] {
            assert_eq!(display(&approved_with(status)), "Approved", "{status:?}");
        }
    }

    #[test]
    fn on_chain_failure_is_failed_regardless_of_swap_status() {
        let mut proposal = approved_with(Some(SwapStatus::Success));
        proposal.status = ProposalStatus::Failed;
        assert_eq!(display(&proposal), "Failed");
    }

    #[test]
    fn parse_is_case_insensitive_and_unknown_is_processing() {
        assert_eq!(SwapStatus::parse("failed"), SwapStatus::Failed);
        assert_eq!(SwapStatus::parse(" Refunded "), SwapStatus::Refunded);
        assert_eq!(SwapStatus::parse("SUCCESS"), SwapStatus::Success);
        assert_eq!(SwapStatus::parse("SOMETHING_NEW"), SwapStatus::Processing);
        assert!(SwapStatus::Refunded.is_failed());
        assert!(!SwapStatus::IncompleteDeposit.is_failed());
        assert!(SwapStatus::Success.is_terminal());
        assert!(!SwapStatus::Processing.is_terminal());
    }

    #[test]
    fn retired_intent_is_failed_unless_1click_settled() {
        assert_eq!(
            resolve_confidential_swap_status(None, true),
            Some(SwapStatus::Failed)
        );
        assert_eq!(
            resolve_confidential_swap_status(Some("PENDING_DEPOSIT"), true),
            Some(SwapStatus::Failed)
        );
        assert_eq!(
            resolve_confidential_swap_status(Some("SUCCESS"), true),
            Some(SwapStatus::Success)
        );
        assert_eq!(
            resolve_confidential_swap_status(Some("PENDING_DEPOSIT"), false),
            Some(SwapStatus::PendingDeposit)
        );
        assert_eq!(resolve_confidential_swap_status(None, false), None);
    }
}

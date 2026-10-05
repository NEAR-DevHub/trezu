//! One-off prefill of `dao_proposals.notes` for rows linked before the
//! column existed.
//!
//! Runs once per leader session, after the HTTP listener is bound, so a
//! slow scan never holds a deploy. The note is derived from the stored
//! description (or, for rows linked before that column existed, from the
//! bronze `add_proposal` receipt found by the creation transaction hash,
//! which is indexed) with the same `user_notes_from_description` rule the
//! linker applies. Idempotent: only `notes IS NULL` rows are read, so a
//! repeat run after the first full pass is a handful of index lookups.

use sqlx::PgPool;

use crate::handlers::proposals::scraper::user_notes_from_description;

const BATCH_SIZE: i64 = 500;

#[derive(Debug, sqlx::FromRow)]
struct Candidate {
    dao_id: String,
    proposal_id: i64,
    description: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ProposalNotesBackfillStats {
    pub scanned: usize,
    pub updated: u64,
}

pub struct ProposalNotesBackfill {
    pool: PgPool,
}

impl ProposalNotesBackfill {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn run(&self) -> Result<ProposalNotesBackfillStats, sqlx::Error> {
        let mut stats = ProposalNotesBackfillStats::default();
        let mut cursor: Option<(String, i64)> = None;
        loop {
            let batch = self.next_batch(cursor.as_ref()).await?;
            let Some(last) = batch.last() else {
                break;
            };
            cursor = Some((last.dao_id.clone(), last.proposal_id));
            stats.scanned += batch.len();
            stats.updated += self.write_notes(&batch).await?;
        }
        Ok(stats)
    }

    async fn next_batch(
        &self,
        after: Option<&(String, i64)>,
    ) -> Result<Vec<Candidate>, sqlx::Error> {
        let (after_dao_id, after_proposal_id) = after
            .map(|(dao_id, proposal_id)| (dao_id.as_str(), *proposal_id))
            .unwrap_or(("", -1));
        sqlx::query_as::<_, Candidate>(
            r#"
            SELECT
                dp.dao_id,
                dp.proposal_id,
                COALESCE(
                    dp.description,
                    b.raw_payload -> 'action' -> 'proposal' ->> 'description'
                ) AS description
            FROM dao_proposals dp
            LEFT JOIN LATERAL (
                SELECT b.raw_payload
                FROM bronze_public_history_events b
                WHERE dp.description IS NULL
                  AND b.transaction_hash = dp.proposal_creation_transaction_hash
                  AND b.account_id = dp.dao_id
                  AND b.method_name = 'add_proposal'
                ORDER BY
                    (b.receipt_id = dp.proposal_creation_receipt_id) DESC NULLS LAST,
                    b.id
                LIMIT 1
            ) b ON TRUE
            WHERE dp.notes IS NULL
              AND (
                    dp.description IS NOT NULL
                 OR dp.proposal_creation_transaction_hash IS NOT NULL
              )
              AND (dp.dao_id, dp.proposal_id) > ($1, $2)
            ORDER BY dp.dao_id, dp.proposal_id
            LIMIT $3
            "#,
        )
        .bind(after_dao_id)
        .bind(after_proposal_id)
        .bind(BATCH_SIZE)
        .fetch_all(&self.pool)
        .await
    }

    async fn write_notes(&self, batch: &[Candidate]) -> Result<u64, sqlx::Error> {
        let mut dao_ids = Vec::new();
        let mut proposal_ids = Vec::new();
        let mut notes = Vec::new();
        for candidate in batch {
            let Some(note) = candidate
                .description
                .as_deref()
                .and_then(user_notes_from_description)
            else {
                continue;
            };
            dao_ids.push(candidate.dao_id.clone());
            proposal_ids.push(candidate.proposal_id);
            notes.push(note);
        }
        if notes.is_empty() {
            return Ok(0);
        }
        let result = sqlx::query(
            r#"
            UPDATE dao_proposals dp
            SET notes = src.notes
            FROM UNNEST($1::text[], $2::bigint[], $3::text[]) AS src(dao_id, proposal_id, notes)
            WHERE dp.dao_id = src.dao_id
              AND dp.proposal_id = src.proposal_id
              AND dp.notes IS NULL
            "#,
        )
        .bind(&dao_ids)
        .bind(&proposal_ids)
        .bind(&notes)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn insert_proposal(
        pool: &PgPool,
        proposal_id: i64,
        description: Option<&str>,
        creation_tx: Option<&str>,
        notes: Option<&str>,
    ) {
        sqlx::query(
            r#"
            INSERT INTO dao_proposals (
                dao_id, proposal_id, description, proposal_creation_transaction_hash, notes
            )
            VALUES ('dao.near', $1, $2, $3, $4)
            "#,
        )
        .bind(proposal_id)
        .bind(description)
        .bind(creation_tx)
        .bind(notes)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_add_proposal_receipt(pool: &PgPool, tx_hash: &str, description: &str) {
        sqlx::query(
            r#"
            INSERT INTO bronze_public_history_events (
                account_id, source, source_event_key, transaction_hash, receipt_id,
                block_height, block_timestamp, block_time, affected_account_id,
                method_name, raw_payload
            )
            VALUES (
                'dao.near', 'nearblocks_receipt', $1, $1, $1 || '-receipt',
                1, 1, NOW(), 'dao.near', 'add_proposal', $2
            )
            "#,
        )
        .bind(tx_hash)
        .bind(json!({"action": {"proposal": {"description": description}}}))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn notes_by_proposal(pool: &PgPool) -> Vec<(i64, Option<String>)> {
        sqlx::query_as(
            "SELECT proposal_id, notes FROM dao_proposals WHERE dao_id = 'dao.near' ORDER BY proposal_id",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn prefills_notes_from_stored_and_bronze_descriptions(pool: PgPool) {
        insert_proposal(
            &pool,
            1,
            Some("* Proposal Action: transfer <br>* Notes: Invoice 1042"),
            None,
            None,
        )
        .await;
        insert_proposal(
            &pool,
            2,
            Some("* Proposal Action: asset-exchange <br>* Notes: **Must be executed before 2026-01-01** for swap execution."),
            None,
            None,
        )
        .await;
        insert_proposal(&pool, 3, None, Some("tx3"), None).await;
        insert_add_proposal_receipt(
            &pool,
            "tx3",
            "* Proposal Action: transfer <br>* Notes: From bronze",
        )
        .await;
        insert_proposal(
            &pool,
            4,
            Some("* Notes: should not override"),
            None,
            Some("kept"),
        )
        .await;
        insert_proposal(&pool, 5, None, None, None).await;

        let backfill = ProposalNotesBackfill::new(pool.clone());
        let stats = backfill.run().await.unwrap();
        assert_eq!(
            stats,
            ProposalNotesBackfillStats {
                scanned: 3,
                updated: 2
            }
        );
        assert_eq!(
            notes_by_proposal(&pool).await,
            vec![
                (1, Some("Invoice 1042".to_string())),
                (2, None),
                (3, Some("From bronze".to_string())),
                (4, Some("kept".to_string())),
                (5, None),
            ]
        );

        let again = backfill.run().await.unwrap();
        assert_eq!(
            again,
            ProposalNotesBackfillStats {
                scanned: 1,
                updated: 0
            }
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn pages_past_a_single_batch(pool: PgPool) {
        for proposal_id in 0..(BATCH_SIZE + 3) {
            insert_proposal(&pool, proposal_id, Some("* Notes: paged"), None, None).await;
        }

        let stats = ProposalNotesBackfill::new(pool.clone())
            .run()
            .await
            .unwrap();
        let expected = (BATCH_SIZE + 3) as usize;
        assert_eq!(stats.scanned, expected);
        assert_eq!(stats.updated, expected as u64);
    }
}

-- Persist the proposer's comment (`notes` in the proposal description;
-- `memo`/`comment` on the create-request form) so recent-activity can
-- show it without another RPC round-trip.
ALTER TABLE dao_proposals ADD COLUMN IF NOT EXISTS notes TEXT;

-- Prefill existing rows from the add_proposal description already stored
-- on bronze receipts. Same rules as `user_notes_from_description`: read
-- the `Notes` field only; keep the first line (a swap comment sits above
-- the execution-deadline reminder); drop reminder-only values. Rows with
-- no bronze add_proposal receipt stay NULL and get filled later by the
-- linker / refresh_proposal_from_chain.
WITH src AS (
    SELECT DISTINCT ON (dp.dao_id, dp.proposal_id)
        dp.dao_id,
        dp.proposal_id,
        extracted.notes_field AS notes
    FROM dao_proposals dp
    JOIN bronze_public_history_events b
      ON b.account_id = dp.dao_id
     AND b.method_name = 'add_proposal'
     AND (
            (
                dp.proposal_creation_receipt_id IS NOT NULL
                AND b.receipt_id = dp.proposal_creation_receipt_id
            )
         OR (
                dp.proposal_creation_transaction_hash IS NOT NULL
                AND b.transaction_hash = dp.proposal_creation_transaction_hash
            )
     )
    CROSS JOIN LATERAL (
        SELECT b.raw_payload -> 'action' -> 'proposal' ->> 'description' AS description
    ) payload
    CROSS JOIN LATERAL (
        SELECT
            (
                SELECT NULLIF(
                    BTRIM(substring(line FROM '^\s*\*\s*Notes:\s*(.*)$')),
                    ''
                )
                FROM regexp_split_to_table(payload.description, E'(?:<br>|[\\r\\n]+)') AS line
                WHERE line ~* '^\s*\*\s*Notes:'
                LIMIT 1
            ) AS notes_field
    ) extracted
    WHERE dp.notes IS NULL
      AND payload.description IS NOT NULL
    ORDER BY
        dp.dao_id,
        dp.proposal_id,
        CASE
            WHEN b.receipt_id = dp.proposal_creation_receipt_id THEN 0
            ELSE 1
        END
)
UPDATE dao_proposals dp
SET notes = src.notes
FROM src
WHERE dp.dao_id = src.dao_id
  AND dp.proposal_id = src.proposal_id
  AND src.notes IS NOT NULL
  AND src.notes NOT LIKE '**Must be executed before%';

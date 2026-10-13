-- Submission work queue for the "hand the signed intent to 1Click" step.
-- The vote relay (signature in its outcome) and the per-DAO 1Click poll
-- (signature read from the execution transaction) both submit; an expiring
-- lease with an ownership token makes exactly one of them own a row at a
-- time, and every outcome write carries the token.
--
-- submit_state: idle (not executed yet) -> due (executed, owed to 1Click)
--   -> in_flight (leased) -> done | failed | unknown (request may have reached
--   1Click but no answer came back; reconciled against 1Click history before
--   it is re-posted or retired).
ALTER TABLE confidential_intents
    ADD COLUMN IF NOT EXISTS submit_state TEXT NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS submit_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS submit_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS submit_last_error TEXT,
    ADD COLUMN IF NOT EXISTS submit_lease_token TEXT,
    ADD COLUMN IF NOT EXISTS submit_lease_until TIMESTAMPTZ;

ALTER TABLE confidential_intents
    ADD CONSTRAINT confidential_intents_submit_state_check
    CHECK (submit_state IN ('idle', 'due', 'in_flight', 'unknown', 'done', 'failed'));

-- Bulk-payment headers kept the deposit address only inside quote_metadata;
-- history linking and the 1Click reconciliation lookup key on the column.
UPDATE confidential_intents
SET deposit_address = quote_metadata->'quote'->>'depositAddress'
WHERE deposit_address IS NULL
  AND quote_metadata->'quote'->>'depositAddress' IS NOT NULL;

-- Legacy rows. Executed single intents with no 1Click response and no
-- history link start as `unknown`, so the first poll reconciles them against
-- 1Click history instead of retiring them blind.
UPDATE confidential_intents
SET submit_state = CASE
        WHEN status = 'failed' THEN 'failed'
        WHEN submit_result IS NOT NULL OR history_event_id IS NOT NULL THEN 'done'
        WHEN intent_type = 'shield' AND proposal_execution_transaction_hash IS NOT NULL THEN 'unknown'
        ELSE 'idle'
    END,
    submit_next_attempt_at = CASE
        WHEN status <> 'failed'
         AND submit_result IS NULL
         AND history_event_id IS NULL
         AND intent_type = 'shield'
         AND proposal_execution_transaction_hash IS NOT NULL THEN NOW()
    END;

-- What the per-DAO poll works on.
CREATE INDEX IF NOT EXISTS idx_confidential_intents_submit_due
    ON confidential_intents (dao_id, submit_next_attempt_at)
    WHERE submit_state IN ('due', 'unknown', 'in_flight');

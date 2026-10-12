-- Claim stamp for the "submit signed intent to 1Click" step. The relay task,
-- the public-history detector and the per-DAO 1Click poll can all try to submit
-- the same signed intent; a conditional UPDATE on this column makes exactly one
-- of them proceed. A stale claim (> 10 minutes) is reclaimable.
ALTER TABLE confidential_intents
    ADD COLUMN IF NOT EXISTS submit_claimed_at TIMESTAMPTZ;

-- Rows the per-DAO poll re-attempts: executed on chain, never accepted by 1Click.
CREATE INDEX IF NOT EXISTS idx_confidential_intents_awaiting_submit
    ON confidential_intents (dao_id)
    WHERE submit_result IS NULL AND proposal_execution_transaction_hash IS NOT NULL;

-- Reusable 1Click deposit address set per confidential treasury: the DAO's
-- long-lived ANY_INPUT quote (monitoring address + per-chain funding
-- addresses). Resolved once with the DAO JWT and cached here so the deposit
-- modal and share pages can serve the address without a 1Click round trip.
ALTER TABLE monitored_accounts
    ADD COLUMN IF NOT EXISTS confidential_reusable_deposit JSONB,
    ADD COLUMN IF NOT EXISTS confidential_reusable_deposit_updated_at TIMESTAMPTZ;

-- A ledger row is linked to at most one tracker row. The reconcile query
-- already skips claimed rows; this makes the guarantee hold regardless of
-- how the rows were written.
CREATE UNIQUE INDEX IF NOT EXISTS idx_in_process_deposits_ledger_event
    ON in_process_deposits (ledger_event_id)
    WHERE ledger_event_id IS NOT NULL;

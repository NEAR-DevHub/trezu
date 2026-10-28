-- Reusable 1Click deposit address set per confidential treasury: the DAO's
-- long-lived ANY_INPUT quote (monitoring address + per-chain funding
-- addresses). Resolved once with the DAO JWT and cached here so the deposit
-- modal and share pages can serve the address without a 1Click round trip.
ALTER TABLE monitored_accounts
    ADD COLUMN IF NOT EXISTS confidential_reusable_deposit JSONB,
    ADD COLUMN IF NOT EXISTS confidential_reusable_deposit_updated_at TIMESTAMPTZ;

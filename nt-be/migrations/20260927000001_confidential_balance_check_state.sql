-- Per-DAO outcome of the inline ledger-vs-1Click balance check. While
-- balance_check_failed_at is set, confidential balances are served live from
-- 1Click and the chart degrades to Stale (mirrors the public verification gate).
ALTER TABLE gold_confidential_history_cursors
    ADD COLUMN IF NOT EXISTS balance_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS balance_check_failed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS balance_check_mismatch JSONB;

-- === usage_tracking: new event counters ===
ALTER TABLE usage_tracking
    ADD COLUMN IF NOT EXISTS swap_proposals              int4 NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_proposals           int4 NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS votes_casted                int4 NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS other_proposals_submitted   int4 NOT NULL DEFAULT 0;

-- === monitored_accounts: platform-created timestamp ===
ALTER TABLE monitored_accounts
    ADD COLUMN IF NOT EXISTS created_by_trezu_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_monitored_accounts_created_by_trezu
    ON monitored_accounts (created_by_trezu_at)
    WHERE created_by_trezu_at IS NOT NULL;

-- === DB diagram connections ===


-- export_history.account_id → monitored_accounts.account_id
-- ON DELETE CASCADE: account_id is NOT NULL, so SET NULL is invalid.
ALTER TABLE export_history
    ADD CONSTRAINT fk_export_history_monitored_account
    FOREIGN KEY (account_id)
    REFERENCES monitored_accounts (account_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
    NOT VALID;

-- === Migrate activity for current month (March 2026) ===
-- All users use plus plan_type. Backfill usage_tracking from monitored_accounts
-- credits: Plus = 5 exports, 10 batch payments, 1000 gas. Usage = initial - remaining.
INSERT INTO usage_tracking (
    monitored_account_id,
    billing_year,
    billing_month,
    outbound_volume_cents,
    exports_used,
    batch_payments_used,
    gas_covered_transactions,
    swap_proposals,
    payment_proposals,
    votes_casted,
    other_proposals_submitted
)
SELECT
    ma.account_id,
    2026,
    3,
    0,
    GREATEST(0, 5 - ma.export_credits),
    GREATEST(0, 10 - ma.batch_payment_credits),
    GREATEST(0, 1000 - ma.gas_covered_transactions),
    0,
    0,
    0,
    0
FROM monitored_accounts ma
WHERE ma.plan_type = 'plus'
ON CONFLICT (monitored_account_id, billing_year, billing_month)
DO UPDATE SET
    exports_used = GREATEST(usage_tracking.exports_used, EXCLUDED.exports_used),
    batch_payments_used = GREATEST(usage_tracking.batch_payments_used, EXCLUDED.batch_payments_used),
    gas_covered_transactions = GREATEST(usage_tracking.gas_covered_transactions, EXCLUDED.gas_covered_transactions),
    updated_at = NOW();

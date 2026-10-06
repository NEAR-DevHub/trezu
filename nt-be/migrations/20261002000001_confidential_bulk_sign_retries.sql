-- How many times the bulk processor reset `SignFailed` recipient hashes back
-- to `Pending` via the subaccount's `retry_failed`. Caps the retry loop so a
-- hash that can never be signed doesn't burn gas forever.
ALTER TABLE confidential_bulk_payments
    ADD COLUMN IF NOT EXISTS sign_retry_count INTEGER NOT NULL DEFAULT 0;

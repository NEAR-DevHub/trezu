-- Add confidential intents JWT storage to monitored_accounts.
-- Used to authenticate with the 1Click API for confidential operations
-- (balances, unshield/transfer quotes).
ALTER TABLE monitored_accounts
    ADD COLUMN confidential_access_token TEXT,
    ADD COLUMN confidential_refresh_token TEXT,
    ADD COLUMN confidential_token_expires_at TIMESTAMPTZ;

ALTER TABLE monitored_accounts
ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT false;

UPDATE monitored_accounts
SET
    is_confidential = false
WHERE
    is_confidential IS DISTINCT FROM false;
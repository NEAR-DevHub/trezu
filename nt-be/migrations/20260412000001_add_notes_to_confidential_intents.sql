-- Add notes column to store user-provided memo/description for confidential payments.
-- Since on-chain descriptions are opaque for privacy, notes are stored in the DB
-- and served via the confidential_metadata enrichment.
ALTER TABLE confidential_intents ADD COLUMN IF NOT EXISTS notes TEXT;

-- Replace proposal_id with payload_hash in confidential_intents.
-- The payload_hash is the NEP-413 SHA-256 hex digest that v1.signer signs,
-- allowing reliable matching between stored intents and on-chain proposals.
ALTER TABLE confidential_intents DROP CONSTRAINT IF EXISTS confidential_intents_dao_id_proposal_id_key;
ALTER TABLE confidential_intents DROP COLUMN IF EXISTS proposal_id;
ALTER TABLE confidential_intents ADD COLUMN IF NOT EXISTS payload_hash TEXT NOT NULL DEFAULT '';
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'confidential_intents_dao_id_payload_hash_key'
    ) THEN
        ALTER TABLE confidential_intents ADD CONSTRAINT confidential_intents_dao_id_payload_hash_key UNIQUE (dao_id, payload_hash);
    END IF;
END
$$;

-- Store the full quote response blob so the UI can display amounts, tokens, recipient, etc.
ALTER TABLE confidential_intents ADD COLUMN IF NOT EXISTS quote_metadata JSONB;
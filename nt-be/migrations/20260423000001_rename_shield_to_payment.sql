-- Rename confidential_intents.intent_type value 'shield' to 'payment'.
-- The single-recipient confidential flow is a payment, not specifically shielding.
-- Add 'bulk_payment' as a third allowed value for multi-recipient confidential transfers.
UPDATE confidential_intents
SET intent_type = 'payment'
WHERE intent_type = 'shield';

ALTER TABLE confidential_intents
    ALTER COLUMN intent_type SET DEFAULT 'payment';

COMMENT ON COLUMN confidential_intents.intent_type IS
    'auth | payment | bulk_payment';
COMMENT ON COLUMN confidential_intents.quote_metadata IS
    'Object for payment (single quote); JSONB array of quote objects for bulk_payment';

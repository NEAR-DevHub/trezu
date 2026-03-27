-- Distinguish auth vs shield pending intents.
ALTER TABLE pending_confidential_intents
    ADD COLUMN IF NOT EXISTS intent_type TEXT NOT NULL DEFAULT 'shield';

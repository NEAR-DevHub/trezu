-- Cursor tracking for Goldsky enrichment workers.
-- Each consumer independently tracks its progress through indexed_dao_outcomes (Neon).
-- Stored in the app DB (not Neon) to keep Neon as a clean shared event source.
CREATE TABLE goldsky_cursors (
    consumer_name TEXT PRIMARY KEY,
    last_processed_id TEXT NOT NULL DEFAULT '',
    last_processed_block BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

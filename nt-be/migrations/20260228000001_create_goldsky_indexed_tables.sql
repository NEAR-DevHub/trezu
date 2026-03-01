-- Goldsky Turbo pipeline sink table
-- Populated directly by a single Goldsky pipeline streaming NEAR execution outcomes.
-- Captures: FT/MT transfers (NEP-141/245), intents swaps, native NEAR transfers,
-- function calls, staking — any outcome involving a sputnik-dao account.
-- An enrichment worker processes unprocessed rows into the existing balance_changes table.

CREATE TABLE indexed_dao_outcomes (
    id TEXT PRIMARY KEY,
    executor_id TEXT NOT NULL,
    logs TEXT,                -- EVENT_JSON entries (joined with \n), contains transfer details
    status TEXT,
    transaction_hash TEXT,    -- Available directly from execution_outcomes dataset
    signer_id TEXT,
    receiver_id TEXT,
    gas_burnt BIGINT,         -- Gas consumed by this execution
    tokens_burnt TEXT,        -- NEAR burned for gas (as string to preserve precision)
    trigger_block_height BIGINT NOT NULL,
    trigger_block_hash TEXT,
    trigger_block_timestamp BIGINT NOT NULL,  -- milliseconds (not nanoseconds like NEAR RPC)

    -- Enrichment status
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dao_outcomes_block ON indexed_dao_outcomes(trigger_block_height DESC);
CREATE INDEX idx_dao_outcomes_unprocessed ON indexed_dao_outcomes(processed) WHERE processed = FALSE;
CREATE INDEX idx_dao_outcomes_executor ON indexed_dao_outcomes(executor_id);
CREATE INDEX idx_dao_outcomes_receiver ON indexed_dao_outcomes(receiver_id);
CREATE INDEX idx_dao_outcomes_tx_hash ON indexed_dao_outcomes(transaction_hash);

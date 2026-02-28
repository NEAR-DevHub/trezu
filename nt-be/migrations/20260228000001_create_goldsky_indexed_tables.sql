-- Goldsky Turbo pipeline sink tables
-- These tables are populated directly by Goldsky pipelines streaming NEAR blockchain data.
-- An enrichment worker processes unprocessed rows into the existing balance_changes table.

-- Pipeline 1: Receipts involving monitored treasury accounts
CREATE TABLE indexed_near_receipts (
    receipt_id TEXT PRIMARY KEY,
    predecessor_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    receipt TEXT,              -- JSON string with full action data (Transfer, FunctionCall, etc.)
    block_height BIGINT NOT NULL,
    block_hash TEXT,
    block_timestamp BIGINT NOT NULL,  -- milliseconds (not nanoseconds like NEAR RPC)

    -- Enrichment status
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_indexed_receipts_block ON indexed_near_receipts(block_height DESC);
CREATE INDEX idx_indexed_receipts_unprocessed ON indexed_near_receipts(processed) WHERE processed = FALSE;
CREATE INDEX idx_indexed_receipts_predecessor ON indexed_near_receipts(predecessor_id);
CREATE INDEX idx_indexed_receipts_receiver ON indexed_near_receipts(receiver_id);

-- Pipeline 2: FT/intents transfer events from execution outcomes
CREATE TABLE indexed_ft_events (
    id TEXT PRIMARY KEY,
    executor_id TEXT NOT NULL,
    logs TEXT,                -- Contains EVENT_JSON with transfer details
    status TEXT,
    transaction_hash TEXT,    -- Available directly from execution_outcomes dataset
    signer_id TEXT,
    receiver_id TEXT,
    trigger_block_height BIGINT NOT NULL,
    trigger_block_hash TEXT,
    trigger_block_timestamp BIGINT NOT NULL,  -- milliseconds

    -- Parsed event data (populated by enrichment worker)
    token_id TEXT,            -- e.g., "wrap.near" or "intents.near:nep141:usdc.near"
    account_id TEXT,          -- The monitored account involved
    counterparty TEXT,        -- The other party
    amount NUMERIC,           -- Transfer amount (parsed from event)

    -- Enrichment status
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_indexed_ft_block ON indexed_ft_events(trigger_block_height DESC);
CREATE INDEX idx_indexed_ft_unprocessed ON indexed_ft_events(processed) WHERE processed = FALSE;
CREATE INDEX idx_indexed_ft_executor ON indexed_ft_events(executor_id);
CREATE INDEX idx_indexed_ft_account ON indexed_ft_events(account_id);

-- Pipeline 3: Transaction metadata for monitored accounts
CREATE TABLE indexed_transactions (
    hash TEXT PRIMARY KEY,
    signer_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    actions TEXT,              -- JSON string with action data (method names, args, deposits)
    block_height BIGINT NOT NULL,
    block_hash TEXT,
    block_timestamp BIGINT NOT NULL,  -- milliseconds

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_indexed_tx_block ON indexed_transactions(block_height DESC);
CREATE INDEX idx_indexed_tx_receiver ON indexed_transactions(receiver_id);

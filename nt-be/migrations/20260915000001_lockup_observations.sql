-- Lockup balance observations: history for NEAR held in a treasury's lockup
-- contract (a separate account the DAO owns). Mirrors staking observations:
-- archival readings at chart boundaries, replayed as hidden observation
-- ledger entries on the synthetic `lockup:{lockup_account_id}` asset.

CREATE TYPE lockup_discovery_status AS ENUM ('pending', 'absent', 'present');

CREATE TABLE lockup_observation_cursors (
    account_id TEXT PRIMARY KEY,
    lockup_account_id TEXT NOT NULL,
    discovery lockup_discovery_status NOT NULL DEFAULT 'pending',
    discovery_attempts INT NOT NULL DEFAULT 0,
    discovery_error TEXT,
    next_discovery_at TIMESTAMPTZ,
    backfill_done BOOLEAN NOT NULL DEFAULT FALSE,
    last_observed_at TIMESTAMPTZ,
    -- {"<boundary rfc3339>": {"attempts": n, "next_retry_at": rfc3339, "error": "..."}}
    failed_boundaries JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bronze_lockup_observations (
    id BIGSERIAL PRIMARY KEY,
    -- 'lockup:{account_id}:{lockup_account_id}:{block_height}'
    observation_key TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL,
    lockup_account_id TEXT NOT NULL,
    block_height BIGINT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    -- Gross total in NEAR units: lockup account balance + pool staked + unstaked.
    balance NUMERIC NOT NULL,
    -- {"exists": bool, "liquid": "..", "pool_account_id": ".." | null, "pool_total": ".."}
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_blo_account_time
    ON bronze_lockup_observations (account_id, observed_at DESC);

-- Staking observations gain the same fail-closed shape: discovery recorded
-- per account, candidate pools rejected for good when they are not pools,
-- and per-boundary retry backoff.
CREATE TABLE staking_discovery_cursors (
    account_id TEXT PRIMARY KEY,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE staking_observation_cursors
    ADD COLUMN rejected_at TIMESTAMPTZ,
    ADD COLUMN failed_boundaries JSONB NOT NULL DEFAULT '{}'::jsonb;

-- One chain-validated block per chart boundary, shared by every observation
-- worker and every account.
CREATE TABLE observation_boundary_blocks (
    boundary TIMESTAMPTZ PRIMARY KEY,
    block_height BIGINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

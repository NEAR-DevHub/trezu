-- Deposit tracker: temporary visibility for inbound deposits between the
-- moment a user is shown a deposit address and the moment the permanent
-- ledger carries the settled row.
--
-- `deposit_watches` is the polling schedule. Public treasuries have one row
-- per DAO (the bridge `recent_deposits` call is account-scoped, so every open
-- chain/token selection shares it). Confidential treasuries have one row per
-- one-time 1Click quote (`quote_deposit_address`).
--
-- `in_process_deposits` holds real provider-reported deposits. One public
-- watch can produce many; a confidential watch produces at most one.

CREATE TABLE deposit_watches (
    id BIGSERIAL PRIMARY KEY,
    dao_id TEXT NOT NULL REFERENCES monitored_accounts (account_id),
    kind TEXT NOT NULL CHECK (kind IN ('public', 'confidential')),
    quote_deposit_address TEXT,
    chain TEXT,
    token_id TEXT,
    fast_until TIMESTAMPTZ NOT NULL,
    discovery_until TIMESTAMPTZ NOT NULL,
    next_poll_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Public only: provider deposit keys already settled when the watch was
    -- first polled. Absent from later results means "new". NULL = baseline
    -- not taken yet.
    baseline_keys TEXT[],
    attempts INTEGER NOT NULL DEFAULT 0,
    last_polled_at TIMESTAMPTZ,
    last_error TEXT,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (kind = 'public' AND quote_deposit_address IS NULL)
        OR (kind = 'confidential' AND quote_deposit_address IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_deposit_watches_scope
    ON deposit_watches (dao_id, kind, COALESCE(quote_deposit_address, ''));
CREATE INDEX idx_deposit_watches_due
    ON deposit_watches (next_poll_at)
    WHERE retired_at IS NULL;

CREATE TABLE in_process_deposits (
    id BIGSERIAL PRIMARY KEY,
    watch_id BIGINT NOT NULL REFERENCES deposit_watches (id) ON DELETE CASCADE,
    dao_id TEXT NOT NULL REFERENCES monitored_accounts (account_id),
    kind TEXT NOT NULL CHECK (kind IN ('public', 'confidential')),
    -- Public: "{chain}:{origin_tx_hash}:{defuse_asset_id}". Confidential: the
    -- quote deposit address.
    provider_deposit_key TEXT NOT NULL,
    chain TEXT,
    origin_tx_hash TEXT,
    -- NEAR-side credit hash (bridge mint) when the provider reports it; the
    -- ledger row carries the same hash, giving an exact match.
    near_tx_hash TEXT,
    -- Ledger token id the permanent row will carry.
    token_id TEXT NOT NULL,
    -- Decimal-adjusted, same convention as gold_treasury_ledger_events.
    amount NUMERIC,
    provider_status TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('detected', 'finalized', 'ledger_confirmed', 'failed')
    ),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at TIMESTAMPTZ,
    ledger_event_id BIGINT REFERENCES gold_treasury_ledger_events (id) ON DELETE SET NULL,
    ledger_confirmed_at TIMESTAMPTZ,
    refresh_attempts INTEGER NOT NULL DEFAULT 0,
    next_refresh_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_in_process_deposits_provider_key
    ON in_process_deposits (dao_id, provider_deposit_key);
CREATE INDEX idx_in_process_deposits_visible
    ON in_process_deposits (dao_id, detected_at DESC)
    WHERE status IN ('detected', 'finalized', 'failed');
CREATE INDEX idx_in_process_deposits_watch
    ON in_process_deposits (watch_id);

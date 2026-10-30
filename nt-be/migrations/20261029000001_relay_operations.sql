-- Durable sponsored relays. A relay_operations row is one authorized user
-- action; a relay_transactions row is one sponsor-signed NEAR transaction
-- needed to complete it (storage top-up, token registration, final relay).
-- Signed bytes and the hash are committed before the first broadcast, so an
-- unknown outcome is always reconciled by hash instead of re-signed.
--
-- The operation lease (lease_token / lease_until) fences every write to the
-- operation and to its transactions; a worker that lost its lease matches
-- zero rows. Credit, spend and metrics are written in the same database
-- transaction that makes the operation terminal, so they need no markers.
CREATE TYPE relay_operation_kind AS ENUM ('add_proposal', 'act_proposal', 'wallet_replay');
CREATE TYPE relay_operation_state AS ENUM ('pending', 'succeeded', 'failed', 'manual_review');
CREATE TYPE relay_transaction_state AS ENUM ('prepared', 'pending', 'succeeded', 'failed', 'superseded');

CREATE TABLE relay_operations (
    id UUID PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    treasury_id TEXT NOT NULL,
    actor_account_id TEXT NOT NULL,
    operation_kind relay_operation_kind NOT NULL,
    submission_payload BYTEA NOT NULL,
    state relay_operation_state NOT NULL DEFAULT 'pending',
    credit_reserved BOOLEAN NOT NULL,
    proposal_type TEXT,
    address_book_payment BOOLEAN NOT NULL DEFAULT FALSE,
    proposal_ids BIGINT[],
    failure_code TEXT,
    last_error TEXT,
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);

CREATE INDEX idx_relay_operations_due
    ON relay_operations (next_attempt_at)
    WHERE state = 'pending';

CREATE INDEX idx_relay_operations_treasury
    ON relay_operations (treasury_id, created_at DESC);

CREATE TABLE relay_transactions (
    id UUID PRIMARY KEY,
    operation_id UUID NOT NULL REFERENCES relay_operations (id),
    step_key TEXT NOT NULL,
    state relay_transaction_state NOT NULL DEFAULT 'prepared',
    public_key TEXT NOT NULL,
    nonce BIGINT NOT NULL,
    valid_until_height BIGINT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    signed_tx BYTEA NOT NULL,
    spend_yocto NUMERIC(78, 0) NOT NULL DEFAULT 0,
    broadcast_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (public_key, nonce),
    CHECK (state = 'prepared' OR broadcast_at IS NOT NULL)
);

-- One live transaction per workflow step; a superseded one frees the slot
-- for its replacement.
CREATE UNIQUE INDEX idx_relay_transactions_active_step
    ON relay_transactions (operation_id, step_key)
    WHERE state <> 'superseded';

CREATE INDEX idx_relay_transactions_pending_age
    ON relay_transactions (broadcast_at)
    WHERE state = 'pending';

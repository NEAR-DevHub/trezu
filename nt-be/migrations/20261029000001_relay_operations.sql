-- Durable sponsored relays. A relay_operations row is one authorized user
-- action; a relay_transactions row is one sponsor-signed NEAR transaction
-- needed to complete it (storage top-up, token registration, final relay).
-- Signed bytes and the hash are committed before the first broadcast, so an
-- unknown outcome is always reconciled by hash instead of re-signed.
--
-- The request only inserts the operation; the worker moves it through
-- `stage` (authorize, storage_top_up, registrations, relay, settle). The
-- stage says what the operation is doing; relay_transactions says what was
-- signed and sent for it.
--
-- `id` is derived from the treasury, the actor and the signed bytes, so a
-- retry of one signed action lands on the same row.
--
-- The operation lease (lease_token) fences every write to the operation and
-- to its transactions; a worker that lost its lease matches zero rows. While
-- a worker holds the row, next_attempt_at is when its lease runs out, so a
-- holder that died is taken over by the ordinary claim. Credit, spend and
-- metrics are written in the same database transaction that makes the
-- operation terminal, so they need no markers.
CREATE TYPE relay_operation_kind AS ENUM ('add_proposal', 'act_proposal', 'wallet_replay');
CREATE TYPE relay_operation_state AS ENUM ('pending', 'succeeded', 'failed', 'manual_review');
CREATE TYPE relay_operation_stage AS ENUM ('authorize', 'storage_top_up', 'registrations', 'relay', 'settle');
CREATE TYPE relay_transaction_state AS ENUM ('prepared', 'pending', 'succeeded', 'failed', 'superseded');
-- What the client said it was relaying; picks the usage counters recorded on success.
CREATE TYPE relay_proposal_type AS ENUM ('swap', 'payment', 'address_book_payment', 'vote', 'other');

CREATE TABLE relay_operations (
    id UUID PRIMARY KEY,
    treasury_id TEXT NOT NULL,
    actor_account_id TEXT NOT NULL,
    operation_kind relay_operation_kind NOT NULL,
    submission_payload BYTEA NOT NULL,
    state relay_operation_state NOT NULL DEFAULT 'pending',
    stage relay_operation_stage NOT NULL DEFAULT 'authorize',
    stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    credit_reserved BOOLEAN NOT NULL DEFAULT FALSE,
    proposal_type relay_proposal_type,
    proposal_ids BIGINT[],
    failure_code TEXT,
    last_error TEXT,
    lease_token UUID,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_relay_operations_due
    ON relay_operations (next_attempt_at)
    WHERE state = 'pending';

CREATE INDEX idx_relay_operations_unauthorized_actor
    ON relay_operations (actor_account_id)
    WHERE state = 'pending' AND stage = 'authorize';

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

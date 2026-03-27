-- Store intent data for confidential proposals awaiting DAO approval.
-- After the signing proposal is approved and the MPC signature extracted,
-- the backend auto-submits the signed intent to the 1Click API.
CREATE TABLE IF NOT EXISTS pending_confidential_intents (
    id SERIAL PRIMARY KEY,
    dao_id TEXT NOT NULL,
    proposal_id INTEGER NOT NULL,
    -- NEP-413 intent payload (message, nonce, recipient)
    intent_payload JSONB NOT NULL,
    -- Correlation ID from the 1Click API
    correlation_id TEXT,
    -- Status: pending | submitted | failed
    status TEXT NOT NULL DEFAULT 'pending',
    -- Result from submit-intent (intentHash, etc.)
    submit_result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (dao_id, proposal_id)
);

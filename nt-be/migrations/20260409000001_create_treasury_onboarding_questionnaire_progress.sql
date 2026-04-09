CREATE TABLE IF NOT EXISTS onboarding_sessions (
    onboarding_session_id TEXT PRIMARY KEY,
    account_id TEXT,
    treasury_account_id TEXT,
    completed_steps INTEGER NOT NULL DEFAULT 0,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
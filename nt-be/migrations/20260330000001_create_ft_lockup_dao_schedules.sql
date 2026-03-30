CREATE TABLE IF NOT EXISTS ft_lockup_dao_schedules (
    dao_account_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    token_account_id TEXT NOT NULL,
    session_interval_seconds BIGINT,
    start_timestamp_seconds BIGINT,
    is_ft_registered BOOLEAN NOT NULL DEFAULT FALSE,
    next_claim_at TIMESTAMPTZ,
    last_account_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (dao_account_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_ft_lockup_schedules_due_claim
    ON ft_lockup_dao_schedules (next_claim_at);

CREATE INDEX IF NOT EXISTS idx_ft_lockup_schedules_instance
    ON ft_lockup_dao_schedules (instance_id);

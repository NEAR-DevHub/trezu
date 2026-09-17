-- Owner token per stable apalis worker id.
--
-- A rebuilt worker (same process after a crash, or a new instance after a
-- deploy) may take over an id only while the registered heartbeat is stale;
-- the heartbeat then succeeds only for the current owner, so a superseded
-- incarnation is fenced out. This replaces session-level advisory locks held
-- by pooled connections, which could only be freed by terminating a shared
-- connection that might be serving unrelated work.
CREATE TABLE IF NOT EXISTS job_worker_registrations (
    worker_id TEXT PRIMARY KEY,
    owner_token UUID NOT NULL,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

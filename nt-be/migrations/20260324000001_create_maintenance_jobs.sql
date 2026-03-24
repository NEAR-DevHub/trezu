-- Tracks progress of background data-maintenance jobs so each job can
-- resume where it left off and avoid reprocessing the same blocks.
CREATE TABLE maintenance_jobs (
    job_name        TEXT PRIMARY KEY,
    last_processed_block BIGINT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE maintenance_jobs IS
    'Cursor table for background data-maintenance jobs. Each row tracks how far '
    'a job has progressed so it can resume without reprocessing.';
COMMENT ON COLUMN maintenance_jobs.last_processed_block IS
    'Jobs scan backwards; this is the highest block height still eligible to be '
    'processed on the next run (an upper bound; queries use block_height <= this value). '
    'A value of -1 is a terminal sentinel meaning the job has completed and no further '
    'work is needed.';

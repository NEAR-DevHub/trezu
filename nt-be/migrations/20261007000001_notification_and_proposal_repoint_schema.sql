-- Phase 1 of the legacy balance_changes removal: schema the repointed
-- consumers need before the legacy writers can be deleted.

-- Telegram add_proposal notifications render the proposal title and
-- submitter. The linker already fetches the full proposal when it upserts
-- dao_proposals; it now persists both fields so the notification detector
-- can stay zero-RPC once balance_changes.actions is gone. Nullable, no
-- backfill: only newly created proposals produce notifications.
ALTER TABLE dao_proposals
    ADD COLUMN IF NOT EXISTS proposer TEXT,
    ADD COLUMN IF NOT EXISTS description TEXT;

-- Notification dedupe must key on a stable value: gold ledger rows are
-- deleted and re-inserted with fresh ids on recompute, so row ids cannot
-- dedupe re-detections. source_key carries the stable identity
-- (gold_event_key for ledger rows, '{dao_id}:{proposal_id}' for proposals,
-- confidential_intents.id for confidential proposals); source_id keeps the
-- row id observed at detection time for debugging.
ALTER TABLE dao_notifications
    ADD COLUMN IF NOT EXISTS source_key TEXT;
UPDATE dao_notifications SET source_key = source_id::text WHERE source_key IS NULL;
ALTER TABLE dao_notifications ALTER COLUMN source_key SET NOT NULL;
ALTER TABLE dao_notifications DROP CONSTRAINT IF EXISTS uq_dao_notification;
ALTER TABLE dao_notifications
    ADD CONSTRAINT uq_dao_notification UNIQUE (source_table, source_key, dao_id, event_type);

COMMENT ON COLUMN dao_notifications.source_key IS
    'Stable dedupe identity of the source event: gold_event_key for ledger rows, {dao_id}:{proposal_id} for dao_proposals, confidential_intents.id for confidential proposals. Legacy rows carry their old source_id.';

-- No index needed for the find_block_height repoint: idx_bphe_block_time on
-- bronze_public_history_events (block_time) already exists (staking
-- observations migration) and serves the at-or-before timestamp lookup.

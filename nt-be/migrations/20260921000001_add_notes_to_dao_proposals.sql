-- Persist the proposer's comment (`notes` in the proposal description;
-- `memo`/`comment` on the create-request form) so recent-activity can
-- show it without another RPC round-trip.
--
-- Existing rows are prefilled by `proposals::notes_backfill`, which runs
-- once per leader session after the HTTP listener is up. Doing it here
-- held an exclusive lock on dao_proposals for a full scan of bronze and
-- timed out the deploy before the port was bound.
ALTER TABLE dao_proposals ADD COLUMN IF NOT EXISTS notes TEXT;

-- Allow detected_swaps rows to exist before the fulfillment (receive) leg is known.
--
-- Confidential swaps emit the outgoing leg via Goldsky enrichment at proposal
-- execution time, but the fulfillment leg is only observed later by the 1Click
-- balance poller. Pre-inserting a detected_swaps row at the outgoing-leg step
-- lets the UI render the send leg as a swap immediately (no "payment sent"
-- proxy state) and the poller fills in fulfillment_* on match.

ALTER TABLE detected_swaps
    ALTER COLUMN fulfillment_balance_change_id DROP NOT NULL,
    ALTER COLUMN received_amount DROP NOT NULL;

COMMENT ON COLUMN detected_swaps.fulfillment_balance_change_id IS
    'FK to the balance_change record for the receive leg. NULL when the deposit leg is recorded before the fulfillment (pending swap).';
COMMENT ON COLUMN detected_swaps.received_amount IS
    'Observed receive amount. NULL when only the expected (quote) amount is known at insert time.';

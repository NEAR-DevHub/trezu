-- Fix unique constraint on detected_swaps
-- The old constraint (account_id, fulfillment_receipt_id) causes collisions
-- when intents balance changes have no receipt_id (empty string).
-- Use solver_transaction_hash instead, which is unique per swap.

ALTER TABLE detected_swaps DROP CONSTRAINT unique_swap_fulfillment;
ALTER TABLE detected_swaps ADD CONSTRAINT unique_swap_solver_tx UNIQUE(account_id, solver_transaction_hash);

-- fulfillment_receipt_id can be empty for intents tokens, make it nullable
ALTER TABLE detected_swaps ALTER COLUMN fulfillment_receipt_id DROP NOT NULL;

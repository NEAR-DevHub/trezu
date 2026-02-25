-- Fix detected_swaps rows where the fulfillment was matched to a fee refund
-- in the origin token instead of the actual destination token.
--
-- This happens when the fulfillment tx contains both a small fee refund
-- (e.g. +0.00004 USDC) and the actual swap receive (e.g. +0.005 SOL).
-- The old code picked the first positive intents-prefixed record.
--
-- Strategy: delete mismatched rows and mark accounts dirty so the
-- swap detector re-runs with the corrected matching logic.

-- Delete detected_swaps where the fulfillment balance_change token
-- matches the sent token (meaning it matched a fee refund, not the destination).
DELETE FROM detected_swaps ds
USING balance_changes bc
WHERE ds.fulfillment_balance_change_id = bc.id
  AND ds.sent_token_id IS NOT NULL
  AND bc.token_id = 'intents.near:nep141:' || ds.sent_token_id;

-- Mark all accounts that have detected_swaps as dirty so they get re-processed.
-- This is a lightweight operation since only monitored accounts with swaps are affected.
UPDATE monitored_accounts
SET is_dirty = true
WHERE account_id IN (SELECT DISTINCT account_id FROM detected_swaps)
   OR account_id IN (
       SELECT DISTINCT account_id FROM balance_changes
       WHERE token_id LIKE 'intents.near:%'
   );

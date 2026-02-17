-- Clear transaction_hashes on intents token balance changes that have more than one tx hash.
-- These records were populated by a bug (#209) where the gap filler collected ALL tx hashes
-- from intents.near state changes at a block, including unrelated transactions.
-- After clearing, the dirty monitor will re-resolve the correct tx hash on the next cycle.
UPDATE balance_changes
SET transaction_hashes = '{}'
WHERE token_id LIKE 'intents.near:%'
  AND array_length(transaction_hashes, 1) > 1;

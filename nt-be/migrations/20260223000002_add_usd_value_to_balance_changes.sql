-- Add usd_value column to balance_changes
-- Stores the total USD value of the balance change at the exact block_time,
-- fetched from DefiLlama's historical price API.
-- Nullable because price data may not be available for all tokens.
ALTER TABLE balance_changes ADD COLUMN usd_value NUMERIC;

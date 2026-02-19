-- Clean up export history and add unique constraint
-- This ensures a clean state for the new URL format (camelCase + URL encoding)

-- Delete all existing export history
DELETE FROM export_history;

-- Add unique constraint to account_id + file_url in export_history table
-- This prevents duplicate exports with the same parameters from being stored for the same account
-- The file_url contains all export parameters (date range, filters, format)
-- We include account_id in the constraint so different accounts can have the same export parameters
ALTER TABLE export_history
ADD CONSTRAINT unique_account_export_params UNIQUE (account_id, file_url);

COMMENT ON CONSTRAINT unique_account_export_params ON export_history IS 'Ensures each unique set of export parameters per account is only stored once. Prevents duplicate exports and credits charges when user requests the same export multiple times.';
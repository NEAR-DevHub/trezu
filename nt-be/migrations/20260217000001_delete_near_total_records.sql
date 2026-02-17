-- Remove legacy near:total records.
-- These were created by migration 20260204000001 which renamed near → near:total.
-- near:total is a synthetic aggregate (liquid NEAR + staked) that is:
--   - not queryable via RPC (contains invalid ':' character)
--   - excluded from all API output
--   - redundant since near and staking:* are tracked separately
DELETE FROM balance_changes WHERE token_id = 'near:total';

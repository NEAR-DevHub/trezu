-- Reset usd_value column to NULL for all records.
-- The initial backfill used f64 for 10^decimals which loses precision
-- for large exponents (e.g. NEAR's 24 decimals), producing wrong values.
-- The fixed backfill service will re-populate these correctly.
UPDATE balance_changes SET usd_value = NULL WHERE usd_value IS NOT NULL;

-- Public treasuries are now tracked on their reusable 1Click deposit set, so
-- a public watch carries the set's quote address like a confidential one.
ALTER TABLE deposit_watches DROP CONSTRAINT IF EXISTS deposit_watches_check;

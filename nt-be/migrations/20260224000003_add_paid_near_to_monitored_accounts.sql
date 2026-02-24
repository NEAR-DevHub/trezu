ALTER TABLE monitored_accounts
ADD COLUMN paid_near NUMERIC(78, 0) NOT NULL DEFAULT 0;

COMMENT ON COLUMN monitored_accounts.paid_near IS 'Cumulative NEAR spent by the relayer for this treasury, in yoctoNEAR';

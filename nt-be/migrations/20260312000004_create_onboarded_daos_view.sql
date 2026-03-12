-- View: ONBOARDED_DAOS
-- Users who accepted TC -> their daos from dao_members -> extended with monitored_accounts (null if not monitored)
-- Distinct by dao_id (one row per DAO)
DROP VIEW IF EXISTS "onboarded_daos";

CREATE OR REPLACE VIEW "onboarded_daos" AS
SELECT DISTINCT ON (dm.dao_id)
    dm.dao_id,
    ma.enabled AS ma_enabled,
    ma.plan_type AS ma_plan_type,
    ma.credits_reset_at AS ma_credits_reset_at,
    ma.export_credits AS ma_export_credits,
    ma.batch_payment_credits AS ma_batch_payment_credits,
    ma.gas_covered_transactions AS ma_gas_covered_transactions,
    ma.paid_near AS ma_paid_near,
    ma.created_at as created_at,
    ma.created_by_trezu_at AS ma_created_by_trezu_at
FROM users u
JOIN dao_members dm ON dm.account_id = u.account_id
LEFT JOIN monitored_accounts ma ON ma.account_id = dm.dao_id
WHERE u.terms_accepted_at IS NOT NULL
ORDER BY dm.dao_id

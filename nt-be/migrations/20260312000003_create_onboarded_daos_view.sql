-- View: ONBOARDED_DAOS
-- Users who accepted TC -> their daos from dao_members -> extended with monitored_accounts (null if not monitored)
-- Distinct by dao_id (one row per DAO)
CREATE OR REPLACE VIEW "onboarded_daos" AS
SELECT DISTINCT ON (dm.dao_id)
    u.account_id AS user_account_id,
    u.terms_accepted_at,
    dm.dao_id,
    dm.id AS dao_member_id,
    dm.created_at AS dao_member_created_at,
    dm.is_policy_member,
    dm.is_saved,
    dm.is_hidden,
    ma.account_id AS monitored_account_id,
    ma.enabled AS ma_enabled,
    ma.last_synced_at AS ma_last_synced_at,
    ma.created_at AS ma_created_at,
    ma.updated_at AS ma_updated_at,
    ma.dirty_at AS ma_dirty_at,
    ma.plan_type AS ma_plan_type,
    ma.credits_reset_at AS ma_credits_reset_at,
    ma.export_credits AS ma_export_credits,
    ma.batch_payment_credits AS ma_batch_payment_credits,
    ma.gas_covered_transactions AS ma_gas_covered_transactions,
    ma.paid_near AS ma_paid_near,
    ma.maintenance_block_floor AS ma_maintenance_block_floor,
    ma.created_by_trezu_at AS ma_created_by_trezu_at
FROM users u
JOIN dao_members dm ON dm.account_id = u.account_id
LEFT JOIN monitored_accounts ma ON ma.account_id = dm.dao_id
WHERE u.terms_accepted_at IS NOT NULL
ORDER BY dm.dao_id, u.terms_accepted_at ASC NULLS LAST;

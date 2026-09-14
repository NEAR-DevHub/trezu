-- Analytics on the unified ledger only.
--
-- Drops every kr_* view except kr_analytics_treasury_monthly: they still
-- read balance_changes / detected_swaps and nothing consumes them (the only
-- code consumer of any kr_* view is GET /internal/api/analytics/
-- treasury-monthly over kr_analytics_treasury_monthly).
--
-- Rebuilds kr_analytics_treasury_monthly so BOTH public and confidential
-- AUM come from gold_treasury_ledger_events: the latest user-owned balance
-- per asset at or before each month end (carry-forward, so a month without
-- fresh activity or a missed snapshot job no longer reports NULL AUM),
-- valued at the latest token_prices sample at or before that month end.
-- This removes the view's last references to public_dashboard_daily_balances
-- and gold_confidential_balance_snapshots. Hidden ledger rows participate:
-- their balance columns are real state points even though they are excluded
-- from flow metrics.

DROP VIEW IF EXISTS
    kr_dashboard,
    kr_aum_daily,
    kr_treasuries_created_daily,
    kr_unique_wallets_daily,
    kr_mats_monthly,
    kr_treasury_churn_monthly,
    kr_swap_volume_daily,
    kr_outflow_daily,
    kr_aum_usd,
    kr_inflow_usd,
    kr_outflow_usd,
    kr_swap_volume_usd,
    kr_swap_fees_usd,
    kr_atv_usd,
    kr_mats,
    kr_active_wallets,
    kr_unique_wallets,
    kr_treasuries_created,
    kr_plan_distribution,
    kr__swap_receive_legs,
    kr__payment_outflows,
    kr__active_treasury_months;

CREATE OR REPLACE VIEW kr_analytics_treasury_monthly AS
WITH treasury_base AS (
    SELECT
        ma.account_id,
        ma.created_at AS monitored_at,
        ma.created_by_trezu_at,
        coalesce(ma.is_confidential_account, false) AS is_confidential_account,
        ma.plan_type,
        d.created_at AS dao_created_at,
        coalesce(ma.created_by_trezu_at, d.created_at, ma.created_at)::date AS trezu_started_on
    FROM monitored_accounts ma
    LEFT JOIN daos d
      ON d.dao_id = ma.account_id
    WHERE ma.is_testing IS NOT TRUE
),
month_bounds AS (
    SELECT
        date_trunc('month', min(trezu_started_on))::date AS min_month,
        date_trunc('month', current_date)::date AS max_month
    FROM treasury_base
),
months AS (
    SELECT generate_series(min_month, max_month, interval '1 month')::date AS month_start
    FROM month_bounds
    WHERE min_month IS NOT NULL
),
treasury_months AS (
    SELECT
        tb.account_id,
        m.month_start,
        (m.month_start + interval '1 month - 1 day')::date AS month_end,
        extract(year FROM m.month_start)::int AS year,
        extract(month FROM m.month_start)::int AS month,
        to_char(m.month_start, 'Mon YYYY') AS month_label,
        tb.trezu_started_on,
        tb.is_confidential_account,
        CASE
            WHEN tb.is_confidential_account THEN 'confidential'
            ELSE 'public'
        END AS treasury_type,
        CASE
            WHEN tb.created_by_trezu_at IS NOT NULL THEN 'trezu_created'
            ELSE 'sputnik_existing'
        END AS origin,
        tb.plan_type,
        greatest(
            (
                extract(year FROM age((m.month_start + interval '1 month - 1 day')::date, tb.trezu_started_on))::int * 12
              + extract(month FROM age((m.month_start + interval '1 month - 1 day')::date, tb.trezu_started_on))::int
            ),
            0
        ) AS age_months
    FROM treasury_base tb
    JOIN months m
      ON m.month_start >= date_trunc('month', tb.trezu_started_on)::date
),
-- Every user-owned balance state point in the ledger: one row per
-- balance-bearing leg of every successful event, hidden rows included.
ledger_balance_points AS (
    SELECT dao_id, asset, balance, event_time, block_height, source_order, id
    FROM (
        SELECT dao_id, token_in AS asset, token_in_user_balance_after AS balance,
               event_time, block_height, source_order, id
        FROM gold_treasury_ledger_events
        WHERE status = 'success'
          AND token_in IS NOT NULL
          AND token_in_user_balance_after IS NOT NULL
        UNION ALL
        SELECT dao_id, token_out, token_out_user_balance_after,
               event_time, block_height, source_order, id
        FROM gold_treasury_ledger_events
        WHERE status = 'success'
          AND token_out IS NOT NULL
          AND token_out_user_balance_after IS NOT NULL
    ) legs
),
-- Last observed balance per (dao, asset) inside each calendar month, using
-- the ledger's event ordering (same tie-break as the balance readers).
ledger_month_end_points AS (
    SELECT DISTINCT ON (dao_id, asset, date_trunc('month', event_time))
        dao_id,
        asset,
        date_trunc('month', event_time)::date AS point_month,
        balance,
        event_time
    FROM ledger_balance_points
    ORDER BY dao_id, asset, date_trunc('month', event_time),
             event_time DESC, block_height DESC NULLS LAST, source_order DESC, id DESC
),
-- Carry-forward: for each treasury month, the latest month-end point at or
-- before it. A zero balance carries forward as zero (it is a real point),
-- so sold-out assets do not resurrect an older positive balance.
ledger_month_assets AS (
    SELECT DISTINCT ON (tm.account_id, tm.month_start, p.asset)
        tm.account_id,
        tm.month_start,
        p.asset,
        p.balance,
        p.event_time
    FROM treasury_months tm
    JOIN ledger_month_end_points p
      ON p.dao_id = tm.account_id
     AND p.point_month <= tm.month_start
    ORDER BY tm.account_id, tm.month_start, p.asset, p.point_month DESC
),
-- Raw ledger asset id -> tokens registry row, mirroring the Rust
-- canonicalize_token_id: NEAR native and staking pools price as wrap.near,
-- intents-held assets strip the custodian prefix, HOT omni assets gain the
-- nep245 custodian, bare contract ids gain nep141.
ledger_asset_tokens AS (
    SELECT la.asset, t.id AS token_ref
    FROM (SELECT DISTINCT asset FROM ledger_balance_points) la
    JOIN tokens t
      ON t.token_id = CASE
            WHEN la.asset = 'near' OR left(la.asset, 8) = 'staking:' THEN 'nep141:wrap.near'
            WHEN left(la.asset, 13) = 'intents.near:' THEN
                CASE
                    WHEN left(substr(la.asset, 14), 7) IN ('nep141:', 'nep245:', '1cs_v1:')
                        THEN substr(la.asset, 14)
                    WHEN substr(la.asset, 14) ~ '^[0-9]+_'
                        THEN 'nep245:v2_1.omni.hot.tg:' || substr(la.asset, 14)
                    WHEN left(substr(la.asset, 14), 17) = 'v2_1.omni.hot.tg:'
                        THEN 'nep245:' || substr(la.asset, 14)
                    ELSE 'nep141:' || substr(la.asset, 14)
                END
            WHEN left(la.asset, 7) IN ('nep141:', 'nep245:', '1cs_v1:') THEN la.asset
            WHEN left(la.asset, 17) = 'v2_1.omni.hot.tg:' THEN 'nep245:' || la.asset
            ELSE 'nep141:' || la.asset
        END
),
-- Latest price sample at or before each month end, computed once per
-- (token, month) instead of per treasury holding.
month_token_prices AS (
    SELECT m.month_start, refs.token_ref, p.price_usd
    FROM months m
    CROSS JOIN (SELECT DISTINCT token_ref FROM ledger_asset_tokens) refs
    JOIN LATERAL (
        SELECT tp.price_usd
        FROM token_prices tp
        WHERE tp.token_ref = refs.token_ref
          AND tp.minute_at < (m.month_start + interval '1 month')
        ORDER BY tp.minute_at DESC
        LIMIT 1
    ) p ON true
),
-- Month-end AUM per treasury (public and confidential alike): balances are
-- decimal-adjusted in the ledger, so value is balance * price directly.
-- snapshot_at is when the balance set was last observed on-ledger.
ledger_monthly_aum AS (
    SELECT
        lma.account_id,
        lma.month_start,
        max(lma.event_time) AS snapshot_at,
        sum(lma.balance * mtp.price_usd) AS aum_usd
    FROM ledger_month_assets lma
    JOIN ledger_asset_tokens lat
      ON lat.asset = lma.asset
    JOIN month_token_prices mtp
      ON mtp.token_ref = lat.token_ref
     AND mtp.month_start = lma.month_start
    WHERE lma.balance > 0
    GROUP BY 1, 2
),
public_flows AS (
    SELECT
        gpe.dao_id AS account_id,
        date_trunc('month', gpe.event_time)::date AS month_start,
        coalesce(sum(coalesce(gpe.usd_change, gpe.amount_in_usd, 0)) FILTER (
            WHERE gpe.transaction_type = 'deposit'
        ), 0) AS inflow_usd,
        coalesce(sum(abs(coalesce(gpe.usd_change, -gpe.amount_out_usd, 0))) FILTER (
            WHERE gpe.transaction_type = 'sent'
        ), 0) AS outflow_usd,
        coalesce(sum(coalesce(gpe.amount_out_usd, abs(gpe.usd_change), 0)) FILTER (
            WHERE gpe.transaction_type = 'exchange'
        ), 0) AS swap_volume_usd,
        count(*) FILTER (WHERE gpe.transaction_type = 'sent')::bigint AS payment_count,
        count(*) FILTER (WHERE gpe.transaction_type = 'exchange')::bigint AS swap_count
    FROM gold_treasury_ledger_events gpe
    JOIN monitored_accounts ma
      ON ma.account_id = gpe.dao_id
     AND ma.is_testing IS NOT TRUE
     AND ma.is_confidential_account IS NOT TRUE
    WHERE gpe.history_visible
      AND gpe.source_kind = 'public_silver_leg'
    GROUP BY 1, 2
),
confidential_flows AS (
    SELECT
        ghe.dao_id AS account_id,
        date_trunc('month', coalesce(ghe.proposal_executed_at, ghe.event_time))::date AS month_start,
        coalesce(sum(greatest(coalesce(ghe.usd_change, ghe.amount_in_usd, 0), 0)) FILTER (
            WHERE ghe.transaction_type = 'deposit'
        ), 0) AS inflow_usd,
        coalesce(sum(abs(coalesce(ghe.usd_change, -ghe.amount_out_usd, 0))) FILTER (
            WHERE ghe.transaction_type = 'sent'
        ), 0) AS outflow_usd,
        coalesce(sum(coalesce(ghe.amount_in_usd, abs(ghe.usd_change), 0)) FILTER (
            WHERE ghe.transaction_type = 'exchange'
        ), 0) AS swap_volume_usd,
        count(*) FILTER (WHERE ghe.transaction_type = 'sent')::bigint AS payment_count,
        count(*) FILTER (WHERE ghe.transaction_type = 'exchange')::bigint AS swap_count
    FROM gold_treasury_ledger_events ghe
    JOIN monitored_accounts ma
      ON ma.account_id = ghe.dao_id
     AND ma.is_testing IS NOT TRUE
     AND ma.is_confidential_account IS TRUE
    WHERE ghe.source_kind = 'confidential_history_event'
    GROUP BY 1, 2
),
members AS (
    SELECT
        tm.account_id,
        tm.month_start,
        count(dm.account_id)::bigint AS member_count
    FROM treasury_months tm
    LEFT JOIN dao_members dm
      ON dm.dao_id = tm.account_id
     AND dm.created_at < (tm.month_start + interval '1 month')
    GROUP BY 1, 2
),
address_book_size AS (
    SELECT
        tm.account_id,
        tm.month_start,
        count(ab.id)::bigint AS address_book_size
    FROM treasury_months tm
    LEFT JOIN address_book ab
      ON ab.dao_id = tm.account_id
     AND ab.created_at < (tm.month_start + interval '1 month')
    GROUP BY 1, 2
),
usage AS (
    SELECT
        monitored_account_id AS account_id,
        make_date(billing_year, billing_month, 1) AS month_start,
        exports_used,
        batch_payments_used,
        gas_covered_transactions,
        swap_proposals,
        payment_proposals,
        votes_casted
    FROM usage_tracking
),
combined AS (
    SELECT
        tm.account_id,
        tm.month_start,
        tm.is_confidential_account,
        lma.aum_usd,
        lma.snapshot_at AS aum_snapshot_at,
        CASE
            WHEN tm.is_confidential_account THEN coalesce(cf.inflow_usd, 0)
            ELSE coalesce(pf.inflow_usd, 0)
        END AS inflow_usd,
        CASE
            WHEN tm.is_confidential_account THEN coalesce(cf.outflow_usd, 0)
            ELSE coalesce(pf.outflow_usd, 0)
        END AS outflow_usd,
        CASE
            WHEN tm.is_confidential_account THEN coalesce(cf.swap_volume_usd, 0)
            ELSE coalesce(pf.swap_volume_usd, 0)
        END AS swap_volume_usd,
        CASE
            WHEN tm.is_confidential_account THEN coalesce(cf.payment_count, 0)
            ELSE coalesce(pf.payment_count, 0)
        END AS fallback_payment_count,
        CASE
            WHEN tm.is_confidential_account THEN coalesce(cf.swap_count, 0)
            ELSE coalesce(pf.swap_count, 0)
        END AS fallback_swap_count
    FROM treasury_months tm
    LEFT JOIN ledger_monthly_aum lma
      ON lma.account_id = tm.account_id
     AND lma.month_start = tm.month_start
    LEFT JOIN confidential_flows cf
      ON cf.account_id = tm.account_id
     AND cf.month_start = tm.month_start
    LEFT JOIN public_flows pf
      ON pf.account_id = tm.account_id
     AND pf.month_start = tm.month_start
)
SELECT
    tm.account_id,
    tm.month_start,
    tm.month_end,
    tm.year,
    tm.month,
    tm.month_label,
    tm.trezu_started_on,
    tm.age_months,
    tm.treasury_type,
    tm.origin,
    tm.plan_type::text AS plan_type,

    coalesce(m.member_count, 0) AS members,

    c.aum_usd,
    c.aum_snapshot_at,
    c.inflow_usd,
    c.outflow_usd,
    c.inflow_usd - c.outflow_usd AS netflow_usd,
    c.swap_volume_usd,
    c.inflow_usd + c.outflow_usd + c.swap_volume_usd AS volume_usd,
    CASE
        WHEN c.aum_usd > 0 THEN (c.inflow_usd + c.outflow_usd + c.swap_volume_usd) / c.aum_usd
        ELSE NULL
    END AS utilization_ratio,

    coalesce(u.payment_proposals, c.fallback_payment_count, 0)::bigint AS payments,
    coalesce(u.votes_casted, 0)::bigint AS votes,
    coalesce(u.swap_proposals, c.fallback_swap_count, 0)::bigint AS swaps,
    coalesce(u.batch_payments_used, 0)::bigint AS batch_payments,
    coalesce(absz.address_book_size, 0) AS address_book_size,
    coalesce(u.exports_used, 0)::bigint AS exports,
    coalesce(u.gas_covered_transactions, 0)::bigint AS gas_covered_transactions,

    (0.0035::numeric * c.swap_volume_usd) AS derived_swap_fee_revenue_usd,

    NULLIF(greatest(
        coalesce(last_confidential.last_activity_at, '-infinity'::timestamptz),
        coalesce(last_public.last_activity_at, '-infinity'::timestamptz),
        coalesce(last_usage.last_usage_at, '-infinity'::timestamptz)
    ), '-infinity'::timestamptz) AS last_activity_at
FROM treasury_months tm
JOIN combined c
  ON c.account_id = tm.account_id
 AND c.month_start = tm.month_start
LEFT JOIN members m
  ON m.account_id = tm.account_id
 AND m.month_start = tm.month_start
LEFT JOIN address_book_size absz
  ON absz.account_id = tm.account_id
 AND absz.month_start = tm.month_start
LEFT JOIN usage u
  ON u.account_id = tm.account_id
 AND u.month_start = tm.month_start
LEFT JOIN LATERAL (
    SELECT max(coalesce(ghe.proposal_executed_at, ghe.event_time)) AS last_activity_at
    FROM gold_treasury_ledger_events ghe
    WHERE ghe.dao_id = tm.account_id
      AND ghe.source_kind = 'confidential_history_event'
      AND coalesce(ghe.proposal_executed_at, ghe.event_time) < (tm.month_start + interval '1 month')
) last_confidential ON true
LEFT JOIN LATERAL (
    SELECT max(gpe.event_time) AS last_activity_at
    FROM gold_treasury_ledger_events gpe
    WHERE gpe.dao_id = tm.account_id
      AND gpe.history_visible
      AND gpe.source_kind = 'public_silver_leg'
      AND gpe.event_time < (tm.month_start + interval '1 month')
) last_public ON true
LEFT JOIN LATERAL (
    SELECT max(ut.updated_at) AS last_usage_at
    FROM usage_tracking ut
    WHERE ut.monitored_account_id = tm.account_id
      AND make_date(ut.billing_year, ut.billing_month, 1) <= tm.month_start
) last_usage ON true;

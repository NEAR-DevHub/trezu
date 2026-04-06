CREATE TABLE public_dashboard_daily_runs (
    snapshot_date     DATE        PRIMARY KEY,
    dao_count         INTEGER     NOT NULL,           -- total DAOs computed (from daos table)
    trezu_dao_count   INTEGER     NOT NULL DEFAULT 0, -- onboarded Trezu DAOs (from onboarded_daos view)
    failed_dao_count  INTEGER     NOT NULL DEFAULT 0,
    computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public_dashboard_daily_balances (
    snapshot_date    DATE    NOT NULL REFERENCES public_dashboard_daily_runs(snapshot_date) ON DELETE CASCADE,
    dao_id           TEXT    NOT NULL,
    is_trezu         BOOLEAN NOT NULL DEFAULT false,
    token_id         TEXT    NOT NULL,  -- unified grouping key (e.g. "near", "usdc")
    contract_id      TEXT,              -- actual contract / defuse asset ID for metadata lookup
    total_amount_raw NUMERIC NOT NULL,
    price_usd        NUMERIC NOT NULL,
    total_usd        NUMERIC NOT NULL,
    PRIMARY KEY (snapshot_date, dao_id, token_id)
);

CREATE INDEX idx_public_dashboard_daily_runs_latest
    ON public_dashboard_daily_runs(snapshot_date DESC);

CREATE INDEX idx_public_dashboard_daily_balances_snapshot_date
    ON public_dashboard_daily_balances(snapshot_date);

CREATE INDEX idx_public_dashboard_daily_balances_token
    ON public_dashboard_daily_balances(snapshot_date, token_id);

CREATE INDEX idx_public_dashboard_daily_balances_trezu
    ON public_dashboard_daily_balances(snapshot_date, is_trezu);

COMMENT ON TABLE public_dashboard_daily_runs IS
    'Daily refresh metadata for public dashboard balance snapshots';

COMMENT ON TABLE public_dashboard_daily_balances IS
    'Daily per-DAO per-token balances and USD values for the public dashboard';

COMMENT ON COLUMN public_dashboard_daily_runs.dao_count       IS 'Total DAOs computed from daos table (sync_failed = false)';
COMMENT ON COLUMN public_dashboard_daily_runs.trezu_dao_count IS 'Subset of dao_count that are onboarded Trezu DAOs';
COMMENT ON COLUMN public_dashboard_daily_balances.is_trezu    IS 'True when the DAO appears in the onboarded_daos view';

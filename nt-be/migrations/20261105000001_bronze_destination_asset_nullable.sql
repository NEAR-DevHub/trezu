-- 1Click lists a deposit-only history entry with no destination side: a plain
-- transfer into a 1Click deposit address, swept into the confidential
-- account. agentic.sputnik-dao.near, 2026-11-05: Sputnik proposal 65 (created
-- by an external SDK, not Trezu) sent 1 USDC to such an address; the entry
-- carries originAsset/amountIn only — no destinationAsset, recipient or
-- amountOut. The NOT NULL made the typed parse reject the whole page, so the
-- DAO's history ingestion froze on it. The credited asset is originAsset.
ALTER TABLE bronze_confidential_history_events
    ALTER COLUMN destination_asset DROP NOT NULL;

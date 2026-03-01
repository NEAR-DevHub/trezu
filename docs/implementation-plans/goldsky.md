# Replace binary-search balance tracking with Goldsky indexer pipelines

## Problem

We are consuming **100-200k FastNear RPC requests per hour** (~24M/month against a 10M/month limit) to build the `balance_changes` table. The root cause is the binary-search approach: for every balance change we need to find, we make ~27 RPC calls to locate the exact block, plus ~18 more calls for chunk/receipt/transaction resolution. With 66 monitored accounts across multiple token types (NEAR, FTs, staking pools, intents), this creates sustained ~27 rps load.

### Key cost drivers (from FastNear dashboard analysis, Feb 26 2026):
- **`query` (view_account / call_function)**: ~60% of all calls — binary search balance checks
- **`chunk`**: ~15% — finding receipts within blocks
- **`EXPERIMENTAL_changes`**: ~5% — finding transactions from balance change blocks
- **Staking reward binary search**: identified as the #1 flooder — searches for exact block within 43,200-block epochs
- **Deposit checking every 30 seconds**: checks all accounts for all known tokens on a polling loop

### Architecture problem
The current system **discovers** where balance changes happened by probing RPC at different block heights. An indexer gives us this information directly from the chain data stream — eliminating the need for binary search entirely.

## Implemented Solution

A **single Goldsky Turbo pipeline** (`treasury-dao-outcomes`) streams all relevant NEAR execution outcomes into a Postgres table (`indexed_dao_outcomes`). The pipeline captures every execution outcome where a sputnik-dao account is involved — either mentioned in logs (FT/MT transfers, wrap.near, intents swaps) or as the `receiver_id` (native NEAR transfers, function calls, staking).

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                 Goldsky Turbo Pipeline                │
│                                                      │
│  near.execution_outcomes → SQL filter → Postgres     │
│  (sputnik-dao.near in logs OR receiver_id)           │
└────────────────────┬────────────────────────────────┘
                     │ writes
                     ▼
          ┌─────────────────────┐
          │   Neon Postgres     │
          │   (Goldsky sink)    │
          │                     │
          │ indexed_dao_outcomes│
          │ - logs (parsed      │
          │   locally)          │
          │ - transaction_hash  │
          │ - signer_id         │
          │ - receiver_id       │
          │ - gas_burnt         │
          │ - tokens_burnt      │
          │ - block height/ts   │
          └──────────┬──────────┘
                     │ reads (unprocessed rows)
                     ▼
          ┌─────────────────────┐        ┌──────────┐
          │  Enrichment Worker  │───────▶│ NEAR RPC │
          │                     │◀───────│ (archival)│
          │ 1. Parse logs       │        └──────────┘
          │    (no RPC needed)  │  Only 2 calls/event:
          │ 2. Get balance      │  balance at block N-1
          │    before/after     │  balance at block N
          │ 3. Write to app DB  │
          └──────────┬──────────┘
                     │ writes
                     ▼
          ┌─────────────────────┐
          │   App Postgres      │
          │   (Render)          │
          │                     │
          │ balance_changes     │──▶ Frontend API
          └─────────────────────┘

Monitor loop (simplified):
  1. Run enrichment (Goldsky → balance_changes)
  2. Check for gaps in balance_changes
  3. RPC fallback only if gaps found
```

### Why a single pipeline (not 3)

The original plan proposed 3 pipelines (receipts, execution outcomes, transactions). We consolidated to 1 because:

1. **Pipeline limit**: Our Goldsky plan allows only 1 Turbo pipeline
2. **Execution outcomes are sufficient**: They include `transaction_hash`, `signer_id`, `receiver_id`, `gas_burnt`, `tokens_burnt`, and `logs` — covering FT transfers, native NEAR, staking, and intents
3. **Transactions pipeline was redundant**: Execution outcomes already include transaction metadata
4. **Receipts pipeline would duplicate**: Any receipt involving a DAO also produces an execution outcome

### Expected RPC reduction
- **Current**: ~100-200k calls/hour = 2.4-4.8M/day
- **With Goldsky**: ~2 RPC calls per balance change for enrichment. Even 1000 balance changes/day = ~2000 calls/day
- **Reduction**: ~1000-2400x fewer RPC calls

## What's Deployed (as of Mar 1 2026)

### Pipeline: `treasury-dao-outcomes`

**Config**: `goldsky/pipelines/near-execution-outcomes.yaml`

```yaml
name: treasury-dao-outcomes
apiVersion: 3
resource_size: s

sources:
  near_outcomes:
    type: dataset
    dataset_name: near.execution_outcomes
    version: 1.1.0
    start_at: earliest

transforms:
  dao_outcomes:
    type: sql
    primary_key: id
    sql: |
      SELECT
        id,
        executor_id,
        array_to_string(logs, '\n') as logs,
        status,
        transaction_hash,
        signer_id,
        receiver_id,
        gas_burnt,
        tokens_burnt,
        trigger_block_height,
        trigger_block_hash,
        trigger_block_timestamp
      FROM near_outcomes
      WHERE array_to_string(logs, ' ') LIKE '%sputnik-dao.near%'
         OR receiver_id LIKE '%.sputnik-dao.near'

sinks:
  postgres:
    type: postgres
    table: indexed_dao_outcomes
    schema: public
    secret_name: TREASURY_DB_SECRET
    from: dao_outcomes
```

### Database: `indexed_dao_outcomes` table

**Migration**: `nt-be/migrations/20260228000001_create_goldsky_indexed_tables.sql`

```sql
-- Neon DB (Goldsky sink) — shared event source, read-only for consumers
CREATE TABLE indexed_dao_outcomes (
    id TEXT PRIMARY KEY,
    executor_id TEXT NOT NULL,
    logs TEXT,                -- EVENT_JSON entries (joined with \n), contains transfer details
    status TEXT,
    transaction_hash TEXT,
    signer_id TEXT,
    receiver_id TEXT,
    gas_burnt BIGINT,
    tokens_burnt TEXT,        -- NEAR burned for gas (as string to preserve precision)
    trigger_block_height BIGINT NOT NULL,
    trigger_block_hash TEXT,
    trigger_block_timestamp BIGINT NOT NULL,  -- milliseconds (not nanoseconds like NEAR RPC)

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No processed/cursor columns — consumers track their own progress independently
CREATE INDEX idx_dao_outcomes_block ON indexed_dao_outcomes(trigger_block_height DESC);
CREATE INDEX idx_dao_outcomes_executor ON indexed_dao_outcomes(executor_id);
CREATE INDEX idx_dao_outcomes_receiver ON indexed_dao_outcomes(receiver_id);
CREATE INDEX idx_dao_outcomes_tx_hash ON indexed_dao_outcomes(transaction_hash);
```

**App DB cursor table** (new migration):

```sql
-- Tracks enrichment progress per consumer — allows cursor reset without duplicates
CREATE TABLE goldsky_cursors (
    consumer_name TEXT PRIMARY KEY,
    last_processed_id TEXT NOT NULL DEFAULT '',
    last_processed_block BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Infrastructure

- **Goldsky secret**: `TREASURY_DB_SECRET` — JDBC credentials for Neon Postgres
- **Database**: Neon Postgres (free tier, 0.5 GB limit)
- **Data rate**: ~25 rows per 1,000 blocks, ~1 KB per row
- **Deployed via**: `goldsky turbo apply` from a GitHub Codespace (Turbo CLI is x86_64 only)

## Key Learnings from Deployment

### Turbo vs Mirror pipelines
- NEAR datasets are **Turbo** datasets — must use `goldsky turbo apply`, NOT `goldsky pipeline apply` (which is the old Mirror system)
- Turbo requires a separate binary: `curl -fsSL https://install-turbo.goldsky.com | sh`
- Turbo binary is **x86_64 only** — doesn't work on ARM (e.g., Apple Silicon devcontainers via colima). Use GitHub Codespaces for deployment

### `logs` field is an array, not text
- `near.execution_outcomes.logs` has type `List(Utf8)` (array of strings)
- Must use `array_to_string(logs, '\n')` in SELECT and `array_to_string(logs, ' ')` in WHERE for LIKE filtering
- Without this, you get: "There isn't a common type to coerce List(Utf8) and Utf8 in LIKE expression"

### Kafka retention is limited
- `start_at` only accepts `earliest` or `latest` (Kafka `auto.offset.reset`)
- Goldsky's Kafka topic retains only ~10 days of data (~1.2M blocks)
- `earliest` starts from wherever data is available in the topic, NOT from genesis
- Block height filters in the SQL WHERE clause are unnecessary

### wrap.near logs use plain text, not EVENT_JSON
- wrap.near transfer logs look like: `Transfer 100000000000000000000000 from alice.near to bob.sputnik-dao.near`
- They do NOT use NEP-141 EVENT_JSON format (`{"standard":"nep141",...}`)
- The simplified filter `LIKE '%sputnik-dao.near%'` catches both formats

### Pipeline YAML requirements
- `apiVersion: 3` is required
- `resource_size: s` is required
- Transforms need `type: sql` and `primary_key` fields

## Remaining Implementation Plan

### Design principles

1. **Goldsky is the event source** — no more polling RPC to discover balance changes
2. **No dirty monitor** — the 30-second polling loop is eliminated entirely
3. **RPC is only a fallback** — for gap filling and for non-sputnik accounts
4. **Logs are parsed locally** — counterparty, token, transfer details come from Goldsky data, not RPC
5. **Two databases in v1** — enrichment worker reads from Neon (Goldsky sink), writes to app DB

### Phase 1: Enrichment worker

The enrichment worker connects to **two databases**:
- **Neon** (read-only): `indexed_dao_outcomes` table populated by Goldsky — treated as a shared event source that multiple consumers can read from independently
- **App DB** (read-write): `balance_changes` table consumed by the frontend, plus cursor tracking

#### Cursor tracking (in app DB, not Neon)

The app DB tracks which Goldsky rows have been processed using a cursor table. This keeps Neon clean as a shared event source — other consumers can independently read from it without interference.

```sql
-- Tracks enrichment progress per consumer
CREATE TABLE goldsky_cursors (
    consumer_name TEXT PRIMARY KEY,          -- e.g., 'balance_enrichment'
    last_processed_id TEXT NOT NULL,         -- id of last processed indexed_dao_outcomes row
    last_processed_block BIGINT NOT NULL,    -- block height of last processed row
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The enrichment worker queries Neon for rows after its cursor position:

```sql
SELECT * FROM indexed_dao_outcomes
WHERE trigger_block_height > $last_processed_block
   OR (trigger_block_height = $last_processed_block AND id > $last_processed_id)
ORDER BY trigger_block_height ASC, id ASC
LIMIT 100
```

#### Idempotency

The enrichment worker must be idempotent — if the cursor is reset or replayed, it should upsert records using `INSERT ... ON CONFLICT DO UPDATE`. This way, replaying with improved enrichment logic (better log parsing, more accurate counterparty detection) overwrites existing records with higher-quality data. The natural key for conflict detection is `(account_id, token_id, block_height)`.

Create `nt-be/src/handlers/balance_changes/goldsky_enrichment.rs`:

```rust
/// Process indexed events into balance_changes records.
///
/// Reads from Neon (Goldsky sink), writes to the app database.
/// Cursor tracking is in the app DB — Neon stays read-only.
/// Idempotent: safe to replay from any cursor position.
pub async fn run_enrichment_cycle(
    neon_pool: &PgPool,    // Neon DB (Goldsky sink) — read-only
    app_pool: &PgPool,     // App DB (balance_changes + cursor)
    network: &NetworkConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Get cursor position from app DB
    let cursor = get_cursor(app_pool, "balance_enrichment").await?;

    // 2. Fetch new outcomes from Neon after cursor
    let outcomes = sqlx::query!(
        "SELECT * FROM indexed_dao_outcomes
         WHERE trigger_block_height > $1
            OR (trigger_block_height = $1 AND id > $2)
         ORDER BY trigger_block_height ASC, id ASC
         LIMIT 100",
        cursor.last_processed_block,
        cursor.last_processed_id,
    ).fetch_all(neon_pool).await?;

    for outcome in &outcomes {
        // 3. Parse logs locally — no RPC needed
        let events = parse_outcome_events(outcome);

        for event in events {
            // 4. Get balance before and after — the ONLY RPC calls
            let balance_before = get_balance_at_block(
                app_pool, network, &event.account_id, &event.token_id,
                outcome.trigger_block_height - 1
            ).await?;
            let balance_after = get_balance_at_block(
                app_pool, network, &event.account_id, &event.token_id,
                outcome.trigger_block_height
            ).await?;

            if balance_before == balance_after { continue; }

            // 5. Upsert — ON CONFLICT DO UPDATE for better quality on replay
            upsert_balance_change(app_pool, BalanceChange {
                account_id: event.account_id,
                token_id: event.token_id,
                block_height: outcome.trigger_block_height,
                block_timestamp: outcome.trigger_block_timestamp,
                balance_before,
                balance_after,
                amount: &balance_after - &balance_before,
                transaction_hashes: vec![outcome.transaction_hash.clone()],
                signer_id: outcome.signer_id.clone(),
                receiver_id: outcome.receiver_id.clone(),
                counterparty: event.counterparty,
                ..Default::default()
            }).await?;
        }

        // 6. Advance cursor in app DB after each outcome
        update_cursor(app_pool, "balance_enrichment",
            &outcome.id, outcome.trigger_block_height).await?;
    }
    Ok(())
}
```

#### Event parsing (all local, no RPC)

Each outcome produces one or more events. There are two distinct paths:

**Path A: Log-based events** (logs mention `sputnik-dao.near`)

The token contract is always `executor_id` — the contract that emitted the log. For example, `wrap.near` emitting a transfer log means `token_id = "wrap.near"` (not `"near"`).

1. **NEP-141 FT transfers**: `EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{"old_owner_id":"...","new_owner_id":"...","amount":"..."}]}`
   → `token_id` = `executor_id`, counterparty and amount from log data
2. **NEP-245 intents transfers**: `EVENT_JSON:{"standard":"nep245","event":"mt_transfer",...}`
   → `token_id` = `"intents.near:<token_id from event>"`, counterparty and amounts from log data
3. **wrap.near plain-text**: `Transfer 100000000000000000000000 from alice.near to bob.sputnik-dao.near`
   → `token_id` = `"wrap.near"`, counterparty and amount from log text

**Path B: Receiver-based events** (`receiver_id` is a DAO)

When `receiver_id` is a DAO, it means someone called a function on the DAO contract (e.g., `act_proposal`, `add_proposal`) or sent NEAR directly. **Only the native NEAR balance is affected.** FT transfers produce their own log-based events (Path A) separately — no need to check FT balances here.

→ `token_id` = `"near"`, `account_id` = `receiver_id`, `counterparty` = `signer_id`

**A single outcome can trigger both paths** — e.g., if a function call on a DAO also emits an FT transfer log. Each path produces independent events.

#### What we DON'T need RPC for in the normal flow

| Previously needed RPC | Now from Goldsky |
|---|---|
| Transaction hash resolution (chunk → receipt → tx) | `transaction_hash` field |
| Signer discovery | `signer_id` field |
| Counterparty identification | Parsed from `logs` |
| Receipt ID | Not needed — we have `transaction_hash` |
| Transfer amount | Parsed from `logs` |
| Token contract (who emitted the event) | `executor_id` field |

**Note:** The existing RPC-based resolution logic (binary search, tx resolution, FastNear hints) is still needed for **on-demand historical backfill** — e.g., when a new DAO is added and needs history beyond Goldsky's ~10-day Kafka retention window. This code stays in the codebase but is no longer part of the main monitor loop. It runs only when explicitly triggered (e.g., account onboarding, manual backfill request).

#### Staking rewards: special handling required

Staking rewards accumulate silently — no transaction, no log, no receipt. A staking pool's balance increases when anyone calls `ping`, but the reward itself doesn't produce a log mentioning the DAO. Goldsky catches explicit staking interactions (`deposit_and_stake`, `unstake`, `withdraw`, `ping`) but not silent accumulation.

**Goal:** One `balance_changes` entry per epoch for staking rewards, distinct from deposit/withdrawal entries.

**How it works with Goldsky:**

1. **Explicit interactions** (deposit, withdraw, unstake) arrive via Goldsky with exact block heights. The enrichment worker processes these normally — `balance_before`/`balance_after` at the exact block gives the precise change. These are tagged as deposits/withdrawals.

2. **Staking rewards** are detected via epoch-boundary gap detection:
   - At each epoch boundary (~43,200 blocks), query the staking balance (1 RPC call per pool)
   - Compare against the last known staking balance after the most recent explicit interaction (already in `balance_changes` from step 1)
   - The difference = pure staking reward, because all explicit changes are already accounted for
   - If the difference > 0, insert a `balance_changes` entry tagged as `STAKING_REWARD`

3. **Why this is reliable:** Goldsky gives us the exact blocks for every deposit/withdrawal/unstake. So between the last explicit interaction and the epoch boundary, any balance increase must be a reward. No ambiguity.

**RPC cost:** 1 call per staking pool per epoch (~every 12 hours). With ~20 staking pools across all DAOs, that's ~40 RPC calls/day — negligible compared to the current binary search approach.

### Phase 2: Simplify the monitor loop

The current monitor does too much: poll for deposits, binary-search for changes, resolve transactions, fill gaps. With Goldsky:

**New monitor loop (simplified):**
1. **Run enrichment** — process new rows from `indexed_dao_outcomes` in Neon. Enriches **all** sputnik-dao outcomes, not just monitored accounts. This way if a DAO is added to monitoring later, its history is already enriched.
2. **Check for gaps** — look for missing blocks between known balance changes. Gap detection runs **only for monitored accounts** (from `monitored_accounts` table).
3. **Fill gaps if needed** — use existing binary search as RPC fallback
4. That's it. No dirty monitor. No deposit polling. No transaction resolution.

**What gets removed from the main loop:**
- `dirty_monitor.rs` — 30-second polling loop, entirely replaced by Goldsky events

**What moves to on-demand backfill only:**
- `binary_search.rs` — still needed when onboarding accounts with history beyond Goldsky's ~10-day retention
- `transfer_hints/` module — FastNear hints and tx resolution for historical backfill
- `gap_filler.rs` — RPC-based gap filling as fallback

**What gets simplified:**
- `account_monitor.rs` — main loop becomes: enrich → gap-check → (optional) RPC fallback
- Token discovery — new tokens appear automatically in Goldsky logs

### Phase 3: Validation and cutover

1. Deploy enrichment worker alongside existing system
2. Compare Goldsky-based balance_changes with binary-search results
3. Monitor RPC usage reduction
4. Disable dirty monitor and binary search for sputnik-dao accounts
5. Keep RPC fallback for non-sputnik accounts and gap filling

## Mapping to existing balance tracking system

### What Goldsky replaces in the main loop

| Current module | What it does | New role |
|---|---|---|
| `dirty_monitor.rs` | Polls RPC every 30 seconds to detect changes | **Removed** — Goldsky streams events, no polling needed |
| `binary_search.rs` | Finds exact block of balance change (~27 RPC calls) | **On-demand only** — kept for historical backfill of new accounts |
| `transfer_hints/fastnear.rs` | FastNear API hints for gap filling | **On-demand only** — kept for historical backfill |
| `transfer_hints/tx_resolver.rs` | Resolves receipt→transaction via RPC | **On-demand only** — kept for historical backfill |
| `gap_filler.rs` | Multi-strategy gap filling | **On-demand only** — kept as RPC fallback for gaps and backfill |
| `token_discovery.rs` (receipt-based) | Scans counterparties to discover FT contracts | **On-demand only** — new tokens appear automatically in Goldsky logs for ongoing monitoring |

### What Goldsky partially replaces

| Current module | What stays | What changes |
|---|---|---|
| `staking_rewards.rs` | Epoch-boundary reward detection (1 RPC/pool/epoch) | Goldsky gives exact blocks for deposit/withdraw/unstake; epoch-boundary check isolates pure rewards by diffing against last known interaction balance |
| `token_discovery.rs` (FastNear balance API) | Initial onboarding still needs `fetch_fastnear_ft_tokens` | Ongoing discovery via pipeline events |
| `gap_detector.rs` / `completeness.rs` | Gap detection logic | Becomes the only job of the monitor loop — check for gaps, fill via RPC fallback |

### What stays as-is

| Current module | Why it stays |
|---|---|
| `balance/` module | Still need RPC for `balance_before`/`balance_after` (2 calls per event) |
| `counterparty.rs` | Still need `ft_metadata` RPC for decimals/symbol/icon |
| `swap_detector.rs` | Uses Intents Explorer API — unrelated to chain data |
| `history.rs` / `query_builder.rs` | Export and chart APIs — database queries, unchanged |

### Populating balance_changes fields

| Field | Source | RPC needed? |
|---|---|---|
| `account_id` | Parsed from logs or derived from `receiver_id` | No |
| `block_height` | `trigger_block_height` | No |
| `block_timestamp` | `trigger_block_timestamp` | No |
| `token_id` | Path B (receiver_id is DAO): `"near"`. Path A (log-based): `executor_id` for NEP-141, `"intents.near:..."` for NEP-245 | No |
| `balance_before` | balance at `trigger_block_height - 1` | **Yes — RPC call 1** |
| `balance_after` | balance at `trigger_block_height` | **Yes — RPC call 2** |
| `amount` | `balance_after - balance_before` | No (computed) |
| `transaction_hashes` | `transaction_hash` from Goldsky | No |
| `signer_id` | `signer_id` from Goldsky | No |
| `receiver_id` | `receiver_id` from Goldsky | No |
| `counterparty` | Parsed from logs or derived from signer/receiver | No |

**RPC is only needed for 2 calls per event** (balance before/after). Everything else comes from Goldsky data.

## Open Questions

1. **Neon free tier storage (0.5 GB)**: ~2 MB/day data rate, ~250 days before hitting the limit. Defer cleanup strategy for now.

2. **Staking rewards** — RESOLVED: Epoch-boundary gap detection compares staking balance against the last known balance after the most recent explicit interaction (from Goldsky). The difference is the pure reward. 1 RPC call per pool per epoch (~40 calls/day total).

3. **Data freshness / latency**: Trust Goldsky here — assume acceptable latency until proven otherwise.

4. **Enrichment worker concurrency**: Start sequential. Optimize to parallel batching later if needed.

5. **Non-sputnik accounts**: `meta-pool-dao-4.near` and other non-sputnik accounts still need the existing RPC-based approach.

## Implementation Checklist

### Done (pipeline deployment)
- [x] Verify NEAR dataset schemas via `goldsky dataset get`
- [x] Add Goldsky agent skills to `.agents/skills/`
- [x] Add Goldsky CLI + Turbo CLI to devcontainer
- [x] Create pipeline YAML config (`goldsky/pipelines/near-execution-outcomes.yaml`)
- [x] Create database migration (`nt-be/migrations/20260228000001_create_goldsky_indexed_tables.sql`)
- [x] Create Goldsky secret (`TREASURY_DB_SECRET`) with Neon Postgres credentials
- [x] Deploy pipeline and verify data flowing (~3,765+ rows confirmed)

### Next: enrichment worker
- [ ] Add Neon DB connection config (read-only, separate from app DB)
- [ ] Create `goldsky_cursors` migration in app DB for cursor tracking
- [ ] Implement `goldsky_enrichment.rs` — cursor-based fetch from Neon, parse logs, idempotent write to app DB
- [ ] Implement log parser: NEP-141 EVENT_JSON, NEP-245, wrap.near plain-text
- [ ] RPC calls only for `balance_before`/`balance_after` (2 per event)
- [ ] Ensure idempotency: `INSERT ... ON CONFLICT DO UPDATE` (upsert) so replays overwrite with better quality data
- [ ] Implement epoch-boundary staking reward detection (1 RPC/pool/epoch, diff against last interaction)

### Next: simplify monitor loop
- [ ] Remove dirty monitor (30-second polling loop) from main loop
- [ ] Replace main monitor loop: enrich from Goldsky → check for gaps → RPC fallback for gaps only
- [ ] Decouple binary search / transfer hints / gap filler from main loop (keep as on-demand backfill for new accounts)
- [ ] Keep RPC-based path for non-sputnik accounts

### Validation
- [ ] Run existing integration tests against Goldsky-enriched balance_changes — same expected outcomes, different data source
- [ ] Monitor RPC usage reduction
- [ ] Disable legacy binary search for sputnik-dao accounts

## Deployment Guide

### Prerequisites
- Goldsky CLI: `npm i -g @goldskycom/cli`
- Goldsky Turbo CLI: `curl -fsSL https://install-turbo.goldsky.com | sh`
- **x86_64 environment required** (GitHub Codespace, not ARM devcontainers)

### Deploy / update pipeline
```bash
goldsky login --token <API_KEY>
goldsky turbo apply goldsky/pipelines/near-execution-outcomes.yaml
```

### Monitor pipeline
```bash
goldsky turbo list
goldsky turbo log treasury-dao-outcomes
```

### Manage secrets
```bash
goldsky secret list
goldsky secret reveal TREASURY_DB_SECRET
goldsky secret update TREASURY_DB_SECRET --value 'postgres://...'
```

## References

- Goldsky NEAR datasets: Receipts, Transactions, Execution Outcomes, Blocks
- Goldsky CLI: `npm i -g @goldskycom/cli` (v13.0.2)
- Goldsky agent skills: https://github.com/goldsky-io/agent-skills
- Turbo pipelines: https://goldsky.com/products/turbo-pipelines
- Current balance tracking code: `nt-be/src/handlers/balance_changes/`
- Current `balance_changes` table: `nt-be/migrations/20251223000001_create_balance_changes.sql`
- FastNear pricing: Dev $69/mo (10M), Pro $199/mo (36M), Business $499/mo (100M)
- GitHub Issue: #301
- Draft PR: #302 (branch: `docs/goldsky-implementation-plan`)

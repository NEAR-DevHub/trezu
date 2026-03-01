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
│  ┌──────────────────────────────────────────┐       │
│  │ near.execution_outcomes (v1.1.0 Turbo)   │       │
│  │ start_at: earliest                        │       │
│  └─────────────────┬────────────────────────┘       │
│                    │                                 │
│          ┌─────────▼──────────┐                     │
│          │ SQL Transform      │                     │
│          │ dao_outcomes        │                     │
│          │                    │                     │
│          │ Filter:            │                     │
│          │ - logs mention     │                     │
│          │   sputnik-dao.near │                     │
│          │ - OR receiver_id   │                     │
│          │   LIKE             │                     │
│          │   %.sputnik-dao    │                     │
│          │   .near            │                     │
│          └─────────┬──────────┘                     │
│                    │                                 │
│          ┌─────────▼──────────┐                     │
│          │ Postgres Sink      │                     │
│          │ indexed_dao_       │                     │
│          │ outcomes           │                     │
│          └─────────┬──────────┘                     │
└────────────────────┼────────────────────────────────┘
                     │
            ┌────────▼────────┐
            │ Treasury26      │
            │ Backend         │
            │                 │
            │ Enrichment      │
            │ Worker:         │
            │ - Read from     │
            │   indexed_dao_  │
            │   outcomes      │
            │ - 2 RPC calls   │
            │   per event     │
            │   (balance at   │
            │   block N-1     │
            │   and block N)  │
            │ - Insert into   │
            │   balance_      │
            │   changes       │
            └─────────────────┘
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

    -- Enrichment status
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dao_outcomes_block ON indexed_dao_outcomes(trigger_block_height DESC);
CREATE INDEX idx_dao_outcomes_unprocessed ON indexed_dao_outcomes(processed) WHERE processed = FALSE;
CREATE INDEX idx_dao_outcomes_executor ON indexed_dao_outcomes(executor_id);
CREATE INDEX idx_dao_outcomes_receiver ON indexed_dao_outcomes(receiver_id);
CREATE INDEX idx_dao_outcomes_tx_hash ON indexed_dao_outcomes(transaction_hash);
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

### Phase 1: Enrichment worker (next)

Create `nt-be/src/handlers/balance_changes/goldsky_enrichment.rs`:

```rust
/// Process unprocessed indexed events into balance_changes records
pub async fn run_enrichment_cycle(
    pool: &PgPool,
    network: &NetworkConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Fetch unprocessed outcomes
    let unprocessed = sqlx::query!(
        "SELECT * FROM indexed_dao_outcomes
         WHERE processed = FALSE
         ORDER BY trigger_block_height ASC LIMIT 100"
    ).fetch_all(pool).await?;

    for outcome in unprocessed {
        // 2. Parse logs to determine token type and accounts involved
        let events = parse_outcome_events(&outcome);

        for event in events {
            // 3. Get balance before and after — ONLY 2 RPC calls per event
            let balance_before = get_balance_at_block(
                pool, network, &event.account_id, &event.token_id,
                outcome.trigger_block_height - 1
            ).await?;
            let balance_after = get_balance_at_block(
                pool, network, &event.account_id, &event.token_id,
                outcome.trigger_block_height
            ).await?;

            // 4. Skip if no actual balance change
            if balance_before == balance_after { continue; }

            // 5. Insert into balance_changes
            insert_balance_change(pool, BalanceChange {
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

        mark_processed(pool, &outcome.id).await?;
    }
    Ok(())
}
```

#### Event parsing

The enrichment worker needs to parse different log formats from `indexed_dao_outcomes`:

1. **NEP-141 FT transfers**: `EVENT_JSON:{"standard":"nep141","event":"ft_transfer","data":[{"old_owner_id":"...","new_owner_id":"...","amount":"..."}]}`
2. **NEP-245 intents transfers**: `EVENT_JSON:{"standard":"nep245","event":"mt_transfer",...}`
3. **wrap.near plain-text**: `Transfer 100000000000000000000000 from alice.near to bob.sputnik-dao.near`
4. **Receiver-based events** (no log parsing needed): When `receiver_id` is a DAO, the outcome itself tells us about native NEAR transfers, function calls, staking

#### Staking rewards handling

Staking rewards don't have explicit transactions — they accumulate silently. Goldsky catches staking pool *interactions* (outcomes where receiver_id is a staking pool), eliminating the binary search for those blocks. But silent reward accumulation between interactions still needs periodic epoch-boundary snapshots (1 RPC call per epoch per pool).

### Phase 2: Integration with existing system

#### Modify the monitor loop

1. **Primary path**: Read from `indexed_dao_outcomes` and run enrichment
2. **Fallback path**: Keep existing binary search for:
   - Non-sputnik accounts (e.g., `meta-pool-dao-4.near`)
   - Edge cases where Goldsky data is delayed
   - Historical backfill for newly added accounts

#### Replace deposit checking

The 30-second polling loop becomes unnecessary — Goldsky streams events and the enrichment worker picks them up.

#### Replace token discovery

FT tokens appear automatically in `indexed_dao_outcomes` logs when transfers mention a monitored account. Intents tokens appear in NEP-245 events.

### Phase 3: Validation and cutover

1. Run Goldsky enrichment alongside existing binary search
2. Compare results to verify correctness
3. Monitor RPC usage reduction
4. Gradually reduce binary search polling frequency
5. Once validated, disable binary search for sputnik-dao accounts

## Mapping to existing balance tracking system

### What Goldsky fully replaces

| Current module | What it does | Goldsky replacement |
|---|---|---|
| `binary_search.rs` | Finds exact block where balance changed (~27 RPC calls) | Pipeline tells us the exact blocks directly |
| `transfer_hints/fastnear.rs` | FastNear API hints to accelerate gap filling | Pipeline provides the same data natively |
| `transfer_hints/tx_resolver.rs` | Resolves receipt→transaction via RPC | `transaction_hash` and `signer_id` come directly from execution outcomes |
| `dirty_monitor.rs` (polling loop) | Polls every 30 seconds | Goldsky streams events — enrichment worker picks up new outcomes as they arrive |
| `token_discovery.rs` (receipt-based) | Scans counterparties to discover FT contracts | Pipeline surfaces new tokens automatically |
| `gap_filler.rs` | Multi-strategy gap filling | Replaced by enrichment worker — gaps don't form |

### What Goldsky partially replaces

| Current module | What stays | What changes |
|---|---|---|
| `staking_rewards.rs` | Epoch-boundary snapshots still needed for silent reward accumulation | Goldsky catches staking pool *interactions*, eliminating binary search for those blocks |
| `token_discovery.rs` (FastNear balance API) | Initial onboarding still needs `fetch_fastnear_ft_tokens` | New tokens discovered via pipeline events after onboarding |

### What stays as-is

| Current module | Why it stays |
|---|---|
| `balance/` module | Still need RPC for `balance_before`/`balance_after` (2 calls per event) |
| `counterparty.rs` | Still need `ft_metadata` RPC for decimals/symbol/icon |
| `swap_detector.rs` | Uses Intents Explorer API — unrelated to chain data |
| `gap_detector.rs` / `completeness.rs` | Database queries — unchanged |
| `history.rs` / `query_builder.rs` | Export and chart APIs — unchanged |

### Populating balance_changes fields from pipeline data

| Field | Source |
|---|---|
| `account_id` | Parsed from logs or derived from `receiver_id` |
| `block_height` | `trigger_block_height` |
| `block_timestamp` | `trigger_block_timestamp` |
| `token_id` | Parsed from logs: `"near"` for native, FT contract for NEP-141, `"intents.near:..."` for NEP-245 |
| `balance_before` | **RPC call 1**: balance at `trigger_block_height - 1` |
| `balance_after` | **RPC call 2**: balance at `trigger_block_height` |
| `amount` | `balance_after - balance_before` |
| `transaction_hashes` | `transaction_hash` from execution outcome |
| `signer_id` | `signer_id` from execution outcome |
| `receiver_id` | `receiver_id` from execution outcome |
| `counterparty` | Derived: if monitored account is receiver → counterparty is signer, and vice versa |

## Open Questions

1. **Neon free tier storage (0.5 GB)**: Current data rate is ~25 rows/1K blocks at ~1 KB/row. At ~86.4K blocks/day, that's ~2,160 rows/day (~2 MB/day). The 0.5 GB limit gives us ~250 days before we hit it. The enrichment worker should delete processed rows to keep the table small.

2. **Staking rewards without explicit transactions**: May still need periodic epoch-boundary snapshots. Consider keeping a simplified epoch-based staking check alongside Goldsky.

3. **Data freshness / latency**: What is the typical Goldsky NEAR data latency? If >30 seconds, consider keeping optimistic balance checking for the active UI session.

4. **Enrichment worker concurrency**: The enrichment loop should process events in parallel (batch RPC calls) during backfill to avoid being bottlenecked by sequential RPC.

5. **Goldsky delivery guarantees**: Does the Postgres sink use `INSERT ... ON CONFLICT DO NOTHING` or does it fail on duplicate primary keys? Need to understand exactly-once vs at-least-once semantics.

6. **Non-sputnik accounts**: `meta-pool-dao-4.near` and other non-sputnik accounts are not covered by the `%.sputnik-dao.near` filter. These continue using the existing binary search path.

## Implementation Checklist

- [x] Verify NEAR dataset schemas via `goldsky dataset get`
- [x] Add Goldsky agent skills to `.agents/skills/`
- [x] Add Goldsky CLI + Turbo CLI to devcontainer
- [x] Create pipeline YAML config (`goldsky/pipelines/near-execution-outcomes.yaml`)
- [x] Create database migration (`nt-be/migrations/20260228000001_create_goldsky_indexed_tables.sql`)
- [x] Create Goldsky secret (`TREASURY_DB_SECRET`) with Neon Postgres credentials
- [x] Deploy pipeline and verify data flowing (~3,765+ rows confirmed)
- [ ] Implement `goldsky_enrichment.rs` module with enrichment worker loop
- [ ] Implement event log parser (NEP-141 EVENT_JSON, NEP-245, wrap.near plain-text)
- [ ] Implement staking pool outcome detection
- [ ] Modify `account_monitor.rs` to read from `indexed_dao_outcomes` as primary source
- [ ] Add integration tests comparing Goldsky-based results with binary-search results
- [ ] Monitor RPC usage reduction after deployment
- [ ] Reduce polling frequency of legacy binary search path
- [ ] Implement processed-row cleanup to manage Neon storage

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

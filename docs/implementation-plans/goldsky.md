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

## Proposed Solution

Replace the scan/binary-search approach with **Goldsky Turbo pipelines** that stream relevant NEAR chain data into our Postgres database. Decouple **scanning** (finding which blocks have relevant events) from **enrichment** (getting balance_before/balance_after values).

### Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                  Goldsky Turbo Pipelines              │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ NEAR        │  │ Execution    │  │ NEAR        │ │
│  │ Receipts    │  │ Outcomes     │  │ Transactions │ │
│  │ Dataset     │  │ Dataset      │  │ Dataset      │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                │                  │        │
│         └────────┬───────┴──────────┬───────┘        │
│                  │                  │                 │
│          ┌───────▼───────┐  ┌──────▼───────┐        │
│          │ SQL/TS        │  │ SQL/TS       │        │
│          │ Transforms    │  │ Transforms   │        │
│          │ (filter by    │  │ (parse FT/   │        │
│          │  monitored    │  │  intents     │        │
│          │  accounts)    │  │  event logs) │        │
│          └───────┬───────┘  └──────┬───────┘        │
│                  │                  │                 │
│                  └────────┬─────────┘                 │
│                           │                          │
│                  ┌────────▼────────┐                  │
│                  │ Postgres Sink   │                  │
│                  │ indexed_events  │                  │
│                  └────────┬────────┘                  │
└───────────────────────────┼──────────────────────────┘
                            │
                   ┌────────▼────────┐
                   │ Treasury26      │
                   │ Backend         │
                   │                 │
                   │ Enrichment      │
                   │ Worker:         │
                   │ - Read from     │
                   │   indexed_events│
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

### Expected RPC reduction
- **Current**: ~100-200k calls/hour = 2.4-4.8M/day
- **With Goldsky**: ~2 RPC calls per balance change for enrichment. Even 1000 balance changes/day = ~2000 calls/day
- **Reduction**: ~1000-2400x fewer RPC calls

## Implementation Plan

### Phase 1: Repository setup and pipeline configuration

#### 1.1 Add Goldsky agent skills to the repository

Copy the official Goldsky agent skills into the existing `.agents/skills/` directory (already symlinked from `.claude/skills`):

```bash
# Clone the skills repo
git clone --depth 1 https://github.com/goldsky-io/agent-skills.git /tmp/goldsky-skills

# Copy skills into the existing agent skills directory
cp -r /tmp/goldsky-skills/skills/* .agents/skills/
```

#### 1.2 Create pipeline YAML directory

Create a `goldsky/` directory at the repository root to hold pipeline configurations:

```
goldsky/
├── README.md                           # Setup instructions and deployment guide
├── pipelines/
│   ├── near-receipts.yaml             # Pipeline 1: NEAR receipts for monitored accounts
│   ├── near-execution-outcomes.yaml   # Pipeline 2: Execution outcomes (FT/intents events)
│   └── near-transactions.yaml         # Pipeline 3: Transaction metadata
├── scripts/
│   ├── setup.sh                       # Install goldsky CLI + turbo extension, login
│   ├── deploy.sh                      # Deploy all pipelines
│   └── check-status.sh               # Check pipeline health
└── migrations/
    └── 001_create_indexed_events.sql  # New table for Goldsky-sourced events
```

#### 1.3 Pipeline YAML configurations

**Dataset schemas** (verified via `goldsky dataset get` on Feb 28 2026, all v1.1.0 Turbo):

- **near.receipts**: `receipt_id`, `predecessor_id`, `receiver_id`, `receipt` (JSON string with full action data), `block_height`, `block_hash`, `block_timestamp`, `priority`
- **near.execution_outcomes**: `id`, `executor_id`, `logs`, `status`, `transaction_hash`, `signer_id`, `receiver_id`, `trigger_block_height`, `trigger_block_hash`, `trigger_block_timestamp`, `gas_burnt`, `tokens_burnt`, `metadata`, `receipt_ids`, `transaction_id`
- **near.transactions**: `id`, `hash` (primary key), `signer_id`, `receiver_id`, `actions` (JSON string), `block_height`, `block_hash`, `block_timestamp`, `nonce`, `priority_fee`, `public_key`, `signature`, `has_outcome`, `receipt_outcome_count`

Key findings:
- All three are Turbo datasets (resolves open question #2)
- Receipts have a `receipt` JSON field containing full action data (Transfer amounts, FunctionCall method names, args) — resolves the action_kind/method_name concern
- Execution outcomes include `transaction_hash` and `signer_id` directly — no need for separate transaction resolution
- Transactions use `hash` as the column name (not `transaction_hash`) and `actions` as a JSON string
- Timestamps are in milliseconds (not nanoseconds like NEAR RPC)

##### Pipeline 1: NEAR Receipts (`goldsky/pipelines/near-receipts.yaml`)

This pipeline captures all receipts involving monitored treasury accounts. It provides: NEAR native transfers, function calls to/from treasuries, staking pool interactions. The `receipt` JSON field contains full action data for deriving action_kind, method_name, and counterparty.

```yaml
name: treasury-near-receipts
apiVersion: 3

sources:
  near_receipts:
    type: dataset
    dataset_name: near.receipts
    version: 1.1.0
    start_at: earliest

transforms:
  # Strategy: Use a suffix filter for *.sputnik-dao.near. Non-sputnik
  # accounts (e.g., meta-pool-dao-4.near) are not handled by Goldsky
  # pipelines and fall back to the existing binary search path.
  # The backend enrichment worker further filters against the
  # monitored_accounts table to only process registered DAOs.
  treasury_receipts:
    sql: |
      SELECT
        receipt_id,
        predecessor_id,
        receiver_id,
        receipt,
        block_height,
        block_hash,
        block_timestamp
      FROM near_receipts
      WHERE predecessor_id LIKE '%.sputnik-dao.near'
         OR receiver_id LIKE '%.sputnik-dao.near'
    primary_key: receipt_id

sinks:
  postgres:
    type: postgres
    table: indexed_near_receipts
    schema: public
    secret_name: TREASURY_DB_SECRET
    from: treasury_receipts
```

##### Pipeline 2: Execution Outcomes (`goldsky/pipelines/near-execution-outcomes.yaml`)

This pipeline captures execution outcomes that contain FT transfer events (NEP-141) and intents multi-token events (NEP-245). Filters by both event standard AND sputnik-dao suffix in the logs. Also captures `transaction_hash` and `signer_id` directly — no need for Pipeline 3 to resolve these.

```yaml
name: treasury-ft-events
apiVersion: 3

sources:
  near_outcomes:
    type: dataset
    dataset_name: near.execution_outcomes
    version: 1.1.0
    start_at: earliest

transforms:
  # Filter execution outcomes that are both FT/intents events AND mention
  # a sputnik-dao account. NEP-141/NEP-245 event logs contain full account
  # IDs (old_owner_id, new_owner_id), so we can filter by suffix directly.
  ft_and_intents_events:
    sql: |
      SELECT
        id,
        executor_id,
        logs,
        status,
        transaction_hash,
        signer_id,
        receiver_id,
        trigger_block_height,
        trigger_block_hash,
        trigger_block_timestamp
      FROM near_outcomes
      WHERE (logs LIKE '%"standard":"nep141"%'
             OR logs LIKE '%"standard":"nep245"%'
             OR executor_id = 'intents.near')
        AND logs LIKE '%sputnik-dao.near%'
    primary_key: id

sinks:
  postgres:
    type: postgres
    table: indexed_ft_events
    schema: public
    secret_name: TREASURY_DB_SECRET
    from: ft_and_intents_events
```

##### Pipeline 3: Transactions metadata (`goldsky/pipelines/near-transactions.yaml`)

For resolving transaction hashes, signers, and method names. Note: Pipeline 2 (execution_outcomes) already includes `transaction_hash` and `signer_id`, so Pipeline 3 may be optional — it's mainly useful for getting the `actions` JSON with method names for transactions that don't produce FT events.

```yaml
name: treasury-near-transactions
apiVersion: 3

sources:
  near_transactions:
    type: dataset
    dataset_name: near.transactions
    version: 1.1.0
    start_at: earliest

transforms:
  # Filter transactions where receiver is a monitored account.
  # Sputnik DAO accounts are contracts without full access keys — they
  # cannot sign transactions. Transactions are always signed by council
  # members with the DAO as receiver_id.
  treasury_transactions:
    sql: |
      SELECT
        hash,
        signer_id,
        receiver_id,
        actions,
        block_height,
        block_hash,
        block_timestamp
      FROM near_transactions
      WHERE receiver_id LIKE '%.sputnik-dao.near'
    primary_key: hash

sinks:
  postgres:
    type: postgres
    table: indexed_transactions
    schema: public
    secret_name: TREASURY_DB_SECRET
    from: treasury_transactions
```

### Phase 2: Database schema for indexed events

#### 2.1 New migration: `indexed_near_receipts` table

```sql
-- Receipts involving monitored treasury accounts, populated by Goldsky pipeline
CREATE TABLE indexed_near_receipts (
    receipt_id TEXT PRIMARY KEY,
    predecessor_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    receipt TEXT,              -- JSON string with full action data (Transfer, FunctionCall, etc.)
    block_height BIGINT NOT NULL,
    block_hash TEXT,
    block_timestamp BIGINT NOT NULL,  -- milliseconds (not nanoseconds like NEAR RPC)

    -- Enrichment status
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_indexed_receipts_block ON indexed_near_receipts(block_height DESC);
CREATE INDEX idx_indexed_receipts_unprocessed ON indexed_near_receipts(processed) WHERE processed = FALSE;
CREATE INDEX idx_indexed_receipts_predecessor ON indexed_near_receipts(predecessor_id);
CREATE INDEX idx_indexed_receipts_receiver ON indexed_near_receipts(receiver_id);
```

#### 2.2 New migration: `indexed_ft_events` table

```sql
-- FT/intents transfer events from execution outcomes, populated by Goldsky pipeline
CREATE TABLE indexed_ft_events (
    id TEXT PRIMARY KEY,
    executor_id TEXT NOT NULL,
    logs TEXT,                -- Contains EVENT_JSON with transfer details
    status TEXT,
    transaction_hash TEXT,    -- Available directly from execution_outcomes dataset
    signer_id TEXT,
    receiver_id TEXT,
    trigger_block_height BIGINT NOT NULL,
    trigger_block_hash TEXT,
    trigger_block_timestamp BIGINT NOT NULL,  -- milliseconds

    -- Parsed event data (populated by enrichment worker)
    token_id TEXT,            -- e.g., "wrap.near" or "intents.near:nep141:usdc.near"
    account_id TEXT,          -- The monitored account involved
    counterparty TEXT,        -- The other party
    amount NUMERIC,           -- Transfer amount (parsed from event)

    -- Enrichment status
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_indexed_ft_block ON indexed_ft_events(trigger_block_height DESC);
CREATE INDEX idx_indexed_ft_unprocessed ON indexed_ft_events(processed) WHERE processed = FALSE;
CREATE INDEX idx_indexed_ft_executor ON indexed_ft_events(executor_id);
CREATE INDEX idx_indexed_ft_account ON indexed_ft_events(account_id);
```

#### 2.3 New migration: `indexed_transactions` table

```sql
-- Transaction metadata for monitored accounts, populated by Goldsky pipeline
CREATE TABLE indexed_transactions (
    hash TEXT PRIMARY KEY,
    signer_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    actions TEXT,              -- JSON string with action data (method names, args, deposits)
    block_height BIGINT NOT NULL,
    block_hash TEXT,
    block_timestamp BIGINT NOT NULL,  -- milliseconds

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_indexed_tx_block ON indexed_transactions(block_height DESC);
CREATE INDEX idx_indexed_tx_receiver ON indexed_transactions(receiver_id);
```

### Phase 3: Enrichment worker

Create a new module `nt-be/src/handlers/balance_changes/goldsky_enrichment.rs` that replaces the binary search gap-filling approach.

#### 3.1 Core enrichment loop

```rust
// Pseudocode for the enrichment worker

/// Process unprocessed indexed events into balance_changes records
pub async fn run_enrichment_cycle(
    pool: &PgPool,
    network: &NetworkConfig,  // archival RPC for balance queries
) -> Result<(), Box<dyn std::error::Error>> {

    // 1. Fetch unprocessed receipts involving monitored accounts
    let unprocessed_receipts = sqlx::query!(
        "SELECT * FROM indexed_near_receipts WHERE processed = FALSE ORDER BY block_height ASC LIMIT 100"
    ).fetch_all(pool).await?;

    for receipt in unprocessed_receipts {
        // 2. Determine which monitored account and token type
        let (account_id, token_id) = determine_account_and_token(&receipt);

        // 3. Get balance before and after — ONLY 2 RPC calls per event
        let balance_before = balance::get_balance_at_block(
            pool, network, &account_id, &token_id, receipt.block_height - 1
        ).await?;
        let balance_after = balance::get_balance_at_block(
            pool, network, &account_id, &token_id, receipt.block_height
        ).await?;

        // 4. Skip if no actual balance change
        if balance_before == balance_after {
            mark_processed(pool, &receipt.receipt_id).await?;
            continue;
        }

        // 5. Derive metadata from receipt data (no additional RPC needed)
        let counterparty = if receipt.receiver_id == account_id {
            receipt.predecessor_id.clone()  // incoming: sender is counterparty
        } else {
            receipt.receiver_id.clone()     // outgoing: receiver is counterparty
        };
        let (action_kind, method_name) = extract_action_metadata(&receipt.raw_data);
        let tx_hashes = resolve_tx_hashes_from_indexed(pool, &receipt).await?;

        // 6. Insert into balance_changes (same schema as current system)
        insert_balance_change(pool, BalanceChange {
            account_id,
            token_id,
            block_height: receipt.block_height,
            block_timestamp: receipt.block_timestamp,
            balance_before,
            balance_after,
            amount: &balance_after - &balance_before,
            transaction_hashes: tx_hashes,
            receipt_id: vec![receipt.receipt_id.clone()],
            signer_id: Some(receipt.predecessor_id.clone()),
            receiver_id: Some(receipt.receiver_id.clone()),
            counterparty,
            action_kind,   // e.g., "Transfer", "FunctionCall"
            method_name,   // e.g., "ft_transfer", "deposit_and_stake"
            actions: receipt.raw_data.clone(),  // full action JSON from pipeline
            raw_data: receipt.raw_data.clone(),
        }).await?;

        mark_processed(pool, &receipt.receipt_id).await?;
    }

    // 7. Process FT/intents events similarly
    process_ft_events(pool, network).await?;

    Ok(())
}
```

#### 3.2 FT event parsing

Parse NEP-141 EVENT_JSON logs to extract transfer details:

```rust
/// Parse NEP-141 event logs to find transfers involving monitored accounts
fn parse_ft_event_logs(logs: &str, monitored_accounts: &HashSet<String>) 
    -> Vec<FtTransferEvent> 
{
    // NEP-141 logs look like:
    // EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer",
    //   "data":[{"old_owner_id":"alice.near","new_owner_id":"bob.near","amount":"1000000"}]}
    //
    // Parse each log line, check if old_owner_id or new_owner_id is in monitored_accounts
    // Return structured transfer events
}
```

#### 3.3 Staking rewards handling

Instead of binary-searching for staking reward blocks, use Goldsky data to identify staking pool interactions:

```rust
/// Process staking-related events from indexed receipts
///
/// Staking rewards don't have explicit transactions — they accumulate when
/// anyone calls `ping` on the staking pool, or when the account unstakes/withdraws.
///
/// Strategy:
/// 1. From indexed_near_receipts, find all receipts to/from staking pools
///    (*.poolv1.near, *.pool.near, etc.)
/// 2. For each such receipt, query the staking balance at that block
/// 3. Compare with previous known staking balance to compute reward
///
/// This eliminates binary search entirely — we know exactly which blocks
/// had staking pool interactions from the indexed data.
```

#### 3.4 Intents token handling

```rust
/// Process intents (NEP-245 multi-token) events
///
/// Filter indexed_ft_events where executor_id = 'intents.near'
/// or logs contain '"standard":"nep245"'
///
/// Parse mt_transfer events to extract:
/// - token_ids (e.g., "nep141:usdc.near", "nep141:btc.omft.near") 
/// - owner_id / new_owner_id
/// - amounts
///
/// The intents token_id format in balance_changes is: "intents.near:<token_id>"
```

### Phase 4: Integration with existing system

#### 4.1 Modify the monitor loop

The current `run_monitor_cycle` in `account_monitor.rs` should be modified to:

1. **Primary path**: Read from `indexed_*` tables (populated by Goldsky) and run enrichment
2. **Fallback path**: Keep the existing binary search as a fallback for:
   - Tokens not yet covered by Goldsky pipelines
   - Edge cases where Goldsky data is delayed
   - Historical backfill for newly added old DAOs (until Goldsky catches up)

#### 4.2 Replace deposit checking

The current 30-second polling loop for deposit checking (`dirty_monitor.rs`) can be replaced:
- Goldsky streams events in near-real-time
- When a new receipt appears in `indexed_near_receipts`, the enrichment worker picks it up
- No need to poll RPC for "has anything changed?"

#### 4.3 Replace token discovery

Current token discovery via FastNear API can be supplemented:
- FT tokens appear automatically in `indexed_ft_events` when a transfer mentions a monitored account
- Intents tokens appear when `intents.near` execution outcomes mention the account
- Staking pools appear when receipts show interactions with `*.poolv1.near` etc.

### Phase 5: Goldsky secret management

#### 5.1 Create Postgres secret for Goldsky

```bash
# Create the database secret that Goldsky pipelines will use to write data
goldsky secret create TREASURY_DB_SECRET --value '{
  "type": "jdbc",
  "protocol": "postgresql",
  "host": "<RENDER_POSTGRES_HOST>",
  "port": 5432,
  "databaseName": "<DB_NAME>",
  "user": "<DB_USER>",
  "password": "<DB_PASSWORD>"
}'
```

#### 5.2 Deploy pipelines

```bash
# Deploy all pipelines
goldsky pipeline apply goldsky/pipelines/near-receipts.yaml --status ACTIVE
goldsky pipeline apply goldsky/pipelines/near-execution-outcomes.yaml --status ACTIVE
goldsky pipeline apply goldsky/pipelines/near-transactions.yaml --status ACTIVE

# Monitor pipeline health
goldsky pipeline list
goldsky pipeline monitor treasury-near-receipts
```

## Mapping to existing balance tracking system

### What Goldsky fully replaces

| Current module | What it does | Goldsky replacement |
|---|---|---|
| `binary_search.rs` | Finds exact block where balance changed (~27 RPC calls per discovery) | Pipeline 1 (receipts) and Pipeline 2 (FT events) tell us the exact blocks directly — no probing needed |
| `transfer_hints/fastnear.rs` | FastNear Transfers API provides block-level hints to accelerate gap filling | Pipeline 1 provides the same data natively — receipts arrive with block_height, predecessor, receiver |
| `transfer_hints/tx_resolver.rs` | Resolves receipt→transaction via `EXPERIMENTAL_receipt`, chunk lookups, `experimental_tx_status` | Pipeline 3 (transactions) provides tx hashes, signers, receivers, method names directly |
| `dirty_monitor.rs` (polling loop) | Polls every 30 seconds to check if anything changed | Goldsky streams events — enrichment worker picks up new receipts as they arrive |
| `token_discovery.rs` (receipt-based) | Scans counterparties in balance_changes to discover FT contracts | Pipeline 2 surfaces new tokens automatically when transfers involving monitored accounts happen |
| `gap_filler.rs` (hint resolution) | Multi-strategy gap filling using FastNear hints, tx resolution, or binary search fallback | Replaced by the enrichment worker — gaps don't form because events arrive proactively |

**The entire `transfer_hints/` module (`fastnear.rs`, `tx_resolver.rs`, `mod.rs`) can be removed.**

### What Goldsky partially replaces

| Current module | What stays | What changes |
|---|---|---|
| `staking_rewards.rs` | Epoch-boundary snapshots still needed (~1 RPC call per epoch per pool) — staking rewards accumulate silently between interactions | Goldsky catches staking pool *interactions* (receipts to `*.poolv1.near`), eliminating the binary search for those blocks. But silent reward accumulation between interactions still needs periodic epoch checks |
| `token_discovery.rs` (FastNear balance API) | Initial onboarding of accounts with pre-existing token holdings still needs `fetch_fastnear_ft_tokens` — Goldsky only catches *transfers*, not "what do you already hold?" | Once an account is onboarded, new tokens are discovered via Pipeline 2 events |
| `token_discovery.rs` (intents) | `mt_tokens_for_owner` still needed for initial intents token snapshot — there's no transfer event for tokens already held | Ongoing intents token discovery covered by Pipeline 2 (NEP-245 events) |

### What Goldsky does NOT replace (modules that stay as-is)

| Current module | Why it stays |
|---|---|
| `balance/` module (`near.rs`, `ft.rs`, `intents.rs`, `staking.rs`) | Still need RPC for `balance_before` / `balance_after` — the 2 calls per event in the enrichment worker |
| `counterparty.rs` | Still need `ft_metadata` RPC for decimal conversion and token symbol/icon |
| `swap_detector.rs` | Uses Intents Explorer API — completely separate from chain data, unrelated to Goldsky |
| `gap_detector.rs` / `completeness.rs` | Database queries for gap analysis — unchanged |
| `history.rs` / `query_builder.rs` | Export and chart APIs — database queries, unchanged |
| `block_info.rs` | May still be needed for block timestamp lookups during enrichment, though Goldsky receipts include `block_timestamp` |

### Populating balance_changes fields from Goldsky data

The enrichment worker can populate all `balance_changes` fields from pipeline data + 2 RPC calls:

| Field | Source |
|---|---|
| `account_id` | Pipeline 1: `predecessor_id` or `receiver_id` (whichever is the monitored account) |
| `block_height` | Pipeline 1: `block_height` |
| `block_timestamp` | Pipeline 1: `block_timestamp` |
| `token_id` | Determined from receipt action data: `"near"` for Transfer actions, FT contract address for `ft_transfer`/`ft_transfer_call`, `"intents.near:..."` for intents events, `"staking:..."` for staking pool receipts |
| `balance_before` | **RPC call 1**: `balance::get_balance_at_block(block_height - 1)` |
| `balance_after` | **RPC call 2**: `balance::get_balance_at_block(block_height)` |
| `amount` | Computed: `balance_after - balance_before` |
| `transaction_hashes` | Pipeline 3: JOIN `indexed_transactions` on block_height + account match, or from receipt's `raw_data` if available |
| `receipt_id` | Pipeline 1: `receipt_id` |
| `signer_id` | Pipeline 1: `predecessor_id` (the receipt sender) |
| `receiver_id` | Pipeline 1: `receiver_id` |
| `counterparty` | Derived from receipt: if monitored account is `receiver_id` → counterparty is `predecessor_id`, and vice versa. Special values: `"SNAPSHOT"` for initial snapshots, `"STAKING_SNAPSHOT"` / `"STAKING_REWARD"` for staking entries |
| `action_kind` | Pipeline 1: extracted from receipt action data in `raw_data` — e.g., `"Transfer"`, `"FunctionCall"`. **Requires pipeline to include action details** (verify schema includes actions field) |
| `method_name` | Pipeline 1: extracted from FunctionCall actions in `raw_data` — e.g., `"ft_transfer"`, `"deposit_and_stake"`. **Same requirement as action_kind** |
| `actions` | Pipeline 1: full action JSON from `raw_data` |
| `raw_data` | Pipeline 1: full receipt data as stored by Goldsky |

**~~Key requirement~~** — RESOLVED: The `near.receipts` dataset includes a `receipt` field containing the full action data as a JSON string (Transfer amounts, FunctionCall method names/args, etc.). No additional RPC calls needed for action_kind or method_name. Additionally, `near.execution_outcomes` includes `transaction_hash` and `signer_id` directly, eliminating the need for separate transaction resolution for FT events.

## Key Decisions & Open Questions

### Must investigate before implementation:

1. **~~NEAR dataset schemas~~** — RESOLVED (Feb 28 2026): Schemas verified via `goldsky dataset get`. All three datasets are v1.1.0. Pipeline YAML configs and database migrations updated with actual column names. Key finding: `receipt` field in near.receipts contains full action data as JSON; execution_outcomes includes `transaction_hash` and `signer_id` directly; timestamps are in milliseconds.

2. **~~Turbo vs Mirror for NEAR~~** — RESOLVED: All three datasets confirmed as Turbo (`displayName: "... (turbo)"`).

3. **~~Dynamic tables for NEAR~~** — RESOLVED: Pipelines use a `LIKE '%.sputnik-dao.near'` suffix filter which covers all sputnik DAOs without any pipeline redeployment. Non-sputnik accounts (currently only `meta-pool-dao-4.near`) fall back to the existing binary search path. The backend enrichment worker further filters against the `monitored_accounts` table to only process registered DAOs.

4. **Fast Scan / historical backfill**: Can we filter at the source level (`filter` attribute) to speed up initial backfill? This is important for NEAR given the chain has 180M+ blocks.

5. **~~Volume estimates for FT events pipeline~~** — RESOLVED: Pipeline 2 now filters by both event standard AND sputnik-dao suffix (`logs LIKE '%sputnik-dao.near%'`). Still worth estimating volume to confirm it fits within Goldsky tier limits.

6. **Staking rewards without explicit transactions**: Staking rewards accumulate silently — they only become visible when someone interacts with the staking pool. Goldsky can tell us when interactions happen, but we may still need periodic epoch-boundary snapshots. Consider keeping a simplified epoch-based staking check (1 RPC call per epoch per pool) alongside the Goldsky approach.

7. **Data freshness / latency**: What is the typical latency of Goldsky NEAR data? If it's >30 seconds, we may want to keep the "optimistic" balance checking (current latest-block polling) for the active UI session and use Goldsky for the historical gap filling.

### Architecture decisions:

8. **Separate pipelines vs single pipeline**: The proposal uses 3 separate pipelines (receipts, outcomes, transactions). Consider whether a single pipeline with multiple transforms + sinks would be simpler to manage.

9. **Keep binary search as fallback**: The binary search code should NOT be removed immediately. Keep it as a fallback for edge cases and for verifying Goldsky data correctness during the transition period.

10. **Database impact**: Goldsky writes directly to our Postgres. Consider whether we need a separate database/schema, or if writing to the existing database is fine. Ensure the Goldsky sink user has write access only to the `indexed_*` tables.

### Design concerns to address:

11. **~~Most receipts won't be balance changes~~** — NOT A CONCERN: DAO operations (proposals, votes, policy changes, role updates) all change the available NEAR balance through proposal bonds, storage staking, and gas costs. Most receipts involving a DAO do result in a balance change, so the 2 RPC calls per receipt are not wasted.

12. **Pipeline 1 and Pipeline 2 overlap — define clear ownership**: An FT transfer to a monitored DAO produces both a receipt (Pipeline 1) AND an execution outcome with NEP-141 logs (Pipeline 2). Now that both pipelines filter by monitored accounts, define clear ownership: Pipeline 1 handles NEAR native transfers and staking pool interactions, Pipeline 2 handles FT/intents token balance changes. The enrichment worker should process each pipeline for its designated token types only.

13. **`determine_account_and_token()` is non-trivial**: A single receipt could affect NEAR balance (if it has a deposit), an FT balance (if it's an ft_transfer callback), or multiple tokens simultaneously. Cross-contract calls can trigger balance changes indirectly — a receipt to contract A might cause A to call ft_transfer on contract B, changing the DAO's FT balance. The receipt alone doesn't tell you which tokens were affected. This function needs careful design.

14. **~~Pipeline 2 volume may be unworkable~~** — RESOLVED: Pipeline 2 now filters with `AND logs LIKE '%sputnik-dao.near%'`, reducing volume from "all FT events on NEAR" to "only FT events mentioning sputnik-dao accounts." Same suffix strategy as Pipelines 1 and 3.

15. **No backfill strategy beyond `start_at: earliest`**: All pipelines start from the earliest NEAR block (~180M+ blocks). But the existing `balance_changes` table already has historical data. Should we start from a recent block (`max(block_height)` in balance_changes) and rely on existing data for history? Or backfill from the beginning, duplicating work?

16. **Enrichment worker needs concurrency**: The pseudocode processes receipts sequentially — one receipt, 2 RPC calls, wait, next. During backfill with thousands of unprocessed receipts, this would be extremely slow. Needs batch/parallel processing similar to how `dirty_monitor.rs` spawns parallel tokio tasks.

17. **Goldsky delivery guarantees**: If a pipeline restarts or replays, it may re-send events. Does the Postgres sink use `INSERT ... ON CONFLICT DO NOTHING` or does it fail on duplicate primary keys? Need to understand exactly-once vs at-least-once semantics.

18. **~~`SELECT *` alongside named columns in pipeline SQL~~** — RESOLVED: Pipeline SQL now uses explicit column lists based on verified schemas.

## Implementation Checklist

- [x] Run `goldsky dataset get near.receipts` / `near.execution_outcomes` / `near.transactions` to get actual schemas
- [ ] Create `goldsky/` directory structure in repo  
- [ ] Copy Goldsky agent skills to `.agents/skills/` (from https://github.com/goldsky-io/agent-skills)
- [ ] Create Postgres secret in Goldsky (`TREASURY_DB_SECRET`)
- [ ] Write and validate pipeline YAML configs based on actual schemas
- [ ] Create database migrations for `indexed_near_receipts`, `indexed_ft_events`, `indexed_transactions`
- [ ] Deploy pipelines and verify data flows into Postgres
- [ ] Implement `goldsky_enrichment.rs` module with enrichment worker loop
- [ ] Implement FT event log parser (NEP-141 EVENT_JSON)
- [ ] Implement intents event parser (NEP-245)  
- [ ] Implement staking pool receipt detection
- [ ] Modify `account_monitor.rs` to read from indexed tables as primary source
- [ ] Add integration tests comparing Goldsky-based results with binary-search results
- [ ] Monitor RPC usage reduction after deployment
- [ ] Once validated, reduce polling frequency of legacy binary search path
- [ ] Document deployment and management procedures in `goldsky/README.md`

## References

- Goldsky NEAR datasets: Receipts, Transactions, Execution Outcomes, Blocks (see screenshot)
- Goldsky CLI: `npm i -g @goldskycom/cli` (v13.0.2)
- Goldsky agent skills: https://github.com/goldsky-io/agent-skills
- Pipeline config docs: https://docs.goldsky.com/reference/config-file/pipeline
- Turbo pipelines: https://goldsky.com/products/turbo-pipelines
- FastNear usage discussion: internal Telegram thread Feb 26, 2026
- Current balance tracking code: `nt-be/src/handlers/balance_changes/`
- Current `balance_changes` table: `nt-be/migrations/20251223000001_create_balance_changes.sql`
- FastNear pricing: Dev $69/mo (10M), Pro $199/mo (36M), Business $499/mo (100M)

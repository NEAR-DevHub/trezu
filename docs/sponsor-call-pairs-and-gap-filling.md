# Sponsor Call Pairs & Gap Filling

## What is a Sponsor Call Pair?

On NEAR, DAO members interact with their DAO contract (e.g. `trezu-demo.sputnik-dao.near`) by calling functions like `add_proposal` or `act_proposal`. Normally the caller pays gas fees. Treasury26 uses a **sponsor** (`sponsor.trezu.near`) to relay these calls so DAO members don't pay gas themselves.

A sponsor call pair in the Goldsky `indexed_dao_outcomes` table looks like this:

| Field | Outcome 1 (initiator) | Outcome 2 (execution) |
|-------|----------------------|----------------------|
| `id` | `6riK8C...` | `eVdHuT...` |
| `executor_id` | `sponsor.trezu.near` | `trezu-demo.sputnik-dao.near` |
| `signer_id` | `sponsor.trezu.near` | `sponsor.trezu.near` |
| `receiver_id` | `trezu-demo.sputnik-dao.near` | `trezu-demo.sputnik-dao.near` |
| `status` | `SuccessReceiptId: "eVdHuT..."` | `SuccessValue: ""` |
| `logs` | *(empty)* | *(empty)* |
| `trigger_block_height` | 187009106 | 187009106 |
| `transaction_hash` | `6riK8C...` | `6riK8C...` |

Both outcomes share the same block height and transaction hash. The first outcome's `SuccessReceiptId` points to the second outcome's `id`.

### What the sponsor actually does

When frol.near wants to call `add_proposal` on the DAO:

1. The Treasury frontend sends the request through `sponsor.trezu.near`
2. `sponsor.trezu.near` calls `trezu-demo.sputnik-dao.near` (paying gas)
3. The DAO contract executes the function (e.g. `add_proposal`)
4. Goldsky captures both outcomes (the sponsor call and the DAO execution)

The actual `add_proposal` or `act_proposal` happens in a **separate receipt** at a slightly different block height (typically a few blocks later). This is because NEAR processes cross-contract calls asynchronously.

## How Enrichment Processes Sponsor Call Pairs

The enrichment worker matches outcomes to monitored accounts via **Path B** (receiver-based):

```
if receiver_id ends with ".sputnik-dao.near"
    → create NEAR balance change at trigger_block_height
    → counterparty = signer_id (sponsor.trezu.near)
```

Since the sponsor call pair has no logs (no FT transfer events), the enrichment worker queries the archival RPC for the NEAR balance before and after the block. This creates a balance change record with:
- `counterparty = "sponsor.trezu.near"`
- A tiny NEAR balance change (gas refund or fee)

**These records are filtered out by the API** (`WHERE counterparty != 'sponsor.trezu.near'`).

## Where the Real Transactions Live

The actual user transactions (add_proposal, act_proposal) happen at blocks **between** the sponsor call blocks. For example:

```
Block 187009106  → sponsor call pair (enrichment creates NEAR record)
Block 187009114  → frol.near calls add_proposal (NOT in Goldsky data)
Block 187009379  → sponsor call pair (enrichment creates NEAR record)
Block 187009388  → frol.near calls add_proposal (NOT in Goldsky data)
Block 187009483  → sponsor call pair (enrichment creates NEAR record)
Block 187009491  → USDC ft_transfer (enrichment catches via logs)
Block 187009493  → frol.near calls act_proposal (NOT in Goldsky data)
```

The add_proposal and act_proposal calls change the DAO's NEAR balance (storage deposit fees, execution costs). Before the pipeline update (see [Pipeline Update](#pipeline-update-executor_id-filter) below), they were **not captured by Goldsky** because the pipeline only filtered on `receiver_id` and `logs`, missing outcomes where the DAO is the `executor_id`.

## How Gap Filling Discovers Missing Transactions

The maintenance worker runs after enrichment and fills these gaps:

### Step 1: Detect gaps between records

After enrichment, the NEAR `balance_changes` timeline looks like this (simplified):

```
Block 187009106  NEAR balance: 0.5841...  (from sponsor call)
Block 187009379  NEAR balance: 0.5816...  (from sponsor call)
                 ↑ balance dropped by ~0.0026 NEAR — WHERE did it change?
```

The gap filler sees that `balance_after` at 187009106 ≠ `balance_before` at 187009379. There's an unexplained balance change somewhere in between.

### Step 2: Binary search via archival RPC

The gap filler does a binary search on the archival RPC:

```
Check block 187009242 (midpoint)  → balance = 0.5841... (same as 187009106)
Check block 187009310 (midpoint)  → balance = 0.5841... (same)
Check block 187009345             → balance = 0.5841...
Check block 187009362             → balance = 0.5841...
Check block 187009371             → balance = 0.5841...
...narrow down...
Check block 187009114             → balance = 0.5815... (CHANGED!)
Check block 187009113             → balance = 0.5841... (not changed yet)
→ Balance changed at block 187009114!
```

This takes ~10 RPC calls per gap (log₂ of block range).

### Step 3: Create the missing record

The gap filler creates a new `balance_change` record:
- `block_height = 187009114`
- `amount = -0.0026054842887204`
- `counterparty = frol.near` (resolved via FastNear tx lookup)
- `method_name = add_proposal`

### Step 4: Repeat for remaining gaps

After filling the gap at 187009114, there may be new gaps between 187009114 and 187009379. The process repeats until all gaps are resolved.

## Complete Gap-Fill Map for trezu-demo.sputnik-dao.near

The table below shows **every NEAR balance change** in chronological order. Records from enrichment (sponsor calls) are marked as the "scaffold" — they're filtered out by the API but serve as anchors for gap filling. Records discovered by maintenance are the actual user transactions visible in the API.

| Block | Source | Amount (NEAR) | Counterparty | Method | API visible? |
|-------|--------|--------------|--------------|--------|-------------|
| 187008674 | maintenance | CreateAccount | system | - | No (filtered) |
| **187009106** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187009107 | maintenance | +0.00287 | UNKNOWN | - | Yes |
| 187009114 | maintenance | -0.00261 | frol.near | add_proposal | Yes |
| **187009379** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187009380 | maintenance | +0.00982 | UNKNOWN | - | Yes |
| 187009388 | maintenance | -0.00955 | frol.near | add_proposal | Yes |
| **187009483** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187009493 | maintenance | -0.00066 | frol.near | act_proposal | Yes |
| 187009495 | maintenance | +0.00006 | USDC contract | - | Yes |
| **187010038** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187010039 | maintenance | +0.00992 | UNKNOWN | - | Yes |
| 187010047 | maintenance | -0.00965 | frol.near | add_proposal | Yes |
| **187010261** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187010262 | maintenance | +0.00982 | UNKNOWN | - | Yes |
| 187010270 | maintenance | -0.00955 | frol.near | add_proposal | Yes |
| **187010432** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187010441 | maintenance | -0.00068 | frol.near | act_proposal | Yes |
| 187010861 | maintenance | +20 | intents.near | Transfer | Yes |
| **187015553** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187015554 | maintenance | +0.02059 | UNKNOWN | - | Yes |
| 187015561 | maintenance | -0.02030 | frol.near | add_proposal | Yes |
| **187015593** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187015594 | maintenance | +0.00093 | UNKNOWN | - | Yes |
| 187015601 | maintenance | -0.00092 | frol.near | act_proposal | Yes |
| **187016290** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187016291 | maintenance | +0.00982 | UNKNOWN | - | Yes |
| 187016298 | maintenance | -0.00957 | theori.near | add_proposal | Yes |
| **187016345** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187016355 | maintenance | +0.00006 | USDC contract | - | Yes |
| 187016448 | maintenance | -0.02019 | theori.near | add_proposal | Yes |
| **187016439** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| **187016601** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187016609 | maintenance | -0.00915 | theori.near | add_proposal | Yes |
| **187016658** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187016668 | maintenance | +0.00006 | wrap.near | - | Yes |
| **187027528** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187027536 | maintenance | -0.00542 | theori.near | add_proposal | Yes |
| **187027638** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187027650 | maintenance | +0.00005 | USDC contract | - | Yes |
| **187037337** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187037346 | maintenance | -0.00966 | theori.near | add_proposal | Yes |
| **187037953** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187037963 | maintenance | -0.00065 | theori.near | act_proposal | Yes |
| **187136059** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187136068 | maintenance | -0.02019 | theori.near | add_proposal | Yes |
| **187136304** | **enrichment** | ~0 (gas refund) | sponsor.trezu.near | - | **No** (sponsor) |
| 187136312 | maintenance | -0.00431 | theori.near | add_proposal | Yes |

### The pattern

Every sponsor call pair at block N creates a "scaffold" record. The actual user transaction is always 1-10 blocks later at block N+k. With the original pipeline, the maintenance worker's binary search discovered these by finding where the NEAR balance changed between scaffold records.

With the [updated pipeline](#pipeline-update-executor_id-filter), the `add_proposal` and `act_proposal` outcomes at N+k are captured directly by Goldsky (matched via `executor_id`), so enrichment creates records at the correct block. The gap filler still discovers the storage deposit refunds.

The "UNKNOWN" counterparty records with small positive amounts (+0.00287, +0.00982, etc.) are **storage deposit refunds** from the DAO contract — NEAR returned when a proposal is created or executed.

## Cost Analysis

For 51 Goldsky outcomes with 20 sponsor call pairs:

| Phase | RPC calls | Time | What it does |
|-------|-----------|------|-------------|
| Enrichment | ~96 | 26s | Process all 51 outcomes, create initial balance changes |
| Maintenance cycle 1 | 352 | 137s | Fill 20 NEAR gaps + intents token discovery |
| Maintenance cycle 2 | 119 | 47s | Fill secondary gaps discovered in cycle 1 |
| **Total** | **567** | **210s** | |

328 of the 352 maintenance-1 RPC calls are for NEAR gap filling alone. Each gap requires ~10 RPC calls for binary search (log₂ of block range ≈ 10).

## Differences: Test vs Production

The test output differs from the production API in a few ways:

1. **Block heights**: The test uses `trigger_block_height` from Goldsky (e.g. 187009491 for USDC outgoing), while production resolves to the receipt execution block (187009494). This is because the test enrichment uses the trigger block directly.

2. **Missing records**: Production shows 32 API-visible records vs 31 in the test. The production system captures `act_proposal` calls at blocks 187016666 and 187027646 (USDC and wNEAR proposal executions) that create additional NEAR balance changes not found by the test's maintenance cycles.

3. **Counterparty resolution**: Some records show "UNKNOWN" in the test but have resolved counterparties in production (e.g. `theori.near`). This depends on how many maintenance cycles have run and whether FastNear can resolve the transaction.

## Pipeline Update: `executor_id` Filter

### The problem

The original Goldsky pipeline filtered execution outcomes with:

```sql
WHERE array_to_string(logs, ' ') LIKE '%sputnik-dao.near%'
   OR receiver_id LIKE '%.sputnik-dao.near'
```

This captured the sponsor call pairs (both outcomes have `receiver_id = trezu-demo.sputnik-dao.near`) and any FT transfer logs mentioning the DAO. But it missed the **actual `add_proposal` and `act_proposal` execution outcomes**.

These outcomes exist as separate receipts (e.g. receipt `4CNsepeAS2q6GZdco2fi8awPUCJRetv6Eb9EJw7f4EVf` at block 187136312) with:
- `executor_id = trezu-demo.sputnik-dao.near` (the DAO executes the function)
- `receiver_id = trezu-demo.sputnik-dao.near` (receipt is sent to the DAO)
- `predecessor_id = theori.near` (the actual user who initiated)
- `signer_id = sponsor.trezu.near` (sponsor signed the transaction)
- `method_name = add_proposal`
- `status = SuccessValue("MTE=")` (base64 proposal ID, e.g. "11")
- `logs = []` (empty — no FT events)

Despite having `receiver_id = trezu-demo.sputnik-dao.near`, these were not present in the Goldsky data. The `near.execution_outcomes` dataset's `receiver_id` field comes from the **transaction** level, not the receipt level — and for cross-contract receipts spawned during execution, the mapping may differ.

### The fix

Added `executor_id` to the pipeline filter (`goldsky/pipelines/near-execution-outcomes.yaml`):

```sql
WHERE array_to_string(logs, ' ') LIKE '%sputnik-dao.near%'
   OR receiver_id LIKE '%.sputnik-dao.near'
   OR executor_id LIKE '%.sputnik-dao.near'
```

### What this captures

For `jasnah-treasury.sputnik-dao.near` (verified on live pipeline data at block ~188048000):

| Block | executor_id | receiver_id | status | Type |
|-------|-------------|-------------|--------|------|
| 188047939 | jasnah-treasury.sputnik-dao.near | jasnah-treasury.sputnik-dao.near | `SuccessValue("MTM2")` | add_proposal (ID 136) |
| 188047961 | jasnah-treasury.sputnik-dao.near | jasnah-treasury.sputnik-dao.near | `SuccessValue("MTM3")` | add_proposal (ID 137) |
| 188048001 | jasnah-treasury.sputnik-dao.near | jasnah-treasury.sputnik-dao.near | `SuccessValue("")` | act_proposal |

These are the exact cross-contract receipt outcomes that were previously only discoverable via gap filling.

### Expected impact on RPC costs

With `executor_id` outcomes in Goldsky, enrichment creates balance change records **at the correct block** for `add_proposal`/`act_proposal`. The gap filler no longer needs to binary-search for these:

| Metric | Before (gap filling) | After (executor_id filter) |
|--------|---------------------|---------------------------|
| Discovery method | Binary search via archival RPC | Direct from Goldsky |
| RPC calls per sponsor call | ~10 (log₂ of block range) | 2 (balance before/after) |
| For 20 sponsor calls | ~200 RPC calls | 40 RPC calls |
| Maintenance time saved | ~80% of NEAR gap-filling time | — |

The gap filler is still needed for storage deposit refunds (small positive NEAR amounts at N+1 blocks) and any other implicit balance changes, but the largest gaps (the `add_proposal`/`act_proposal` calls) are now resolved by enrichment directly.

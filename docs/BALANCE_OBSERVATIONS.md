# Balance observations: staking pools and lockup contracts

Holdings that move without any transaction on the DAO account — staking
rewards and lockup contracts — cannot be indexed from transfer events. The
observation workers in `nt-be/src/handlers/public_history/observations/`
read chain state at chart boundaries instead and replay the readings as
hidden `observation` ledger entries on synthetic assets, so they flow into
the unified table and the balance chart like any other series.

| Worker | Synthetic asset | Value | Reads per boundary |
|---|---|---|---|
| `staking.rs` | `staking:{pool}` | the DAO's staked + unstaked balance in the pool | 1 |
| `lockup.rs` | `lockup:{lockup_account}` | gross lockup account balance + the lockup's staked + unstaked pool position (= the dashboard card's lockup total; storage not subtracted) | 3 |

Both are priced as NEAR. `mod.rs` holds everything they share.

## Shared machinery (`mod.rs`)

- **Boundary grid**: 90 daily + 53 weekly (Monday) boundaries, UTC midnight.
- **Required boundaries** (`required_boundaries`): every boundary from the
  last one at or before the account's ledger coverage start, never below a
  capped account's cap (the chart discards pre-cap points). The set is never
  empty for an account with ledger rows, so a fresh DAO cannot complete with
  zero readings. Coverage comes from `account_coverage`.
- **Boundary blocks** (`resolve_boundary_block`, table
  `observation_boundary_blocks`): one chain-validated block per boundary,
  shared by every account and worker. Estimate from bronze events, then
  probe the chain, walk over skipped heights, bisect once bracketed, and
  accept only within 60 s of the boundary or when bracketed by the next
  block. Unresolved boundaries are never cached. The exact number of RPC
  calls is returned and charged to the cycle budget.
- **Series rebuild** (`rebuild_observation_series`): delete-then-insert of
  the asset's observation rows from the full reading set (backfill discovers
  old boundaries after new ones), then `sync_hidden_ledger_rows`. Takes a
  per-account `pg_advisory_xact_lock` so the two workers cannot deadlock on
  the same account's hidden gold rows.
- **Budget and fairness**: 200 reads per cycle. Each cycle runs a *fresh*
  pass (last 2 days, every account, uncapped) before a *backfill* pass
  (oldest required first, 60 reads per account). Accounts are served longest-
  unobserved first. Discovery/validation probes are capped at 50 per cycle
  and charged to the same budget.
- **Per-boundary backoff**: failed reads and unresolved blocks go into the
  cursor's `failed_boundaries` JSONB with exponential backoff (5 min → 24 h).
- **Only observable accounts** (`observable_accounts`): enabled, not paused,
  not confidential, all three bronze sources backfilled. Disabled accounts
  stop costing RPC.

## Discovery, readiness, freshness

Both workers keep explicit discovery state so chart readiness fails closed:

- Staking: `staking_discovery_cursors` records that pool discovery (a pure
  bronze query) has run for the account. Candidate pools are validated once
  against the chain; non-pools get `rejected_at` and are never probed again.
  `staking_ready` = discovery row exists AND no non-rejected pool is
  unvalidated or unbackfilled.
- Lockup: `lockup_observation_cursors.discovery` is `pending` / `absent` /
  `present`. Discovery is a `view_account` probe of the derived lockup id
  (never `fetch_lockup_contract`, which returns `None` on decode failures
  too). `absent` is re-probed daily. `lockup_ready` = row exists AND
  discovery settled AND (absent OR backfilled).
- `backfill_done` is sticky. Freshness is separate: the chart turns
  **Stale** when a completed staking or lockup series' `last_observed_at`
  is more than 48 h old (`charts/chart.rs`).

After a deploy, every public chart is Unavailable until the first staking and
lockup cycles have run discovery for each account (up to one interval each,
default 15 min). Lockup DAOs then stay Unavailable until their horizon is
covered: about 430 archival reads per lockup, i.e. a few cycles.

## Operating notes

- Config: `STAKING_OBSERVATION_INTERVAL_SECONDS`,
  `LOCKUP_OBSERVATION_INTERVAL_SECONDS` (default 900).
- Each cycle logs a stats line (discovery counts, observations written,
  boundaries skipped, reads failed, backlog, max observation lag hours).
- Bronze backfill is capped at 50 NearBlocks pages per account and source
  per day, so a DAO with thousands of receipts needs several days of bronze
  backfill before either worker can discover for it.
- The `Now` point on the frontend chart includes lockup rows and sums only
  tokens that have a priced history series; a token with no series (e.g.
  ETH on the `aurora` contract, which NearBlocks' FT feed does not report)
  is listed in the chart's "Excluded tokens" tooltip.
- Frontend: `lockupAccountId` on the NEAR lockup asset row maps Lockup
  residency to its `lockup:{id}` series (`lib/balance-history-token-ids.ts`).

## Known follow-ups (not in this module)

- apalis cron workers can exit with `GracefulExit` outside a real shutdown
  and the supervisor in `jobs/mod.rs` does not restart them; a stalled gold
  projection queue is the symptom, a process restart the fix.
- Tokens whose transfers NearBlocks does not index (ETH on `aurora`) need
  their own observation source to appear in history.

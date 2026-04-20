# Confidential Treasury Balance Change Collection

## Context

Confidential treasuries hold balances off-chain in the 1Click system. The public balance-change pipeline (Goldsky → RPC `balance_before`/`balance_after` diff) can't observe confidential balances, because the token movements happen on an MPC-managed shielded address, not on the DAO's own intents account.

The revised design splits sources by direction:

- **Outgoing legs** (decreases): detected from Goldsky — when `v1.signer` emits its `sign: predecessor=AccountId("<DAO>"), request=…payload_v2: Some(Eddsa(Bytes("<hash>")))` log. The hash uniquely identifies the confidential intent, which we look up in `confidential_intents.quote_metadata` to synthesize the outgoing `balance_change` row.
- **Incoming legs** (increases): detected by polling `/v0/account/balances` from 1Click every 5 minutes. Decreases from polling are ignored (Goldsky owns them). Increases that match a stored quote are linked to the Goldsky-written outgoing row via the existing `detected_swaps` table — same mechanism used for public swaps.

No new `action_kind` values are introduced; confidential rows use `TRANSFER`, and the swap linkage is carried entirely through `detected_swaps` + `balance_changes.raw_data.payload_hash`.

---

## Architecture

### Source 1: Goldsky enrichment (outgoing leg)

`v1.signer` emits exactly one log line per real `sign` call it executes, and the Goldsky pipeline captures that outcome because the log mentions a sputnik-dao account:

```
sign: predecessor=AccountId("confidential-yuriik.sputnik-dao.near"),
request=SignRequestArgs { path: "…",
payload_v2: Some(Eddsa(Bytes("2591e244…574adb4"))), … }
```

The enrichment worker:
1. Sees an outcome with `executor_id = 'v1.signer'`.
2. Parses the `sign: …` log line with a single regex to extract `(dao_id, payload_hash)`.
3. Skips if the DAO is not a monitored confidential account.
4. Looks up `confidential_intents` by `(dao_id, payload_hash)` for the stored quote.
5. Synthesizes a `balance_change` from `quote_metadata.quote.amountIn` + `quoteRequest.originAsset`, with `counterparty = quote.depositAddress`.
6. Short-circuits — skips the normal event loop for this outcome (there's no RPC balance to query).

### Source 2: 1Click polling (incoming leg + deposits)

A dedicated worker runs every `CONFIDENTIAL_POLL_INTERVAL_SECONDS` (default 300s). For each enabled confidential account:

1. Call 1Click `/v0/account/balances` with a fresh JWT (reuses `refresh_dao_jwt`).
2. Decimal-adjust each balance via `ensure_ft_metadata` + `convert_raw_to_decimal`.
3. For each token, compare against the most recent `balance_after` in `balance_changes`:
   - `current > last` → insert an incoming row (continue to swap-match below).
   - `current < last` → **skip** (Goldsky owns decreases; logged at `debug`).
   - `current == last` → no-op.
4. **Swap match**: per poll cycle, load `confidential_intents WHERE status='submitted' AND intent_type='shield' AND updated_at >= NOW() - INTERVAL '24 hours'` for this DAO. For each observed increase, match against a pending intent whose:
   - `quoteRequest.destinationAsset` equals the raw token id (strip `intents.near:` prefix).
   - `quoteRequest.recipient` equals the DAO.
   - Decimal-adjusted `quote.amountOut` is within **1%** of the delta (`minAmountOut` already floors slippage).
   On match → set `counterparty = quote.depositAddress`, store `{payload_hash, correlation_id, source: "1click-poll"}` in `raw_data`, and insert a `detected_swaps` row linking this fulfillment to the Goldsky-written deposit leg (looked up by `raw_data->>'payload_hash'`). `solver_transaction_hash` is synthesized from `correlation_id` to satisfy the UNIQUE constraint.

### Why this fixes the earlier duplicate-row problem

The prior POC polled every 60s from the maintenance loop and wrote a row on *any* balance diff (including decreases) using the live chain head as `block_height`. That caused:
- Same logical swap recorded twice (one outgoing row when balance dropped, one incoming row when it rose — no linkage between them).
- Transient settlement races produced additional rows for the same event.
- No way to distinguish swap fulfillment from a plain deposit.

The new split keeps each physical event's row in exactly one place (Goldsky for outgoing, polling for incoming), and the `detected_swaps` row pairs them.

---

## Module Layout

### New

- [nt-be/src/handlers/intents/confidential/balances.rs](nt-be/src/handlers/intents/confidential/balances.rs) — shared 1Click balance fetcher (`fetch_confidential_balances(state, dao_id) -> Result<Vec<(String, String)>, (StatusCode, String)>`). Used by both the assets endpoint and the polling worker; replaces two prior duplicates.
- [nt-be/src/handlers/balance_changes/confidential_enrichment.rs](nt-be/src/handlers/balance_changes/confidential_enrichment.rs) — log regex parser (`extract_sign_call_from_logs`) + `handle_confidential_outgoing` that writes the synthesized `balance_change`.

### Modified

| File | Change |
|---|---|
| [nt-be/src/handlers/balance_changes/goldsky_enrichment.rs](nt-be/src/handlers/balance_changes/goldsky_enrichment.rs) | `get_monitored_accounts` returns `HashMap<String, bool>` (account → is_confidential). New v1.signer short-circuit runs before `parse_outcome_events`. Non-confidential accounts excluded from the v1.signer path; confidential accounts excluded from `swap_candidate_accounts`. `upsert_balance_change` now takes a `raw_data: &Value` parameter (passes `{}` on the regular path). |
| [nt-be/src/handlers/balance_changes/confidential_monitor.rs](nt-be/src/handlers/balance_changes/confidential_monitor.rs) | Rewrote `poll_confidential_balances`: increases only, per-poll load of pending intents, swap match + `detected_swaps` write. Added `run_confidential_poll_cycle` (looped by the new worker). Dropped the old step-4 "zero-out disappeared token" block. |
| [nt-be/src/handlers/balance_changes/account_monitor.rs](nt-be/src/handlers/balance_changes/account_monitor.rs) | `run_maintenance_cycle` now filters `WHERE enabled = true AND NOT is_confidential_account`. Confidential branch and `use super::confidential_monitor::poll_confidential_balances` import removed. |
| [nt-be/src/handlers/user/assets.rs](nt-be/src/handlers/user/assets.rs) | Local `fetch_confidential_balances` + its response structs deleted; calls the shared fetcher in `handlers/intents/confidential/balances`. |
| [nt-be/src/handlers/intents/confidential/mod.rs](nt-be/src/handlers/intents/confidential/mod.rs) | `pub mod balances;`. |
| [nt-be/src/handlers/balance_changes/mod.rs](nt-be/src/handlers/balance_changes/mod.rs) | `pub mod confidential_enrichment;`. |
| [nt-be/src/main.rs](nt-be/src/main.rs) | New `tokio::spawn` for the confidential poll worker (`CONFIDENTIAL_POLL_INTERVAL_SECONDS`, default 300s; `CONFIDENTIAL_POLL_INITIAL_DELAY_SECONDS`, default 45s). Gated on `!state.env_vars.disable_balance_monitoring`. |
| [nt-be/Cargo.toml](nt-be/Cargo.toml) | `regex = "1.11"` promoted from `[dev-dependencies]` to main dependencies. |

No SQL migrations required. Confidential rows reuse `balance_changes` and `detected_swaps` unchanged.

---

## Key reused utilities

| Function | Location | Purpose |
|---|---|---|
| `fetch_confidential_balances` | [intents/confidential/balances.rs](nt-be/src/handlers/intents/confidential/balances.rs) | Shared 1Click `/v0/account/balances` fetcher |
| `refresh_dao_jwt` | [intents/confidential/mod.rs:39](nt-be/src/handlers/intents/confidential/mod.rs#L39) | Refresh the DAO's 1Click JWT before fetch |
| `convert_raw_to_decimal`, `ensure_ft_metadata` | [balance_changes/counterparty.rs](nt-be/src/handlers/balance_changes/counterparty.rs) | Raw → decimal-adjusted `BigDecimal` using cached token metadata |
| `store_detected_swaps` (pattern) | [balance_changes/swap_detector.rs:370](nt-be/src/handlers/balance_changes/swap_detector.rs#L370) | Polling path uses the same `(account_id, solver_transaction_hash)` UNIQUE semantics for dedup |

---

## Data Flow

```
Confidential Swap:
  Frontend  → generate-intent → store confidential_intents (quote_metadata)
  DAO vote  → act_proposal    → DAO spawns FunctionCall to v1.signer.sign
  v1.signer → emits "sign: predecessor=…payload_v2: Some(Eddsa(Bytes(<hash>)))" log
  Goldsky sink captures the v1.signer outcome (log mentions sputnik-dao.near)
  Enrichment worker → regex-extract (dao, payload_hash)
                    → SELECT confidential_intents WHERE (dao, payload_hash)
                    → write balance_change from quote.amountIn + originAsset
                      (counterparty = quote.depositAddress)

  Solver fulfills off-chain
  5-min poll → fetch 1Click balances → detect increase on destinationAsset
             → match against stored quote (1% tolerance)
             → write incoming balance_change + detected_swaps row linking
               the deposit_balance_change_id (Goldsky row) ↔
               fulfillment_balance_change_id (this row)

Direct Deposit (no intent):
  External sender → 1Click deposit address → solver mints to the DAO
  5-min poll → detects increase, no matching confidential_intents row
             → writes incoming balance_change with counterparty = NULL
               and raw_data = { "source": "1click-poll" }
```

---

## Verification

1. `cd nt-be && cargo build` — compiles.
2. `cargo test --lib confidential_enrichment` — unit tests for `extract_sign_call_from_logs` (positive + negative cases).
3. `cargo sqlx prepare --check` — offline query artifacts up to date.
4. Manual / sandbox:
   - Submit a confidential shield intent → approve proposal. Within ~1 Goldsky enrichment cycle (~15s), exactly one `TRANSFER` row (negative amount) with `raw_data->>'payload_hash' = <hash>` appears.
   - Wait for solver settlement (≤30s). At the next 5-minute poll tick, a matching incoming `TRANSFER` row is written AND a `detected_swaps` row is inserted linking both balance_change ids.
   - Send a direct deposit to the quote's `depositAddress` that isn't tied to any stored intent. At the next poll tick, an incoming `TRANSFER` row is written with `counterparty = NULL` and no `detected_swaps` row.
5. Regression: non-confidential DAOs still produce the usual `TRANSFER`/`MINT`/`BURN` rows from the regular Goldsky path; the v1.signer short-circuit never fires for them because `monitored.get(dao_id)` returns `Some(false)`.

---

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `CONFIDENTIAL_POLL_INTERVAL_SECONDS` | `300` | Cadence of the confidential poll worker. |
| `CONFIDENTIAL_POLL_INITIAL_DELAY_SECONDS` | `45` | Sleep before the first poll tick so the rest of the stack is up. |
| `DISABLE_BALANCE_MONITORING` | `false` | Gates both the maintenance loop and the confidential poll worker. |

# Confidential Treasury Balance Change Collection

## Context

Confidential treasuries hold balances off-chain in the 1Click system. The existing balance change pipeline (Goldsky enrichment + maintenance cycle) is designed for on-chain data and doesn't work for confidential accounts. We need two mechanisms:

1. **Swap activity** (outgoing leg): Detected reactively from Goldsky `act_proposal` events, enriched with `confidential_intents.quote_metadata`
2. **Deposits + incoming fulfillments**: Detected proactively by polling the 1Click `/v0/account/balances` API and diffing against stored values

## Architecture

### Source 1: Goldsky Enrichment (swap outgoing leg)

When `goldsky_enrichment.rs` processes an outcome for a confidential DAO:

1. Check if the DAO is confidential (`is_confidential_account` in `monitored_accounts`)
2. If the outcome's `method_name` is `act_proposal` and receiver is `v1.signer`:
   - Extract `payload_hash` via `extract_payload_hash_from_kind()` from `nt-be/src/handlers/proposals/scraper.rs`
   - Look up `confidential_intents` by `(dao_id, payload_hash)`
   - Extract swap details from `quote_metadata`: `amountIn`, `amountOut`, source/dest token IDs
   - Create a balance change record for the outgoing leg (token sent for swap)
   - The amounts need decimal-adjustment via `convert_raw_to_decimal()` + `ensure_ft_metadata()`

**Key insight**: We can't get `balance_before`/`balance_after` from RPC for confidential accounts. Instead, we derive amounts from the quote metadata and use the last known `balance_after` as `balance_before`.

### Source 2: Balance Polling (deposits + fulfillments)

The existing `confidential_monitor.rs` handles this — runs during the maintenance cycle for confidential accounts:

1. Call 1Click `/v0/account/balances` with refreshed JWT
2. Decimal-adjust raw balances via `ensure_ft_metadata()` + `convert_raw_to_decimal()`
3. Diff against last stored `balance_after` per token
4. Insert balance change records for any differences
5. Detect disappeared tokens (balance went to zero)

This catches solver fulfillments (incoming tokens), direct deposits, and any other changes.

## Files to Modify

### Goldsky enrichment changes
- **`nt-be/src/handlers/balance_changes/goldsky_enrichment.rs`**
  - In `run_enrichment_cycle()`: after parsing events, check if account is confidential
  - For confidential accounts: skip RPC balance queries, instead look up `confidential_intents` for swap data
  - Need to query `monitored_accounts.is_confidential_account` (batch for all accounts in cycle)
  - Use `extract_payload_hash_from_kind()` to link outcomes to intents

### Confidential monitor (already created, needs refinement)
- **`nt-be/src/handlers/balance_changes/confidential_monitor.rs`**
  - Already implements polling + diff logic
  - User simplified the signature (removed `pool`/`network` params, uses `&state` directly)
  - Decimal-adjusts via `adjust_balance()` → `ensure_ft_metadata()` + `convert_raw_to_decimal()`

### Account monitor integration
- **`nt-be/src/handlers/balance_changes/account_monitor.rs`**
  - Branch on `is_confidential_account` in the maintenance loop
  - Confidential accounts: call `poll_confidential_balances()` then skip all on-chain steps
  - Regular accounts: existing pipeline unchanged
  - Query now fetches `(account_id, dirty_at, is_confidential_account)` tuple

### Main entry point
- **`nt-be/src/main.rs`**
  - Pass `Some(&state_clone)` as `app_state` to `run_maintenance_cycle()`

### Module registration
- **`nt-be/src/handlers/balance_changes/mod.rs`**
  - Add `pub mod confidential_monitor;`

### Test files (add `None` for new `app_state` param)
- `nt-be/tests/intents_spurious_tx_hash_test.rs`
- `nt-be/tests/balance_collection_integration_test.rs`
- `nt-be/tests/goldsky_e2e_test.rs`
- `nt-be/tests/near_deposit_counterparty_test.rs`
- `nt-be/tests/intents_tokens_metadata_test.rs`
- `nt-be/tests/creation_account_test.rs`
- `nt-be/tests/transfer_hints_integration_test.rs`

## Key Functions to Reuse

| Function | Location | Purpose |
|---|---|---|
| `extract_payload_hash_from_kind()` | `nt-be/src/handlers/proposals/scraper.rs:98` | Extract payload hash from v1.signer proposal kind |
| `convert_raw_to_decimal()` | `nt-be/src/handlers/balance_changes/counterparty.rs:247` | Raw amount → decimal-adjusted BigDecimal |
| `ensure_ft_metadata()` | `nt-be/src/handlers/balance_changes/counterparty.rs:107` | Get/cache token decimals |
| `refresh_dao_jwt()` | `nt-be/src/handlers/intents/confidential/mod.rs:39` | Refresh 1Click JWT for API calls |
| `to_storage_token_id()` | `confidential_monitor.rs` | `nep141:wrap.near` → `intents.near:nep141:wrap.near` |

## Data Flow

```
Confidential Swap:
  Frontend → generate-intent → store confidential_intents (quote_metadata)
  DAO vote → act_proposal → Goldsky picks up outcome
  Goldsky enrichment → detect confidential → extract payload_hash
    → look up confidential_intents → create balance_change from quote_metadata
  
  Solver fulfills → balance changes in 1Click system
  Maintenance cycle → poll_confidential_balances() → diff → create balance_change

Direct Deposit:
  External sends tokens → balance changes in 1Click system  
  Maintenance cycle → poll_confidential_balances() → diff → create balance_change
```

## Implementation Order

1. Fix test files (add `None` app_state param) — unblock compilation
2. Wire up `confidential_monitor.rs` in the maintenance cycle (already mostly done)
3. Verify compilation + existing tests pass
4. Add confidential detection to `goldsky_enrichment.rs` for swap outgoing legs
5. Test end-to-end with a confidential treasury

## Verification

1. `cargo build` — compilation passes
2. `cargo test` — existing tests pass with new `app_state: None` param
3. Manual: create a confidential treasury, initiate a swap, verify balance change records appear
4. Manual: send tokens to a confidential treasury, verify polling detects the deposit

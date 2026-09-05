# Treasury26 Backend - Treasury History APIs

## Overview

Treasury activity, charts, and balances are served from the unified gold
ledger (`gold_treasury_ledger_events`), one table covering both public
(sputnik DAO) and confidential (intents) treasuries. Rows are projected from
the medallion pipeline (bronze chain events → silver transfer legs/balance
history → gold) and verified against on-chain / 1Click balances at projection
time.

- **NEAR** - Native NEAR token
- **FT Tokens** - NEP-141 fungible tokens
- **Intents Tokens** - Multi-token balances on intents.near (NEP-141 and NEP-245)
- **Staking** - Staked balances observed per pool and shown as chart series

## Quick Start

### 1. Register an Account for Monitoring

**Production** (https://near-treasury-backend.onrender.com):
```bash
curl -X POST https://near-treasury-backend.onrender.com/api/monitored-accounts \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": "your-treasury.sputnik-dao.near",
    "enabled": true
  }'
```

**Local development**:
```bash
curl -X POST http://localhost:3000/api/monitored-accounts \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": "webassemblymusic-treasury.sputnik-dao.near",
    "enabled": true
  }'
```

### 2. Query Treasury Activity

```bash
# All activity for an account (newest first)
curl "http://localhost:3000/api/balance-changes?accountId=webassemblymusic-treasury.sputnik-dao.near"

# Filter by token
curl "http://localhost:3000/api/balance-changes?accountId=webassemblymusic-treasury.sputnik-dao.near&tokenIds=near"

# Paginate
curl "http://localhost:3000/api/balance-changes?accountId=webassemblymusic-treasury.sputnik-dao.near&limit=50&offset=50"
```

## API Reference

### Get Balance Changes

**GET** `/api/balance-changes`

Query parameters (camelCase):
- `accountId` (required) - Account to query
- `tokenIds` / `excludeTokenIds` (optional) - Comma-separated token filters
- `transactionTypes` (optional) - `incoming`, `outgoing`, `exchange`
- `startTime` / `endTime` (optional) - ISO 8601 range
- `minAmount` / `maxAmount` (optional) - Decimal-adjusted, single-token filter only
- `txHash` (optional) - Partial transaction-hash match
- `fromAccounts` / `toAccounts` (+ `...Not` variants) (optional) - Counterparty filters
- `limit` / `offset` (optional) - Pagination (default limit 100, max 1000)
- `includeMetadata` / `includePrices` / `includeChainMetadata` (optional) - Enrichment flags

Exchanges are returned as a single fulfillment row carrying the full swap
(sent + received legs) in the `swap` object.

### Recent Activity (UI feed)

**GET** `/api/recent-activity` - Paginated feed with plan-limit windowing,
token metadata, and USD values.
**GET** `/api/recent-activity/senders` / `/api/recent-activity/recipients` -
Distinct counterparty options for the feed's filter dropdowns.

### Charts and Exports

**GET** `/api/balance-history/chart` - Balance snapshots at
hourly/daily/weekly/monthly intervals, with USD series and freshness metadata
(`chartMeta.status`: `ok` / `stale` / `unavailable`).
**GET** `/api/balance-history/export?format=csv|json|xlsx` - Accounting
export; consumes an export credit and honors plan history limits.

## Development

### Run Tests

```bash
# All tests (needs a local Postgres with migrations applied)
cargo test

# One suite
cargo test --test balance_history_apis_test
```

### Database Setup

See [DATABASE.md](./DATABASE.md) for PostgreSQL setup instructions.

## Token Format

### FT Tokens
Simple contract address: `wrap.near`, `token.v2.ref-finance.near`

### Intents Tokens
Full path format: `intents.near:nep141:btc.omft.near`
- Preserves the underlying FT contract for metadata queries
- Format: `intents.near:{standard}:{ft_contract}`

### Staking
Staked balances appear in charts as `staking:{pool_contract}` series derived
from staking observations; the activity feed shows only user-visible
transfers.

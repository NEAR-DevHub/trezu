# trezu - NEAR Treasury CLI

A CLI tool for NEAR Treasury (Sputnik DAO) operations using near-cli-rs.

## Prerequisites

- [near-cli-rs](https://github.com/near/near-cli-rs) installed
- Node.js 18.17+ or 20.5+
- A NEAR account with sufficient balance

## Installation

```bash
cd cli
npm install
```

## Usage

```bash
# Interactive mode - prompts for command
npm run dev

# Direct command
npm run dev -- create-treasury
npm run dev -- create-proposal

# With options
npm run dev -- create-treasury --dry-run
npm run dev -- create-proposal --dry-run
```

Or install globally:
```bash
npm link
trezu                    # Interactive mode
trezu create-treasury    # Direct command
trezu --help
```

## Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Print command without executing |
| `--non-interactive` | Run without prompts (requires all args) |
| `--help, -h` | Show help message |

## Non-Interactive Mode

For CI/CD or scripting, use `--non-interactive` with all required arguments:

### create-treasury

```bash
trezu create-treasury --non-interactive \
  --network mainnet \
  --signer alice.near \
  --name "My Treasury" \
  --account-id my-treasury.sputnik-dao.near \
  --payment-threshold 1 \
  --governance-threshold 2 \
  --governors alice.near,bob.near \
  --financiers alice.near \
  --requestors alice.near,charlie.near
```

**Required arguments:**
- `--network` - testnet or mainnet
- `--signer` - Your NEAR account ID
- `--name` - Treasury display name
- `--account-id` - Treasury account ID

**Optional arguments:**
- `--payment-threshold` - Votes for payments (default: 1)
- `--governance-threshold` - Votes for governance (default: 2)
- `--governors` - Comma-separated governor accounts (default: signer)
- `--financiers` - Comma-separated financier accounts (default: signer)
- `--requestors` - Comma-separated requestor accounts (default: signer)

### create-proposal

```bash
trezu create-proposal --non-interactive \
  --network mainnet \
  --treasury-id my-treasury.sputnik-dao.near \
  --title "Transfer tokens" \
  --notes "Monthly transfer" \
  --receiver-id token.near \
  --method ft_transfer \
  --args '{"receiver_id":"bob.near","amount":"1000000"}' \
  --deposit 0.00001 \
  --gas 150
```

**Required arguments:**
- `--network` - testnet or mainnet
- `--treasury-id` - Treasury account ID
- `--title` - Proposal title
- `--receiver-id` - Contract to call
- `--method` - Method name

**Optional arguments:**
- `--notes` - Proposal notes
- `--args` - JSON arguments (default: {})
- `--deposit` - Attached deposit in NEAR (default: 0)
- `--gas` - Gas in Tgas (default: 150)

Or install globally:
```bash
npm link
trezu                    # Interactive mode
trezu create-treasury    # Direct command
trezu --help
```

## Commands

### `create-treasury`

Create a new Sputnik DAO treasury.

```bash
trezu create-treasury
trezu create-treasury --dry-run
```

**Prompts:**
1. Network (testnet/mainnet)
2. Your NEAR account ID (pre-filled as all roles)
3. Treasury display name
4. Treasury account ID (auto-generated, editable)
5. Payment threshold (votes to approve transfers)
6. Governance threshold (votes for config changes)
7. Governors (Admin role)
8. Financiers (Approver role)
9. Requestors (can create proposals)

**Output:**
- Treasury account: `<name>.sputnik-dao.near`
- Link to view at trezu.app

### `create-proposal`

Create a proposal in a treasury.

```bash
trezu create-proposal
trezu create-proposal --dry-run
```

**Prompts:**
1. Network (testnet/mainnet)
2. Treasury ID (e.g., `my-treasury.sputnik-dao.near`)
3. Proposal title
4. Notes (optional)
5. Receiver ID (contract to call)
6. Method name
7. Arguments (JSON)
8. Deposit (NEAR)
9. Gas (Tgas)
10. Add another action? (optional)

**Output:**
- Proposal created confirmation
- Link to view at trezu.app

## Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Print command without executing |
| `--help` | Show help message |

## Examples

### Create a Treasury

```bash
$ trezu create-treasury

🏛️  Create Treasury

? Select network: mainnet
? Enter your NEAR account ID: alice.near
? Treasury display name: My Treasury
? Treasury account ID: my-treasury.sputnik-dao.near
? Payment threshold: 1
? Governance threshold: 2
? Governors: alice.near
? Financiers: alice.near,bob.near
? Requestors: alice.near

📋 Summary:
   Network:     mainnet
   Name:        My Treasury
   Account:     my-treasury.sputnik-dao.near
   ...

? Create treasury? Yes

✅ Treasury created: my-treasury.sputnik-dao.near
   View at: https://trezu.app/address/my-treasury.sputnik-dao.near
```

### Create a Function Call Proposal

```bash
$ trezu create-proposal

📝 Create Proposal: Function Call

? Select network: mainnet
? Treasury account ID: my-treasury.sputnik-dao.near
? Proposal title: Transfer tokens
? Notes (optional): Monthly transfer
? Receiver ID (contract to call): token.near
? Method name: ft_transfer
? Arguments (JSON): {"receiver_id":"bob.near","amount":"1000000"}
? Deposit (NEAR): 0.00001
? Gas (Tgas): 150
? Add another action? No

📋 Summary:
   Network:     mainnet
   Treasury:    my-treasury.sputnik-dao.near
   Title:       Transfer tokens
   Receiver:    token.near
   Actions:     1

   Action 1:
     Method:     ft_transfer
     Deposit:    0.00001 NEAR
     Gas:        150 Tgas

? Create proposal? Yes

✅ Proposal created
   View at: https://trezu.app/address/my-treasury.sputnik-dao.near
```

## Transaction Details

### create-treasury
- **Contract**: `sputnik-dao.near`
- **Method**: `create`
- **Deposit**: 0.09 NEAR
- **Gas**: 300 Tgas
- **Proposal bond**: 0 NEAR (free proposals)

### create-proposal
- **Contract**: `<treasury-id>`
- **Method**: `add_proposal`
- **Deposit**: 0 NEAR
- **Gas**: 300 Tgas

## Architecture

```
cli/
├── src/
│   ├── index.ts              # Command router
│   ├── commands/
│   │   ├── create-treasury.ts
│   │   └── create-proposal.ts
│   └── lib/
│       ├── near-cli.ts       # near-cli-rs wrapper
│       └── prompts.ts        # Shared prompt utilities
├── package.json
└── README.md
```

## Future Commands

| Command | Description |
|---------|-------------|
| `create-proposal transfer` | Send NEAR/FT tokens |
| `create-proposal add-member` | Add member to role |
| `vote-proposal` | Approve/reject/finalize proposals |
| `list-proposals` | View proposals with filters |
| `get-treasury` | View treasury info |

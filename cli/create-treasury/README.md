# NEAR Treasury Creator CLI

A CLI tool to create a NEAR Treasury (Sputnik DAO) using near-cli-rs.

## Prerequisites

- [near-cli-rs](https://github.com/near/near-cli-rs) installed
- Node.js 18.17+ or 20.5+
- A NEAR account with sufficient balance (0.1+ NEAR)

## Installation

```bash
cd cli/create-treasury
npm install
```

## Usage

### Interactive Mode

```bash
npm run dev
```

The CLI will prompt for:
1. **Network** - testnet or mainnet
2. **Signer account** - your NEAR account ID (pre-filled as all roles)
3. **Treasury name** - display name for the treasury
4. **Account ID** - auto-generated from name, editable (e.g., `my-treasury.sputnik-dao.near`)
5. **Payment threshold** - votes needed to approve transfers (default: 1)
6. **Governance threshold** - votes needed for config changes (default: 2)
7. **Governors** - accounts with full admin permissions (comma-separated)
8. **Financiers** - accounts that can approve/reject payments (comma-separated)
9. **Requestors** - accounts that can create proposals (comma-separated)

### Dry Run

Print the near-cli-rs command without executing:

```bash
npm run dev -- --dry-run
```

## Roles

| Role | Permissions |
|------|-------------|
| **Governor (Admin)** | Full governance: config, policy, members, upgrades |
| **Financier (Approver)** | Vote approve/reject/finalize on transfers and calls |
| **Requestor** | Create proposals, vote to remove proposals |

## Example

```bash
$ npm run dev

🏛️  NEAR Treasury Creator

? Select network: testnet
? Enter your NEAR account ID: alice.testnet
? Treasury display name: My Treasury
? Treasury account ID: my-treasury.sputnik-dao.near
? Payment threshold: 1
? Governance threshold: 2
? Governors: alice.testnet
? Financiers: alice.testnet,bob.testnet
? Requestors: alice.testnet,bob.testnet,charlie.testnet

📋 Summary:
   Network:     testnet
   Name:        My Treasury
   Account:     my-treasury.sputnik-dao.near
   Payment:     1 vote(s)
   Governance:  2 vote(s)
   ...

? Create treasury? Yes
```

## Transaction Details

- **Contract**: `sputnik-dao.near`
- **Method**: `create`
- **Args**: Base64-encoded JSON (nested: outer args + inner config/policy)
- **Deposit**: 0.09 NEAR
- **Gas**: 300 Tgas
- **Proposal bond**: 0 NEAR (free to create proposals)

## After Creation

### Immediate Access

Navigate directly to your treasury:
- **Testnet**: `https://<app-url>/app/<treasury-id>`
- **Mainnet**: `https://<app-url>/app/<treasury-id>`

The frontend fetches config directly from the contract, so you can use it immediately.

### Treasury List

Your treasury will appear in your treasuries list within ~30 minutes (when the backend sync service picks it up from the factory).

**To add it immediately**: Click "Save" on the treasury page to add it to your list.

### Sync Timeline

```
CLI creates DAO → Factory on-chain
     ↓
(~30 min) DAO list sync picks it up, marks dirty
     ↓
(~1 sec) Policy sync reads policy, extracts members
     ↓
You appear in dao_members with is_policy_member=true
     ↓
Treasury shows in your list automatically
```

## Output

After successful creation:
- Treasury account: `<name>.sputnik-dao.near`
- Link to view at trezu.app
- near-cli-rs handles signer selection and transaction signing

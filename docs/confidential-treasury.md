
# Confidential Treasury

## Concept

A confidential treasury is a sputnik-dao.near subaccount where all proposals target **private intents** — a NEAR sandbox running inside a TEE (Trusted Execution Environment) network. This TEE network is called **FAR** (NEAR chain is public, FAR chain is confidential).

A treasury is either public or confidential — we don't mix the two. For confidential transfers, you need a quote from the private intents API, and since DAOs have no access keys, signing is done via **MPC (multi-party computation)** using the `v1.signer` contract (chain-signatures).

## References

- Defuse frontend PR (individual account implementation): https://github.com/defuse-protocol/defuse-frontend/pull/962
- Cloned repo at `/tmp/defuse-frontend` (branch `feat/shield`)
- Chain Signatures (MPC signer): https://docs.near.org/chain-abstraction/chain-signatures#multichain-smart-contract

## Architecture: near.com vs DAO

| Aspect | near.com (individual) | Treasury26 (DAO) |
|--------|----------------------|-------------------|
| Account | `alice.near` | `mydao.sputnik-dao.near` |
| Signer ID | `near:alice.near` | `near:mydao.sputnik-dao.near` |
| Signing | Wallet signs off-chain (NEP-413) | DAO proposal → `v1.signer` contract (MPC chain-signatures) |
| Auth flow | Synchronous (sign → submit in one step) | Asynchronous (proposal → approval → execute → sign → submit) |
| Access keys | User's wallet key | None — must use MPC |
| Mode | Toggle between public/private | Treasury-level flag (one or the other) |

### Key Challenge: DAO Signing

The near.com flow assumes synchronous wallet signing via NEP-413 (`wallet.signMessage()`). DAOs don't have wallet keys. Two types of proposals are needed:

#### Proposal Type 1: JWT Authentication (infrequent)

Before the DAO can do any confidential operations, the backend needs a JWT token. This requires a NEP-413 signature from the DAO — which means a DAO proposal.

1. Backend constructs an auth payload (empty intents, `signer_id: "near:mydao.sputnik-dao.near"`)
2. DAO members create & approve a proposal that calls `v1.signer` to sign this auth payload
3. Backend receives the MPC signature, calls `UserAuthService.authenticate()` to get JWT
4. Backend stores the JWT (access + refresh tokens) for this DAO

The refresh token lasts ~7 days, so this only needs to happen once per week (or on first setup). The backend auto-refreshes the access token using the refresh token (refresh when < 60s remaining).

#### Proposal Type 2: Intent Signing (per operation)

Each confidential operation (shield, unshield, transfer, swap) needs its own signed intent:

**Shield (public → private):**
1. Backend gets quote from 1Click API (no JWT needed for shield quotes)
2. DAO members create & approve a proposal that:
   a. Calls `v1.signer` to sign the intent payload
   b. Transfers tokens to the deposit address (on-chain)
3. Backend submits the signed intent to 1Click API (no JWT needed for submit)

**Unshield / Private transfer / Confidential swap:**
1. Backend gets quote from 1Click API (**JWT required** — reading confidential state)
2. DAO members create & approve a proposal that calls `v1.signer` to sign the intent payload
3. Backend submits the signed intent to 1Click API (no JWT needed for submit)
4. No on-chain token transfer needed (funds already in confidential ledger)

### JWT Token Details

| Aspect | Detail |
|--------|--------|
| Access token TTL | Short-lived (from server `expiresIn`), auto-refresh when < 60s left |
| Refresh token TTL | ~7 days (from server `refreshExpiresIn`) |
| Storage | Backend stores per-DAO |
| Needs JWT | `getBalances`, `getUnshieldQuote`, `getPrivateTransferQuote` |
| No JWT needed | `getShieldQuote`, `generateIntent`, `submitIntent`, `getExecutionStatus` |

The JWT proves account ownership to read confidential state. `submitIntent` doesn't need it because the intent itself is cryptographically signed.

## Private Intents API

### Base URL & Auth

- **API Base URL:** `https://1click.chaindefuser.com` (env var `ONE_CLICK_URL`)
- **API Key:** Sent as `x-api-key` header (env var `ONE_CLICK_API_KEY`)
- **JWT Auth:** `Authorization: Bearer <jwt>` header for confidential operations (obtained via wallet-signed authentication)

Both headers are sent together — `x-api-key` for API identification, Bearer JWT for user authentication.

### Authentication Flow (near.com)

1. Build an `IntentPayload` with empty intents (auth-only):
   ```
   {
     deadline: "2026-03-18T12:05:00.000Z",
     intents: [],
     signer_id: "near:alice.near",
     verifying_contract: "intents.near",
     nonce: "<base64 timestamped random bytes>"
   }
   ```

2. Convert to NEP-413 message for wallet signing:
   ```
   message: JSON.stringify({ deadline, intents: [], signer_id })
   recipient: "intents.near"  (verifying_contract)
   nonce: <32 bytes from base64>
   ```

3. Wallet signs → returns `{ public_key, signature }`

4. Submit to `UserAuthService.authenticate()`:
   ```
   {
     signedData: {
       standard: "nep413",
       payload: { message, nonce, recipient },
       public_key: "ed25519:...",
       signature: "ed25519:..."
     }
   }
   ```

5. Response: `{ accessToken, refreshToken, expiresIn, refreshExpiresIn }`

6. Tokens stored in HTTP-only cookies, auto-refresh when within 60s of expiry

### Core Operations

There are two distinct flow patterns depending on whether an **on-chain deposit** is needed:

#### Flow A: Shield (public → private) — requires on-chain deposit
```
depositType: INTENTS
recipientType: CONFIDENTIAL_INTENTS
refundType: CONFIDENTIAL_INTENTS
```
1. Get quote → receive `depositAddress`
2. Generate intent → sign with wallet (NEP-413) → submit signed intent
3. **Submit on-chain deposit tx** (transfer tokens to `depositAddress`)
4. Poll execution status

**DAO flow:** The proposal must include BOTH the `v1.signer` call (to sign the intent) AND a token transfer to the deposit address. The backend submits the signed intent to 1Click API, then the on-chain transfer executes as part of the same proposal.

#### Flow B: Operations with confidential source — API-only, no on-chain tx

When `depositType: CONFIDENTIAL_INTENTS`, funds are already in the confidential ledger. The wallet signature (off-chain) authorizes the movement — **no NEAR transaction hits the chain**.

##### Unshield (private → public)
```
depositType: CONFIDENTIAL_INTENTS
recipientType: INTENTS
refundType: CONFIDENTIAL_INTENTS
```

##### Private Transfer (private → private, different recipient)
```
depositType: CONFIDENTIAL_INTENTS
recipientType: CONFIDENTIAL_INTENTS
refundType: CONFIDENTIAL_INTENTS
recipient: "near:recipient.near"
```

##### Confidential Swap (private, token A → token B)
```
depositType: CONFIDENTIAL_INTENTS
recipientType: CONFIDENTIAL_INTENTS
refundType: CONFIDENTIAL_INTENTS
```

**Steps (same for all three):**
1. Get quote (requires JWT auth)
2. Generate intent → sign → submit signed intent
3. Poll execution status

**DAO flow:** The proposal only needs to call `v1.signer` to produce the signature. The backend then submits the signed intent to the 1Click API. No on-chain token movement needed.

### Quote Request Shape
```typescript
{
  dry: boolean,
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT" | "ANY_INPUT",
  slippageTolerance: number,      // basis points
  originAsset: string,            // token ID
  destinationAsset: string,       // token ID
  amount: string,
  deadline: string,               // ISO timestamp
  depositType: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS",
  recipientType: "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS",
  refundType: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS",
  refundTo: string,               // intentsUserId
  recipient: string,              // intentsUserId
}
```

### Generate Intent Request
```typescript
{
  type: "swap_transfer",
  standard: "nep413",             // for NEAR
  depositAddress: string,         // from quote response
  signerId: string,               // intentsUserId
}
```

### Submit Intent Request (after signing)
```typescript
{
  type: "swap_transfer",
  signedData: {
    standard: "nep413",
    payload: {
      message: string,            // JSON intent body from generateIntent
      nonce: string,              // base64
      recipient: string,          // verifying contract
    },
    public_key: string,           // ed25519 public key
    signature: string,            // ed25519 signature
  }
}
```

### Get Balances
```typescript
AccountService.getBalances(tokenIds?)  // requires JWT auth
```

### Poll Execution Status
```typescript
OneClickService.getExecutionStatus(depositAddress)  // depositAddress from quote
```

## Intent Types (from SDK)

Relevant intent variants for DAO confidential operations:

```typescript
// Token swap diff
type IntentTokenDiff = {
  intent: "token_diff",
  diff: Record<string, string>,   // token_id -> amount delta
  memo?: string,
  referral?: string,
}

// Direct transfer
type IntentTransfer = {
  intent: "transfer",
  receiver_id: string,
  tokens: Record<string, string>,
  memo?: string,
}

// Potentially useful for DAO auth delegation
type IntentSetAuthByPredecessorId = {
  intent: "set_auth_by_predecessor_id",
  enabled: boolean,
}

// Contract-call-based auth (alternative to off-chain signing)
type IntentAuthCall = {
  intent: "auth_call",
  contract_id: string,
  msg: string,
  attached_deposit?: string,
  min_gas?: string,
}
```

The `IntentSetAuthByPredecessorId` and `IntentAuthCall` types are interesting for DAO use — they suggest a contract-call-based auth path that could work without off-chain wallet signatures.

## Key Source Files (defuse-frontend, branch feat/shield)

| File | Purpose |
|------|---------|
| `src/components/DefuseSDK/features/machines/privateIntents.ts` | Core server-side module (Server Actions): auth, cookies, shield/unshield/transfer, all API calls |
| `src/hooks/usePrivateModeAuth.ts` | Client auth hook: wallet signing flow, IntentPayload construction |
| `src/app/shield-demo/page.tsx` | Working demo of shield/unshield/private transfer — good reference implementation |
| `src/components/DefuseSDK/core/messages.ts` | `wrapPayloadAsWalletMessage()` — converts API payloads to wallet-signable format |
| `src/components/DefuseSDK/utils/intentStandards.ts` | Maps auth methods to intent standards (near → nep413) |
| `src/components/DefuseSDK/features/machines/swapIntent1csMachine.ts` | Full swap flow: generateIntent → sign → submitIntent |
| `src/components/DefuseSDK/features/machines/1cs.ts` | Quote logic with CONFIDENTIAL_INTENTS support |
| `src/components/DefuseSDK/features/machines/depositedBalanceMachine.ts` | Balance polling for confidential mode |

---

## Task Breakdown

### Peter's Tasks

#### 1.1 Proof of concept confidential balances and transfer
- Learn from near.com implementation how to create the access token, where is the API server (URL)

#### 1.2 Create a small script in Rust to get confidential balance, and list of transactions

#### 1.3 Create a small script in Rust to request confidential quote → deposit there (e.g. with near-cli-rs) → observe the new balance

#### 1.4 Create a small script in Rust to transfer within FAR network

#### 1.5 Create a small script in Rust to withdraw to public chains

### Megha's Tasks

#### 1.4 Limit features for confidential treasuries
- We don't support bulk payments, export on the UI - mark them as "coming soon"
- Depends on: 1.4.1 Add a flag to the backend (confidential or not)

#### 1.4.1 Add a flag to the backend (confidential or not)

#### 1.5 Extend the onboarding with confidential treasury option

---

## PoC Test Strategy: Rust Sandbox Integration Test

### Reference Implementation

The previous treasury client (neardevhub-treasury-dashboard) has a [Playwright E2E test](https://github.com/NEAR-DevHub/neardevhub-treasury-dashboard/blob/staging/playwright-tests/tests/intents/create-1click-exchange-request.spec.js) that demonstrates the full 1click exchange flow in a NEAR sandbox:

1. Deploy sandbox with `intents.near`, `omft.near`, sputnik DAO factory
2. Create a DAO, fund it with tokens via `ft_deposit`
3. Create a DAO proposal for an exchange (quote → proposal → approve)
4. Simulate the intent execution: solver provides liquidity, both sides sign, call `execute_intents`
5. Verify balances changed

### Adapting for CONFIDENTIAL_INTENTS in Rust

We already have a Rust sandbox setup (`sandbox/sandbox-init`) using `near-sandbox` + `near-api` (not `near-workspaces`). The integration tests in `contracts/bulk-payment/tests/integration_tests.rs` show the patterns for account creation, contract deployment, and DAO interaction.

#### Key insight: no FAR chain sandbox needed

The defuse-frontend (`feat/shield` branch) confirms that the frontend **never talks directly to the FAR chain**. All confidential operations go through just two APIs:

1. **1Click API** (`1click.chaindefuser.com`) — the sole gateway for all confidential operations:
   - Authentication (JWT via wallet signature)
   - Confidential balances (`AccountService.getBalances`)
   - Quotes (`OneClickService.getQuote`)
   - Intent lifecycle (`generateIntent` → `submitIntent` → `getExecutionStatus`)

2. **Intents Explorer API** (`explorer.near-intents.org/api/v0`) — read-only transaction history:
   - `GET /transactions-pages?search={account}&page=...&statuses=...`

No direct FAR chain RPC, no WebSockets. So the PoC test only needs a **single NEAR sandbox** plus **mock HTTP servers** for these two APIs.

#### What we need

A Rust integration test that proves the full confidential intent flow works end-to-end:

1. **Shield:** Public NEAR/token → confidential balance (via `CONFIDENTIAL_INTENTS`)
2. **Private transfer:** Confidential balance → another account on FAR
3. **Unshield:** Confidential balance → public chain

#### Test setup

**NEAR sandbox** with:
- `sputnik-dao.near` factory + DAO instance
- `intents.near` (imported from mainnet)
- `omft.near` with test tokens (ETH, USDC)
- **Mock signer contract** (see below)

**Mock HTTP servers** (e.g., `wiremock` or `axum`):
- Mock 1Click API — returns canned quote/generate-intent/submit-intent responses; validates that request payloads contain `CONFIDENTIAL_INTENTS` types
- Mock Intents Explorer API — returns canned transaction history

#### v1.signer in sandbox

The real `v1.signer` contract can be imported from mainnet, but **MPC signing won't work** — there are no MPC nodes in sandbox. Options:

1. **Mock signer contract** (recommended) — Deploy a simple contract that mimics the `v1.signer` interface but returns deterministic ed25519 signatures from a known keypair
2. **Skip the signer, test the payload** — Verify the DAO proposal constructs the correct `FunctionCall` targeting `v1.signer` with right arguments, then test signing separately with a local keypair

#### Recommended PoC test structure

```
contracts/confidential-intents/
├── Cargo.toml
├── src/
│   └── lib.rs                    # Mock v1.signer contract (returns known signatures)
└── tests/
    └── integration_tests.rs      # Full flow test
```

#### Integration test flow

```rust
#[tokio::test]
async fn test_confidential_intent_full_flow() {
    // 1. Start sandbox, deploy contracts (DAO, intents, omft, mock-signer)
    //    Start mock 1Click API + Intents Explorer servers
    // 2. Create DAO with council member
    // 3. Fund DAO with test tokens (ETH on omft)

    // 4. SHIELD: Create proposal to shield tokens (public → confidential)
    //    - Get mock quote (depositType: INTENTS, recipientType: CONFIDENTIAL_INTENTS)
    //    - Proposal kind: FunctionCall to mock-signer with intent payload
    //    - Approve proposal → mock-signer returns signature
    //    - Submit signed intent to mock 1Click API
    //    - Verify: public balance decreased

    // 5. PRIVATE TRANSFER: Create proposal for confidential transfer
    //    - depositType: CONFIDENTIAL_INTENTS, recipientType: CONFIDENTIAL_INTENTS
    //    - Same flow: proposal → approve → sign → submit

    // 6. UNSHIELD: Create proposal to unshield back to public
    //    - depositType: CONFIDENTIAL_INTENTS, recipientType: INTENTS
    //    - Same flow: proposal → approve → sign → submit
    //    - Simulate intent execution on intents.near (register deposit key,
    //      build solver + 1Click intents with NEP-413 sigs, call execute_intents)
    //    - Verify: public balance increased
}
```

### Backend Tasks (unassigned)

#### 1.2 Backend for getting the balances, keep track of confidential transactions
- Or references that we can re-populate the database from

#### 1.3 Backend for processing the approved proposals
- Construct a signed FAR chain request from the v1.signer signature

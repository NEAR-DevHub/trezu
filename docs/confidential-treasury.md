
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

The near.com flow assumes synchronous wallet signing via NEP-413 (`wallet.signMessage()`). DAOs don't have wallet keys. The flow for DAOs:

1. Create a DAO proposal that includes the intent payload to sign
2. DAO members approve the proposal
3. On execution, the proposal calls `v1.signer` (chain-signatures contract) to produce an MPC signature
4. The signed intent is submitted to the private intents API

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

All operations follow: **get quote → generate intent → sign → submit intent → poll status**

#### Shield (public → private)
```
depositType: INTENTS
recipientType: CONFIDENTIAL_INTENTS
refundType: CONFIDENTIAL_INTENTS
```

#### Unshield (private → public)
```
depositType: CONFIDENTIAL_INTENTS
recipientType: INTENTS
refundType: CONFIDENTIAL_INTENTS
```

#### Private Transfer (private → private, different recipient)
```
depositType: CONFIDENTIAL_INTENTS
recipientType: CONFIDENTIAL_INTENTS
refundType: CONFIDENTIAL_INTENTS
recipient: "near:recipient.near"
```

#### Confidential Swap (private, token A → token B)
```
depositType: CONFIDENTIAL_INTENTS
recipientType: CONFIDENTIAL_INTENTS
refundType: CONFIDENTIAL_INTENTS
```

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

### Backend Tasks (unassigned)

#### 1.2 Backend for getting the balances, keep track of confidential transactions
- Or references that we can re-populate the database from

#### 1.3 Backend for processing the approved proposals
- Construct a signed FAR chain request from the v1.signer signature

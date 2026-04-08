# Address Book Feature

## Overview

The address book allows DAO members to store named wallet addresses associated with a specific treasury. Each entry can span multiple blockchain networks, making it useful for recurring payment recipients, known counterparties, and trusted addresses.

---

## Database

### Migration

`nt-be/migrations/20260319000001_create_address_book.sql`

### Table: `address_book`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID` | Primary key, auto-generated |
| `dao_id` | `VARCHAR(128)` | FK → `monitored_accounts(account_id)`, `ON DELETE CASCADE` |
| `name` | `TEXT` | Display label |
| `networks` | `TEXT[]` | Array of network string keys (e.g. `{"near", "eth"}`) |
| `address` | `TEXT` | Wallet address (format varies by network) |
| `note` | `TEXT` | Optional annotation |
| `created_by` | `UUID` | FK → `users(id)`, `ON DELETE SET NULL`, nullable |
| `created_at` | `TIMESTAMPTZ` | Auto-set on insert |

**Indexes:** `idx_address_book_dao_id`, `idx_address_book_created_by`

**Network keys** match the string keys defined in `nt-be/src/constants/intents_chains.rs` (e.g. `"near"`, `"eth"`, `"solana"`, `"base"`, etc.).

---

## API Endpoints

All endpoints require authentication (JWT cookie). Write operations additionally require the caller to be a policy member of the DAO.

### `GET /api/address-book?daoId={dao_id}`

Returns all address book entries for the given DAO, ordered by `created_at DESC`.

**Auth:** authenticated + DAO policy member

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "daoId": "treasury.sputnik-dao.near",
    "name": "Alice",
    "networks": ["near", "eth"],
    "address": "alice.near",
    "note": "Core contributor",
    "createdBy": "uuid-or-null",
    "createdAt": "2026-03-19T12:00:00Z"
  }
]
```

---

### `POST /api/address-book`

Creates one or more address book entries in a single request.

**Auth:** authenticated + DAO policy member

**Request body:**
```json
{
  "daoId": "treasury.sputnik-dao.near",
  "entries": [
    {
      "name": "Alice",
      "networks": ["near", "eth"],
      "address": "alice.near",
      "note": "Optional note"
    },
    {
      "name": "Bob",
      "networks": ["near"],
      "address": "bob.near"
    }
  ]
}
```

**Response `200`:** array of created `AddressBookEntry` objects (same shape as GET response items)

**Errors:**
- `400` — `entries` is empty
- `403` — not a DAO policy member

---

### `DELETE /api/address-book/{id}`

Deletes an address book entry by UUID.

**Auth:** authenticated + DAO policy member of the entry's DAO

**Response `204`:** no content

**Errors:**
- `403` — not a DAO policy member
- `404` — entry not found

---

## Implementation Files

### Backend

| File | Change |
|------|--------|
| `nt-be/migrations/20260319000001_create_address_book.sql` | New — creates table and indexes |
| `nt-be/src/handlers/address_book.rs` | New — all three handler functions |
| `nt-be/src/handlers/mod.rs` | Added `pub mod address_book;` |
| `nt-be/src/routes/mod.rs` | Registered `/api/address-book` and `/api/address-book/{id}` routes |

### Frontend

| File | Change |
|------|--------|
| `nt-fe/features/address-book/api.ts` | New — typed API functions (`getAddressBook`, `createAddressBookEntry`, `deleteAddressBookEntry`) |
| `nt-fe/features/address-book/hooks.ts` | New — React Query hooks (`useAddressBook`, `useCreateAddressBookEntry`, `useDeleteAddressBookEntry`) |
| `nt-fe/features/address-book/index.ts` | New — public feature exports |
| `nt-fe/app/(treasury)/[treasuryId]/address-book/page.tsx` | New — Address Book page with empty state |

---

## Frontend Feature (`nt-fe/features/address-book/`)

### Types (`types/index.ts`)

```ts
interface AddressBookEntry {
    id: string;
    daoId: string;
    name: string;
    networks: string[];
    address: string;
    note?: string;
    createdBy?: string;
    createdAt: string;
}

interface AddressBookEntryInput {
    name: string;
    networks: string[];
    address: string;
    note?: string;
}

interface CreateAddressBookEntriesInput {
    daoId: string;
    entries: AddressBookEntryInput[];
}
```

### Hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useAddressBook(daoId)` | `UseQueryResult<AddressBookEntry[]>` | Fetches all entries for a DAO |
| `useCreateAddressBookEntries(daoId)` | `UseMutationResult<AddressBookEntry[]>` | Creates multiple entries in one request, invalidates cache on success |
| `useCreateAddressBookEntry(daoId)` | `UseMutationResult<AddressBookEntry>` | Convenience wrapper for a single entry |
| `useDeleteAddressBookEntry(daoId)` | `UseMutationResult` | Deletes an entry by id, invalidates cache on success |

Query key: `["address-book", daoId]`

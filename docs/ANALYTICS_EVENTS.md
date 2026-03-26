# Analytics Events

All events are fired via `trackEvent()` from `nt-fe/lib/analytics.ts`, which sends to both **PostHog** and **Google Analytics** (GA4) simultaneously.

All event names use `kebab-case`.

---

## Authentication & Wallet

### `wallet-connect-clicked`

User clicks the connect wallet button on the welcome/login page.


| Property | Type | Description |
| -------- | ---- | ----------- |
| *(none)* |      |             |


**Source:** [nt-fe/app/(init)/page.tsx](../nt-fe/app/(init)/page.tsx)

---

### `wallet-missing-click`

User clicks "I don't have a wallet" on the welcome page.


| Property | Type   | Description      |
| -------- | ------ | ---------------- |
| `source` | string | `"welcome_page"` |


**Source:** [nt-fe/app/(init)/page.tsx](../nt-fe/app/(init)/page.tsx)

---

### `wallet-selected`

User selects and connects a wallet (fired on both `wallet:signIn` and `wallet:signInAndSignMessage` events).


| Property      | Type   | Description         |
| ------------- | ------ | ------------------- |
| `wallet_id`   | string | Wallet manifest ID  |
| `wallet_name` | string | Wallet display name |


**Source:** [nt-fe/stores/near-store.ts](../nt-fe/stores/near-store.ts)

---

### `new-wallet-connected`

User successfully accepts terms after connecting a wallet.


| Property     | Type   | Description        |
| ------------ | ------ | ------------------ |
| `source`     | string | `"terms-accepted"` |
| `account_id` | string | NEAR account ID    |


**Source:** [nt-fe/stores/near-store.ts](../nt-fe/stores/near-store.ts)

---

## Waitlist

### `waitlist-submitted`

User submits their NEAR account to the waitlist.


| Property     | Type   | Description               |
| ------------ | ------ | ------------------------- |
| `account_id` | string | NEAR account ID submitted |


**Source:** [nt-fe/app/(init)/page.tsx](../nt-fe/app/(init)/page.tsx)

---

## Treasury Creation

### `treasury-creation-step-1-completed`

User completes step 1 (treasury details) of the creation wizard.


| Property | Type | Description |
| -------- | ---- | ----------- |
| *(none)* |      |             |


**Source:** [nt-fe/app/(treasury)/app/new/page.tsx](../nt-fe/app/(treasury)/app/new/page.tsx)

---

### `treasury-creation-step-2-completed`

User completes step 2 (members) of the creation wizard.


| Property        | Type   | Description             |
| --------------- | ------ | ----------------------- |
| `members_count` | number | Number of members added |


**Source:** [nt-fe/app/(treasury)/app/new/page.tsx](../nt-fe/app/(treasury)/app/new/page.tsx)

---

### `treasury-creation-step-3-viewed`

User lands on step 3 (review/confirm) of the creation wizard.


| Property | Type | Description |
| -------- | ---- | ----------- |
| *(none)* |      |             |


**Source:** [nt-fe/app/(treasury)/app/new/page.tsx](../nt-fe/app/(treasury)/app/new/page.tsx)

---


### `treasury-created`

Fired after successful treasury creation API call.


| Property        | Type   | Description                    |
| --------------- | ------ | ------------------------------ |
| `treasury_id`   | string | New treasury ID                |
| `source`        | string | `"/app/new"`                   |
| `members_count` | number | Total members across all roles |


**Source:** [nt-fe/app/(treasury)/app/new/page.tsx](../nt-fe/app/(treasury)/app/new/page.tsx)

---

## Treasury Settings

### `treasury-settings-updated`

User saves changes to treasury general settings.


| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `treasury_id` | string | Treasury ID |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/settings/components/general-tab.tsx](../nt-fe/app/(treasury)/[treasuryId]/settings/components/general-tab.tsx)

---

## Members

### `member-add-modal-opened`

User opens the add member modal.


| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `treasury_id` | string | Treasury ID |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx)

---

### `member-add-review-clicked`

User clicks "Review" in the add member flow, triggering validation.


| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `treasury_id` | string | Treasury ID |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx)

---

### `member-add-submitted`

User successfully submits new member(s) for addition.


| Property        | Type   | Description                   |
| --------------- | ------ | ----------------------------- |
| `treasury_id`   | string | Treasury ID                   |
| `members_count` | number | Number of members being added |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx)

---

### `member-edit-review-clicked`

User clicks "Review" in the edit member flow.


| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `treasury_id` | string | Treasury ID |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx)

---

### `member-edit-submitted`

User successfully submits member role edits.


| Property        | Type   | Description                    |
| --------------- | ------ | ------------------------------ |
| `treasury_id`   | string | Treasury ID                    |
| `members_count` | number | Number of members being edited |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx)

---

### `member-delete-submitted`

User successfully submits member removal.


| Property        | Type   | Description                     |
| --------------- | ------ | ------------------------------- |
| `treasury_id`   | string | Treasury ID                     |
| `members_count` | number | Number of members being removed |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx)

---

## Payments

### `payment-submitted`

User submits a single payment request.


| Property       | Type          | Description                        |
| -------------- | ------------- | ---------------------------------- |
| `treasury_id`  | string        | Treasury ID                        |
| `token_symbol` | string        | Token symbol (e.g. `NEAR`, `USDC`) |
| `amount`       | string/number | Payment amount                     |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/payments/page.tsx)

---

### `bulk-payments-click`

User clicks the bulk payments button on the payments page.


| Property      | Type   | Description       |
| ------------- | ------ | ----------------- |
| `source`      | string | `"payments_page"` |
| `treasury_id` | string | Treasury ID       |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/payments/page.tsx)

---

### `bulk-payments-review-step-view`

User reaches the review step in the bulk payment flow.


| Property           | Type   | Description                                           |
| ------------------ | ------ | ----------------------------------------------------- |
| `source`           | string | `"upload_continue"` | `"edit_save"` | `"edit_cancel"` |
| `treasury_id`      | string | Treasury ID                                           |
| `recipients_count` | number | Number of payment recipients                          |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/page.tsx)

---

### `bulk-payments-submit-click`

User clicks submit on the bulk payments review step.


| Property      | Type   | Description                   |
| ------------- | ------ | ----------------------------- |
| `source`      | string | `"bulk_payments_review_step"` |
| `treasury_id` | string | Treasury ID                   |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/components/review-payments-step.tsx](../nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/components/review-payments-step.tsx)

---

### `bulk-payment-submitted`

Bulk payment batch is successfully submitted on-chain.


| Property           | Type   | Description                       |
| ------------------ | ------ | --------------------------------- |
| `treasury_id`      | string | Treasury ID                       |
| `token_symbol`     | string | Token symbol                      |
| `recipients_count` | number | Number of recipients in the batch |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/page.tsx)

---

## Exchange (Swap)

### `exchange-submitted`

User submits a token swap proposal.


| Property               | Type   | Description          |
| ---------------------- | ------ | -------------------- |
| `treasury_id`          | string | Treasury ID          |
| `sell_token_symbol`    | string | Token being sold     |
| `receive_token_symbol` | string | Token being received |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/exchange/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/exchange/page.tsx)

---

## Proposals / Requests

### `request-detail-viewed`

User opens a request/proposal detail page.


| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `proposal_id` | string | Proposal ID |
| `treasury_id` | string | Treasury ID |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/requests/[id]/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/requests/[id]/page.tsx)

---

### `proposal-voted`

User submits a vote on one or more proposals.


| Property          | Type   | Description                               |
| ----------------- | ------ | ----------------------------------------- |
| `vote`            | string | Vote value (e.g. `"approve"`, `"reject"`) |
| `proposals_count` | number | Number of proposals voted on              |
| `treasury_id`     | string | Treasury ID                               |


**Source:** [nt-fe/stores/near-store.ts](../nt-fe/stores/near-store.ts)

---

## Deposit

### `deposit-asset-and-network-selected`

User selects both an asset and a network in the deposit modal.


| Property       | Type   | Description                   |
| -------------- | ------ | ----------------------------- |
| `treasury_id`  | string | Treasury ID                   |
| `asset_id`     | string | Selected asset ID             |
| `asset_name`   | string | Selected asset display name   |
| `network_id`   | string | Selected network ID           |
| `network_name` | string | Selected network display name |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/dashboard/components/deposit-modal.tsx](../nt-fe/app/(treasury)/[treasuryId]/dashboard/components/deposit-modal.tsx)

---

## Export

### `export-click`

User clicks the export button (CSV/report download shortcut).


| Property      | Type   | Description       |
| ------------- | ------ | ----------------- |
| `source`      | string | `"export_button"` |
| `treasury_id` | string | Treasury ID       |


**Source:** [nt-fe/components/export-button.tsx](../nt-fe/components/export-button.tsx)

---

### `export-generate-click`

User clicks "Generate" on the full export page.


| Property        | Type   | Description                     |
| --------------- | ------ | ------------------------------- |
| `source`        | string | `"dashboard_export_page"`       |
| `treasury_id`   | string | Treasury ID                     |
| `document_type` | string | Type of document being exported |


**Source:** [nt-fe/app/(treasury)/[treasuryId]/dashboard/export/page.tsx](../nt-fe/app/(treasury)/[treasuryId]/dashboard/export/page.tsx)

---



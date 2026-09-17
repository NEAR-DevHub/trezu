# Analytics Events

Nothing is sent until the visitor grants **Analytics** consent in the cookie banner (`nt-fe/components/cookie-consent/`). Consent lives in the `trezu_cookie_consent` cookie; PostHog is only initialized, and GA/GTM scripts only loaded, once it is granted. `trackEvent()` is a no-op without it.

Most events are fired via `trackEvent()` from `nt-fe/lib/analytics.ts`, which sends to **PostHog**, **Google Tag Manager** (`dataLayer`), and **Google Analytics** (GA4 via `gtag`) simultaneously. Marketing configures conversion tracking and ad pixels inside GTM; GA4 also receives events directly.

Some onboarding survey events are provider-specific and are sent directly with `posthog.capture()` (PostHog-only).

All event names are `snake_case`. Events originally emitted in `kebab-case` (e.g. `nav-click`, `treasury-created`) were renamed on 2026-09-17; PostHog data before that date is under the old names.

---

## Onboarding Funnel (PostHog)

Recommended sequential funnel for new-user onboarding:

1. `onboarding_landed`
2. `onboarding_login_completed` _(optional — users already logged in may skip this step)_
3. `treasury_created`

Track returning users separately with `onboarding_existing_treasury_redirect` (not part of the funnel).

Break down step 1 by `page` (`"/"` vs `"/create"`).

`/login` is in-app login, not onboarding — it fires `wallet_connection_completed` only.

---

## Onboarding & Login

### `onboarding_landed`

User enters the onboarding flow on `/` or `/create`. Not fired when a logged-in user with an existing treasury is auto-redirected to their dashboard.

| Property           | Type    | Description                                      |
| ------------------ | ------- | ------------------------------------------------ |
| `page`             | string  | `"/"` or `"/create"`                             |
| `is_authenticated` | boolean | Whether user already had a session at entry time |

**Source:** [nt-fe/features/onboarding/components/create-treasury-entry.tsx](../nt-fe/features/onboarding/components/create-treasury-entry.tsx)

---

### `onboarding_existing_treasury_redirect`

Logged-in user with at least one treasury landed on `/` or `/create` and is redirected to their treasury (not a new onboarding start).

| Property      | Type   | Description               |
| ------------- | ------ | ------------------------- |
| `entry_page`  | string | `"/"` or `"/create"`      |
| `treasury_id` | string | Treasury ID redirected to |

**Source:** [nt-fe/features/onboarding/components/create-treasury-entry.tsx](../nt-fe/features/onboarding/components/create-treasury-entry.tsx)

---

### `onboarding_login_completed`

User completed wallet login during onboarding (`/` or `/create`). Not fired for `/login` or other in-app login surfaces.

| Property     | Type   | Description          |
| ------------ | ------ | -------------------- |
| `page`       | string | `"/"` or `"/create"` |
| `account_id` | string | NEAR account ID      |

**Source:** [nt-fe/stores/near-store.ts](../nt-fe/stores/near-store.ts) — only when `connect()` is called with an `onboardingPage` argument from [create-treasury-entry.tsx](../nt-fe/features/onboarding/components/create-treasury-entry.tsx)

---

### `onboarding_wallet_option_clicked`

User clicks a wallet option in the shared wallet selector. Does **not** fire when the user clicks the NEAR wallet group card (opens sub-picker only); fires when a specific wallet is chosen.

| Property       | Type    | Description                                      |
| -------------- | ------- | ------------------------------------------------ |
| `wallet_id`    | string  | Wallet key (e.g. `ledger`, `meteor-wallet`)      |
| `is_supported` | boolean | Whether wallet is currently supported            |
| `source`       | string  | UI surface (e.g. `"/"`, `"/create"`, `"/login"`) |
| `connect_flow` | string  | `"onboarding"` or `"within_treasury"`            |

**Source:** [nt-fe/components/connect-wallet-selector.tsx](../nt-fe/components/connect-wallet-selector.tsx)

---

### `wallet_selected`

Wallet selected in the connector during login.

| Property      | Type   | Description         |
| ------------- | ------ | ------------------- |
| `wallet_id`   | string | Wallet manifest ID  |
| `wallet_name` | string | Wallet display name |

**Source:** [nt-fe/stores/near-store.ts](../nt-fe/stores/near-store.ts)

---

### `wallet_connection_completed`

Wallet auth flow successfully completed. Fired for all login surfaces (onboarding, `/login`, etc.).

| Property     | Type   | Description                            |
| ------------ | ------ | -------------------------------------- |
| `source`     | string | `"resolve-auth"` or `"terms-accepted"` |
| `account_id` | string | NEAR account ID when available         |

**Source:** [nt-fe/stores/near-store.ts](../nt-fe/stores/near-store.ts)

---

### `treasury_created`

Treasury creation stream completed successfully.

| Property      | Type   | Description     |
| ------------- | ------ | --------------- |
| `treasury_id` | string | New treasury ID |

**Source:** [nt-fe/features/onboarding/components/create-treasury-entry.tsx](../nt-fe/features/onboarding/components/create-treasury-entry.tsx)

---

### `onboarding_completed`

Fired alongside `treasury_created` when a new treasury is created.

| Property      | Type   | Description     |
| ------------- | ------ | --------------- |
| `treasury_id` | string | New treasury ID |

**Source:** [nt-fe/features/onboarding/components/create-treasury-entry.tsx](../nt-fe/features/onboarding/components/create-treasury-entry.tsx)

---

## Legacy / Deprecated (Onboarding)

These may still exist in old PostHog data but are no longer emitted:

- `treasury-creation-step-1-completed`
- `treasury-creation-step-2-completed`
- `treasury-creation-step-3-viewed`
- `new-wallet-connected`
- `onboarding_landing_viewed`
- `onboarding_path_selected`
- `onboarding_cta_clicked`
- `onboarding_step_completed`
- `create-treasury-prompt-shown`
- `waitlist-submitted`
- `existing_user_treasury_opened`
- `survey shown` _(PostHog-only)_
- `survey sent` _(PostHog-only)_

---

## Navigation

### `nav_click`

User navigates between product areas from a nav surface or a shortcut button. One event, distinguished by `source`; `destination` values depend on the surface.

| Property      | Type   | Description                                                                 |
| ------------- | ------ | --------------------------------------------------------------------------- |
| `destination` | string | Where the user is going; see the table below for the values each surface sends |
| `source`      | string | The surface clicked; see below                                              |
| `treasury_id` | string | Treasury ID                                                                 |

| `source`               | `destination` values                                                                | Source file                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `sidebar`              | `dashboard`, `requests`, `payments`, `exchange`, `address-book`, `members`, `settings` | [nt-fe/components/sidebar.tsx](../nt-fe/components/sidebar.tsx)                                   |
| `mobile-bottom-nav`    | `dashboard`, `requests`, `contacts`                                                 | [nt-fe/components/mobile-shell/mobile-bottom-nav.tsx](../nt-fe/components/mobile-shell/mobile-bottom-nav.tsx) |
| `mobile-menu`          | `send`, `swap`, `members`, `settings`                                               | [nt-fe/components/mobile-shell/mobile-menu-sheet.tsx](../nt-fe/components/mobile-shell/mobile-menu-sheet.tsx) |
| `dashboard`            | `deposit`, `payments`, `exchange` (the Receive / Send / Swap buttons)               | [balance-with-graph.tsx](<../nt-fe/app/(treasury)/[treasuryId]/dashboard/components/balance-with-graph.tsx>), [fund-account-empty.tsx](<../nt-fe/app/(treasury)/[treasuryId]/dashboard/components/fund-account-empty.tsx>) |
| `dashboard-assets`     | `payments`, `exchange` (Send / Swap on an asset row)                                | [nt-fe/components/asset-row-action-menu.tsx](../nt-fe/components/asset-row-action-menu.tsx), [mobile-asset-action-sheet.tsx](../nt-fe/components/mobile-shell/mobile-asset-action-sheet.tsx) |
| `members-action-sheet` | `payments` (Send to a member)                                                       | [members/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx>)                       |

The sheet names the sidebar case `sidebar_navigation` and the dashboard buttons `dashboard_cta_click`; both map to `nav_click` filtered by `source`. Note the surfaces are not normalised: the same page is `payments` from the sidebar but `send` from the mobile menu, and `address-book` versus `contacts`.

---

## Treasury Settings

### `treasury_settings_updated`

User saves changes to treasury general settings.

| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `treasury_id` | string | Treasury ID |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/settings/components/general-tab.tsx](<../nt-fe/app/(treasury)/[treasuryId]/settings/components/general-tab.tsx>)

---

## Members

### `member_add_modal_opened`

User opens the add member modal.

| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `treasury_id` | string | Treasury ID |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx>)

---

### `member_add_review_clicked`

User clicks "Review" in the add member flow, triggering validation.

| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `treasury_id` | string | Treasury ID |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx>)

---

### `member_add_submitted`

User successfully submits new member(s) for addition.

| Property        | Type   | Description                   |
| --------------- | ------ | ----------------------------- |
| `treasury_id`   | string | Treasury ID                   |
| `members_count` | number | Number of members being added |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx>)

---

### `member_edit_review_clicked`

User clicks "Review" in the edit member flow.

| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `treasury_id` | string | Treasury ID |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx>)

---

### `member_edit_submitted`

User successfully submits member role edits.

| Property        | Type   | Description                    |
| --------------- | ------ | ------------------------------ |
| `treasury_id`   | string | Treasury ID                    |
| `members_count` | number | Number of members being edited |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx>)

---

### `member_delete_submitted`

User successfully submits member removal.

| Property        | Type   | Description                     |
| --------------- | ------ | ------------------------------- |
| `treasury_id`   | string | Treasury ID                     |
| `members_count` | number | Number of members being removed |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/members/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/members/page.tsx>)

---

## Payments

### `payment_submitted`

User submits a single payment request.

| Property       | Type          | Description                        |
| -------------- | ------------- | ---------------------------------- |
| `treasury_id`  | string        | Treasury ID                        |
| `token_symbol` | string        | Token symbol (e.g. `NEAR`, `USDC`) |
| `amount`       | string/number | Payment amount                     |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/payments/page.tsx>)

---

### `bulk_payments_click`

User clicks the bulk payments button on the payments page.

| Property      | Type   | Description       |
| ------------- | ------ | ----------------- |
| `source`      | string | `"payments_page"` |
| `treasury_id` | string | Treasury ID       |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/payments/page.tsx>)

---

### `bulk_payments_review_step_view`

User reaches the review step in the bulk payment flow.

| Property           | Type   | Description                  |
| ------------------ | ------ | ---------------------------- | ------------- | --------------- |
| `source`           | string | `"upload_continue"`          | `"edit_save"` | `"edit_cancel"` |
| `treasury_id`      | string | Treasury ID                  |
| `recipients_count` | number | Number of payment recipients |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/page.tsx>)

---

### `bulk_payments_submit_click`

User clicks submit on the bulk payments review step.

| Property      | Type   | Description                   |
| ------------- | ------ | ----------------------------- |
| `source`      | string | `"bulk_payments_review_step"` |
| `treasury_id` | string | Treasury ID                   |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/components/review-payments-step.tsx](<../nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/components/review-payments-step.tsx>)

---

### `bulk_payment_submitted`

Bulk payment batch is successfully submitted on-chain.

| Property           | Type   | Description                       |
| ------------------ | ------ | --------------------------------- |
| `treasury_id`      | string | Treasury ID                       |
| `token_symbol`     | string | Token symbol                      |
| `recipients_count` | number | Number of recipients in the batch |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/payments/bulk-payment/page.tsx>)

---

## Exchange (Swap)

### `exchange_submitted`

User submits a token swap proposal.

| Property               | Type   | Description          |
| ---------------------- | ------ | -------------------- |
| `treasury_id`          | string | Treasury ID          |
| `sell_token_symbol`    | string | Token being sold     |
| `receive_token_symbol` | string | Token being received |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/exchange/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/exchange/page.tsx>)

---

## Proposals / Requests

### `request_detail_viewed`

User opens a request/proposal detail page.

| Property      | Type   | Description |
| ------------- | ------ | ----------- |
| `proposal_id` | string | Proposal ID |
| `treasury_id` | string | Treasury ID |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/requests/[id]/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/requests/[id]/page.tsx>)

---

### `proposal_voted`

User submits a vote on one or more proposals.

| Property          | Type   | Description                               |
| ----------------- | ------ | ----------------------------------------- |
| `vote`            | string | Vote value (e.g. `"approve"`, `"reject"`) |
| `proposals_count` | number | Number of proposals voted on              |
| `treasury_id`     | string | Treasury ID                               |

**Source:** [nt-fe/stores/near-store.ts](../nt-fe/stores/near-store.ts)

---

## Deposit

### `deposit_asset_and_network_selected`

User selects both an asset and a network in the deposit modal.

| Property       | Type   | Description                   |
| -------------- | ------ | ----------------------------- |
| `treasury_id`  | string | Treasury ID                   |
| `asset_id`     | string | Selected asset ID             |
| `asset_name`   | string | Selected asset display name   |
| `network_id`   | string | Selected network ID           |
| `network_name` | string | Selected network display name |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/dashboard/components/deposit-modal.tsx](<../nt-fe/app/(treasury)/[treasuryId]/dashboard/components/deposit-modal.tsx>)

---

## Export

### `export_click`

User clicks the export button (CSV/report download shortcut).

| Property      | Type   | Description       |
| ------------- | ------ | ----------------- |
| `source`      | string | `"export_button"` |
| `treasury_id` | string | Treasury ID       |

**Source:** [nt-fe/components/export-button.tsx](../nt-fe/components/export-button.tsx)

---

### `export_generate_click`

User clicks "Generate" on the full export page.

| Property        | Type   | Description                     |
| --------------- | ------ | ------------------------------- |
| `source`        | string | `"dashboard_export_page"`       |
| `treasury_id`   | string | Treasury ID                     |
| `document_type` | string | Type of document being exported |

**Source:** [nt-fe/app/(treasury)/[treasuryId]/dashboard/export/page.tsx](<../nt-fe/app/(treasury)/[treasuryId]/dashboard/export/page.tsx>)

---

## Product Tracking Sheet Events (added 2026-09-17)

The events below implement the product analytics sheet ("Sign in Creation" … "Members" tabs). These use the sheet's `snake_case` names as-is. Earlier events that the sheet lists under a different name (`wallet_selected`, `treasury_created`, `nav_click`, `bulk_payments_click`) keep their original names and semantics, now in `snake_case`. Every event below carries `treasury_id`, listed first in its Properties cell.

### Navigation

| Event                 | Properties                                                                                                             | Source                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `user_menu_click`     | `treasury_id`; `menu_type`: `my_account` \| `language` \| `help_support` \| `terms_of_service` \| `privacy_policy`; `source`: `sidebar` \| `mobile-user-sheet` | `components/sidebar-profile-menu.tsx`, `components/mobile-shell/mobile-user-sheet.tsx` |
| `treasury_menu_click` | `treasury_id`; `menu_type`: `manage_treasuries` \| `create_treasury` | `components/treasury-selector.tsx`                                         |

### Dashboard

| Event                           | Properties                                                                                          | Source                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `chart_filter`                  | `treasury_id`; `filter_type`: `token` (+ `token_symbol`, `all` for the reset) \| `time_period` (+ `time_value`: `1W`/`1M`/`3M`/`1Y`) | `dashboard/components/balance-with-graph.tsx`                 |
| `recent_transactions_view_more` | `treasury_id` | `features/activity/components/recent-activity-card.tsx`       |
| `transactions_search`           | `treasury_id`; `action`: `search_used` (fires when a non-empty tx hash is searched) | `dashboard/activity/page.tsx`                                 |
| `transactions_filter_applied`   | `treasury_id`; `filter_type`: `created_date` \| `token` \| `from` \| `to` | `features/proposals/hooks/use-filter-params.ts` (via `filterEventName`) |
| `transactions_tab_click`        | `treasury_id`; `tab_type`: `all` \| `send` \| `received` \| `swap` | `dashboard/activity/page.tsx`                                 |
| `pending_request_action`        | `treasury_id`; `interaction_type`: `approve` \| `reject` \| `view_details`; `proposal_id`. Fires on click, before the vote modal; `proposal_voted` is the completion. | `features/proposals/components/pending-requests/index.tsx`    |
| `pending_requests_view_all`     | `treasury_id` | `features/proposals/components/pending-requests/index.tsx`    |
| `receive_cta`                   | `treasury_id`; `button_type`: `copy` \| `share` | `dashboard/components/deposit/deposit-address-card.tsx`       |

### Requests

| Event                     | Properties                                                                                                     | Source                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `requests_search`         | `treasury_id`; `action`: `search_used` | `requests/page.tsx`                                                     |
| `requests_filter_applied` | `treasury_id`; `filter_type`: `proposal_types` \| `created_date` \| `recipients` \| `token` \| `proposers` \| `approvers` \| `my_vote` | `features/proposals/hooks/use-filter-params.ts` (via `filterEventName`) |
| `requests_tab_click`      | `treasury_id`; `tab_type`: `all` \| `pending` \| `executed` \| `rejected` \| `expired` \| `failed` | `requests/page.tsx`                                                     |
| `bulk_approve`            | `treasury_id`; `interaction_type`: `approve` \| `reject`; `requests_count`. Fires on click, before the vote modal; `proposal_voted` is the completion. | `features/proposals/components/proposals-table.tsx`                     |

### Send

| Event                    | Properties                                    | Source                                                  |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------- |
| `bulk_payment_data_type` | `treasury_id`; `data_type`: `upload_file` \| `provide_data` | `payments/bulk-payment/components/upload-data-step.tsx` |

### Swap

| Event         | Properties | Source                           |
| ------------- | ---------- | -------------------------------- |
| `sell_max`    | `treasury_id` | `exchange/components/step1.tsx`  |
| `receive_max` | `treasury_id` | `exchange/components/step1.tsx`  |

### Contacts and Members

`table_cta_click` and `bulk_action` are shared between the two pages and carry `page`: `contacts` \| `members`.

| Event             | Properties                                                                                          | Source                                        |
| ----------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `table_cta_click` | `treasury_id`; `page`; `cta_button`: `add_contact` \| `import` \| `export` (contacts), `add_manually` \| `invite_member` (members) | `address-book/page.tsx`, `members/page.tsx`   |
| `contact_action`  | `treasury_id`; `contact_action`: `send` \| `delete` | `address-book/page.tsx`                       |
| `member_action`   | `treasury_id`; `members_action`: `edit` \| `delete` | `members/page.tsx`                            |
| `bulk_action`     | `treasury_id`; `page`; `interaction_type`: `export` \| `delete` (contacts), `edit` \| `delete` (members); `count`. `delete` fires before the confirm dialog; members completion is `member_delete_submitted`, contacts has no completion event. | `address-book/page.tsx`, `members/page.tsx`   |

---

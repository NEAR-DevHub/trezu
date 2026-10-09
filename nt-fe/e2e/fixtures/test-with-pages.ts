/**
 * Playwright fixture wiring for the Page Object Model. Specs import `test`/
 * `expect` from here instead of `@playwright/test` directly, and get POM
 * instances injected the same way `page`/`context` are — no manual
 * `new RequestDetailsPage(page)` boilerplate per test.
 */
import { test as base } from "@playwright/test";
import { VoteDialogComponent } from "../components/vote-dialog.component";
import { WalletConnectorPopupComponent } from "../components/wallet-connector-popup.component";
import { RequestDetailsPage } from "../pages/request-details.page";
import { RequestsPage } from "../pages/requests.page";

interface PageObjectFixtures {
    requestDetailsPage: RequestDetailsPage;
    requestsPage: RequestsPage;
    voteDialog: VoteDialogComponent;
    walletConnectorPopup: WalletConnectorPopupComponent;
}

export const test = base.extend<PageObjectFixtures>({
    requestDetailsPage: async ({ page }, use) => {
        await use(new RequestDetailsPage(page));
    },
    requestsPage: async ({ page }, use) => {
        await use(new RequestsPage(page));
    },
    voteDialog: async ({ page }, use) => {
        await use(new VoteDialogComponent(page));
    },
    walletConnectorPopup: async ({ page }, use) => {
        await use(new WalletConnectorPopupComponent(page));
    },
});

export { expect } from "@playwright/test";

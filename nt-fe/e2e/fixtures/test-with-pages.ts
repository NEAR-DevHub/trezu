/**
 * Playwright fixture wiring for the Page Object Model. Specs import `test`/
 * `expect` from here instead of `@playwright/test` directly, and get POM
 * instances injected the same way `page`/`context` are — no manual
 * `new DashboardPage(page)` boilerplate per test.
 */
import { test as base } from "@playwright/test";
import { CustomTemplatesPage } from "../pages/custom-templates.page";
import { DashboardPage } from "../pages/dashboard.page";
import { DepositPage } from "../pages/deposit.page";
import { ExchangePage } from "../pages/exchange.page";
import { LoginPage } from "../pages/login.page";
import { PaymentsPage } from "../pages/payments.page";
import { RequestsPage } from "../pages/requests.page";
import { StartPage } from "../pages/start.page";
import { TestDappPage } from "../pages/test-dapp.page";
import { WalletPopupPage } from "../pages/wallet-popup.page";

interface PageObjectFixtures {
    dashboardPage: DashboardPage;
    requestsPage: RequestsPage;
    startPage: StartPage;
    customTemplatesPage: CustomTemplatesPage;
    exchangePage: ExchangePage;
    depositPage: DepositPage;
    loginPage: LoginPage;
    walletPopupPage: WalletPopupPage;
    testDappPage: TestDappPage;
    paymentsPage: PaymentsPage;
}

export const test = base.extend<PageObjectFixtures>({
    dashboardPage: async ({ page }, use) => {
        await use(new DashboardPage(page));
    },
    requestsPage: async ({ page }, use) => {
        await use(new RequestsPage(page));
    },
    startPage: async ({ page }, use) => {
        await use(new StartPage(page));
    },
    customTemplatesPage: async ({ page }, use) => {
        await use(new CustomTemplatesPage(page));
    },
    exchangePage: async ({ page }, use) => {
        await use(new ExchangePage(page));
    },
    depositPage: async ({ page }, use) => {
        await use(new DepositPage(page));
    },
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    },
    walletPopupPage: async ({ page }, use) => {
        await use(new WalletPopupPage(page));
    },
    testDappPage: async ({ page }, use) => {
        await use(new TestDappPage(page));
    },
    paymentsPage: async ({ page }, use) => {
        await use(new PaymentsPage(page));
    },
});

export { expect } from "@playwright/test";

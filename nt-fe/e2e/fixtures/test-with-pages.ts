/**
 * Playwright fixture wiring for the Page Object Model. Specs import `test`/
 * `expect` from here instead of `@playwright/test` directly, and get POM
 * instances injected the same way `page`/`context` are — no manual
 * `new DashboardPage(page)` boilerplate per test.
 */
import { test as base } from "@playwright/test";
import { CustomTemplatesPage } from "../pages/custom-templates.page";
import { DashboardPage } from "../pages/dashboard.page";
import { RequestsPage } from "../pages/requests.page";
import { StartPage } from "../pages/start.page";

interface PageObjectFixtures {
    dashboardPage: DashboardPage;
    requestsPage: RequestsPage;
    startPage: StartPage;
    customTemplatesPage: CustomTemplatesPage;
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
});

export { expect } from "@playwright/test";

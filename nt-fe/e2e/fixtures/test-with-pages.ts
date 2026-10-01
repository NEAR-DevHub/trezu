/**
 * Playwright fixture wiring for the Page Object Model. Specs import `test`/
 * `expect` from here instead of `@playwright/test` directly, and get POM
 * instances injected the same way `page`/`context` are — no manual
 * `new RequestsPage(page)` boilerplate per test.
 */
import { test as base } from "@playwright/test";
import { RequestsPage } from "../pages/requests.page";

interface PageObjectFixtures {
    requestsPage: RequestsPage;
}

export const test = base.extend<PageObjectFixtures>({
    requestsPage: async ({ page }, use) => {
        await use(new RequestsPage(page));
    },
});

export { expect } from "@playwright/test";

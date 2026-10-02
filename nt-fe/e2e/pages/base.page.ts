import type { Locator, Page } from "@playwright/test";

export class BasePage {
    constructor(protected readonly page: Page) {}

    /** Scopes queries to the main content area, avoiding accidental matches in the sidebar nav. */
    get main(): Locator {
        return this.page.locator("main");
    }

    async screenshot(name: string): Promise<void> {
        await this.page.screenshot({
            path: `test-results/${name}.png`,
            fullPage: true,
        });
    }
}

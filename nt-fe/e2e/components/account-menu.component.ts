import type { Page } from "@playwright/test";

/**
 * The header account popover (components/sign-in.tsx): opened by clicking the
 * connected account, holds the Log Out button.
 */
export class AccountMenuComponent {
    constructor(private readonly page: Page) {}

    trigger(accountId: string) {
        return this.page.getByText(accountId, { exact: false }).first();
    }

    logOutButton() {
        return this.page.getByRole("button", { name: /log out/i });
    }

    async logOut(accountId: string): Promise<void> {
        await this.trigger(accountId).click();
        await this.logOutButton().click();
    }
}

import type { Page } from "@playwright/test";

/**
 * The header account popover (components/sign-in.tsx): opened by clicking the
 * connected account, holds the Log Out button.
 */
export class AccountMenuComponent {
    constructor(private readonly page: Page) {}

    /**
     * The popover trigger button. On mobile it shows only an avatar, but the
     * account id text stays in its DOM (hidden), so match on that.
     */
    trigger(accountId: string) {
        return this.page
            .getByRole("button")
            .filter({ has: this.page.getByText(accountId, { exact: false }) })
            .filter({ visible: true })
            .first();
    }

    logOutButton() {
        return this.page.getByRole("button", { name: /log out/i });
    }

    async logOut(accountId: string): Promise<void> {
        await this.trigger(accountId).click();
        await this.logOutButton().click();
    }
}

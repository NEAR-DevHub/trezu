import type { Page } from "@playwright/test";

/**
 * The signed-in account menu: the header SignIn popover on desktop or the
 * sidebar profile menu. Opened by clicking the connected account id.
 */
export class AccountMenuComponent {
    constructor(
        private readonly page: Page,
        private readonly accountId: string,
    ) {}

    trigger() {
        return this.page.getByText(this.accountId, { exact: false }).first();
    }

    signOutButton() {
        return this.page.getByRole("button", {
            name: /log out|sign out|disconnect/i,
        });
    }

    async signOut(): Promise<void> {
        await this.trigger().click();
        await this.signOutButton().click();
    }
}

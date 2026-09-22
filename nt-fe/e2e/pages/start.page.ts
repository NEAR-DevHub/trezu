import { expect } from "@playwright/test";
import { waitForResponseIncludes } from "../helpers/wait-for-response";
import { BasePage } from "./base.page";

export class StartPage extends BasePage {
    async gotoCreate(): Promise<void> {
        await this.page.goto("/create");
    }

    /** Navigate to `/` and wait for the bootstrap auth/treasuries calls the app fires on load. */
    async gotoAndWaitForBootstrap(): Promise<void> {
        const authResp = waitForResponseIncludes(this.page, "/auth/me");
        const treasuriesResp = waitForResponseIncludes(
            this.page,
            "/user/treasuries",
        );
        await this.page.goto("/");
        await Promise.all([authResp, treasuriesResp]);
    }

    createTreasuryHeading() {
        return this.page.getByRole("heading", { name: /create treasury/i });
    }

    continueToWalletButton() {
        return this.page.getByRole("button", { name: /continue to wallet/i });
    }

    createTreasuryButton() {
        return this.page.getByRole("button", { name: /create treasury/i });
    }

    publicTypeRadio() {
        return this.page.getByRole("radio", { name: "Public" });
    }

    treasuryNameInput() {
        return this.page.getByRole("textbox", { name: "My Treasury" });
    }

    giveUsTimeHeading() {
        return this.page.getByRole("heading", {
            name: /give us a little time/i,
        });
    }

    notifyMeButton() {
        return this.page.getByRole("button", { name: /notify me/i });
    }

    /**
     * Simulates the backend permanently rejecting treasury creation
     * (as opposed to a transient error) so the UI falls straight through to
     * the waitlist instead of spinning through its in-session recovery retries.
     */
    async mockTreasuryCreationDisabled(): Promise<void> {
        await this.page.route(
            "**/api/treasury/check-handle-unused**",
            async (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ unused: true }),
                }),
        );
        await this.page.route("**/api/treasury/create-stream", async (route) =>
            route.fulfill({
                status: 200,
                headers: { "content-type": "text/event-stream" },
                body: `data: {"step":"error","status":"error","message":"Treasury creation disabled"}\n\n`,
            }),
        );
    }

    /** Fills and submits the create-treasury form on `/create` with the given handle. */
    async submitCreateTreasuryForm(handle: string): Promise<void> {
        const publicType = this.publicTypeRadio();
        await publicType.click();
        await expect(publicType).toBeChecked();

        await this.treasuryNameInput().fill(handle);

        const createButton = this.createTreasuryButton();
        await expect(createButton).toBeEnabled();
        await createButton.click();
    }
}

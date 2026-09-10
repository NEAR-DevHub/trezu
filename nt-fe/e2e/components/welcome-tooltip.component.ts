import { expect, type Page } from "@playwright/test";

/** The 2-step "Your treasury is ready" / "Take a quick tour" tooltip shown to new users. */
export class WelcomeTooltipComponent {
    constructor(private readonly page: Page) {}

    step1Text() {
        return this.page.getByText("Your treasury is ready", {
            exact: false,
        });
    }

    step1DetailText() {
        return this.page.getByText("Deposit funds, send payments", {
            exact: false,
        });
    }

    step2Text() {
        return this.page.getByText("Take a quick tour", { exact: false });
    }

    stepIndicator(current: number, total: number) {
        return this.page.getByText(`${current} of ${total}`);
    }

    gotItButton() {
        return this.page.getByRole("button", { name: "Got it", exact: true });
    }

    letsGoButton() {
        return this.page.getByRole("button", {
            name: "Let's go",
            exact: true,
        });
    }

    noThanksButton() {
        return this.page.getByRole("button", { name: /no, thanks/i });
    }

    async dismissWithGotIt(): Promise<void> {
        await this.gotItButton().click();
    }

    async dismissWithNoThanks(): Promise<void> {
        await this.step2Text().waitFor();
        await this.noThanksButton().click();
    }

    /** Walks step 1 -> step 2 and clicks "Let's go" to kick off the dashboard tour. */
    async startTour(): Promise<void> {
        await expect(this.step1Text()).toBeVisible({ timeout: 15000 });
        await this.dismissWithGotIt();
        await expect(this.step2Text()).toBeVisible({ timeout: 5000 });
        await this.letsGoButton().click();
    }
}

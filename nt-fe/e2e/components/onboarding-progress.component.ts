import type { Page } from "@playwright/test";

/** The "Set up your treasury" dashboard checklist widget (deposit/send/add-member steps). */
export class OnboardingProgressComponent {
    constructor(private readonly page: Page) {}

    get heading() {
        return this.page.locator("main").getByText(/set up your treasury/i);
    }

    /**
     * Scopes to the widget's own container so its Deposit/Send buttons
     * aren't confused with the visually identical ones inside
     * BalanceWithGraph on the same page.
     */
    private get container() {
        return this.heading.locator("../..");
    }

    depositButton() {
        return this.container.getByRole("button", { name: /deposit/i });
    }

    sendButton() {
        return this.container.getByRole("button", { name: /^send$/i });
    }

    addTeamMemberStepText() {
        return this.page.locator("main").getByText("Add a team member");
    }

    addFirstAssetsStepText() {
        return this.page.locator("main").getByText("Add your first assets");
    }

    createFirstPaymentRequestStepText() {
        return this.page
            .locator("main")
            .getByText("Create a first payment request");
    }
}

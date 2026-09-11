import type { Page } from "@playwright/test";

/** The "Congrats! You completed your Treasury setup" tooltip shown after the tour + first steps finish. */
export class CongratsTooltipComponent {
    constructor(private readonly page: Page) {}

    heading() {
        return this.page.getByText("Congrats!", { exact: false });
    }

    body() {
        return this.page.getByText("completed your Treasury setup", {
            exact: false,
        });
    }

    letsGoButton() {
        return this.page.getByRole("button", { name: /let's go/i });
    }

    async dismiss(): Promise<void> {
        await this.letsGoButton().click();
    }
}

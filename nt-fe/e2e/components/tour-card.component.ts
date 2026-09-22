import type { Page } from "@playwright/test";

/**
 * The floating tour-step card (nextstepjs). Its container is only reachable
 * via a Tailwind utility-class selector (`.bg-popover-foreground.text-popover`)
 * because it carries no test id — previously that fragile selector was
 * hand-copied 4x across onboarding-tour.spec.ts. Now it lives in exactly one
 * place: if the underlying markup/classes ever change, this is the only line
 * to fix.
 */
export class TourCardComponent {
    constructor(private readonly page: Page) {}

    get container() {
        return this.page.locator(".bg-popover-foreground.text-popover");
    }

    stepText(text: string | RegExp) {
        return this.page.getByText(text, { exact: false });
    }

    stepIndicator(current: number, total: number) {
        return this.page.getByText(`${current} of ${total}`);
    }

    nextButton() {
        return this.page.getByRole("button", { name: "Next", exact: true });
    }

    closeButton() {
        return this.container.getByRole("button", { name: /close/i });
    }

    doneButton() {
        return this.container.getByText("Done", { exact: true });
    }

    async goNext(): Promise<void> {
        await this.nextButton().click();
    }

    async close(): Promise<void> {
        await this.closeButton().click();
    }

    /** Clicks "Done" on the final step, scoped to the card so the Radix Select portal from the treasury dropdown can't intercept the click. */
    async complete(): Promise<void> {
        await this.doneButton().click();
    }

    async boundingBox() {
        return this.container.boundingBox();
    }
}

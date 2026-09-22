import { BasePage } from "./base.page";

/** The single-payment creation wizard (`/[treasuryId]/payments`) — a two-step form: recipient/amount entry, then a review step before submit. */
export class PaymentsPage extends BasePage {
    async goto(
        treasuryId: string,
        params?: Record<string, string>,
    ): Promise<void> {
        const query = params
            ? `?${new URLSearchParams(params).toString()}`
            : "";
        await this.page.goto(`/${treasuryId}/payments${query}`);
    }

    amountInput() {
        return this.page.locator('input[inputmode="decimal"]');
    }

    recipientInput() {
        return this.page.getByPlaceholder(/recipient address/i);
    }

    /** The step-1 submit button — same element throughout, its accessible name changes with form validity ("Review Payment" / "Enter amount and address" / "Use a different address"). */
    reviewButton() {
        return this.page.getByRole("button", {
            name: /review payment|enter amount and address|use a different address/i,
        });
    }

    reviewHeading() {
        return this.page.getByText("Review Your Payment");
    }

    /** StepWizard only renders the header's back arrow once past step 1 — unambiguous on the review step. */
    backButton() {
        return this.page.getByRole("button", { name: "Back" });
    }

    /** Any text on the current step (recipient address, amount, symbol, …) — matches the first occurrence. */
    stepText(text: string | RegExp, options?: { exact?: boolean }) {
        return this.page.getByText(text, options).first();
    }
}

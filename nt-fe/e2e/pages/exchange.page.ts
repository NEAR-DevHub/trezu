import { BasePage } from "./base.page";

export class ExchangePage extends BasePage {
    async goto(treasuryId: string): Promise<void> {
        await this.page.goto(`/${treasuryId}/exchange`);
    }

    /** The sell/receive amount fields — always exactly two on the exchange form. */
    amountInputs() {
        return this.page.locator('input[inputmode="decimal"]');
    }

    reviewExchangeButton() {
        return this.page.getByRole("button", { name: /^Review Exchange$/i });
    }

    /** The receive-amount line on the review step, e.g. "5,000 ETH". */
    reviewedAmountText(text: string) {
        return this.page.getByText(text, { exact: true });
    }
}

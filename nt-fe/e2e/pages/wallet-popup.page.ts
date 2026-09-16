import { BasePage } from "./base.page";

/**
 * The standalone `/wallet` popup page external dApps open for `sign_in` /
 * `sign_transactions`. It has no nav chrome of its own — every state is a
 * step rendered in place, addressed here by its distinguishing text/button.
 */
export class WalletPopupPage extends BasePage {
    async goto(params: Record<string, string>): Promise<void> {
        const query = new URLSearchParams(params).toString();
        await this.page.goto(`/wallet?${query}`);
    }

    connectWalletButton() {
        return this.page.getByRole("button", { name: "Connect Wallet" });
    }

    parseErrorText() {
        return this.page.getByText("Failed to parse the transaction request");
    }

    tryAgainButton() {
        return this.page.getByRole("button", { name: "Try again" });
    }

    whatToDoNextText() {
        return this.page.getByText("What To Do Next");
    }

    /** The checklist's link to a specific DAO proposal, e.g. "treasury.sputnik-dao.near — Proposal #42". */
    proposalLinkText(daoId: string, proposalId: number) {
        return this.page.getByText(`${daoId} — Proposal #${proposalId}`);
    }

    openTrezuToApproveButton() {
        return this.page.getByRole("button", { name: "Open Trezu to Approve" });
    }

    doneText() {
        return this.page.getByText("You can close this window.");
    }

    notYetIndexedText() {
        return this.page.getByText(/not yet indexed/);
    }

    rejectedText(proposalId: number) {
        return this.page.getByText(`Proposal #${proposalId} was rejected`);
    }

    chooseTreasuryText() {
        return this.page.getByText("Choose which treasury you want to use");
    }

    /** A treasury row in the sign_in picker — a real `<button>` whose accessible name contains the daoId and/or display name. */
    treasuryRow(text: string) {
        return this.page.getByRole("button", { name: text });
    }

    treasuryConnectedText() {
        return this.page.getByText("Treasury connected");
    }

    /** The confirm-transactions step's heading, shown once the popup auto-selects a signer DAO. */
    createProposalHeading() {
        return this.page.getByText("Create Proposal");
    }

    /** Any text in the proposal preview (recipient, acting-as DAO, …) — matches the first occurrence, same as the original `text=` locators. */
    previewText(text: string) {
        return this.page.getByText(text).first();
    }

    /** Messages the page has posted to `window.opener` (captured via an init script mock). */
    async capturedMessages(): Promise<unknown[]> {
        return this.page.evaluate(() => (window as any).__walletMessages);
    }
}

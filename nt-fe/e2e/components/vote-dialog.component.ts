import type { Page } from "@playwright/test";

/**
 * The "Confirm your vote" dialog (features/proposals/components/vote-modal.tsx)
 * opened by Approve / Reject on a request.
 */
export class VoteDialogComponent {
    constructor(private readonly page: Page) {}

    get root() {
        return this.page.getByRole("dialog", { name: "Confirm your vote" });
    }

    confirmButton() {
        return this.root.getByRole("button", { name: "Confirm", exact: true });
    }

    /** The confirm button while the wallet is preparing the vote. */
    preparingButton() {
        return this.root.getByRole("button", { name: "Preparing your vote" });
    }
}

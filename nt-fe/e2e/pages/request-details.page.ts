import { BasePage } from "./base.page";

/** A single request at `/{treasuryId}/requests/{proposalId}`. */
export class RequestDetailsPage extends BasePage {
    /** Opens the request and waits for its proposal to load. */
    async goto(treasuryId: string, proposalId: number): Promise<void> {
        const proposalResp = this.page.waitForResponse((r) =>
            r.url().includes(`/api/proposal/${treasuryId}/${proposalId}`),
        );
        await this.page.goto(`/${treasuryId}/requests/${proposalId}`);
        await proposalResp;
    }

    /** The request's own Approve / Reject action. */
    voteButton(vote: "Approve" | "Reject") {
        return this.main.getByRole("button", { name: vote, exact: true });
    }
}

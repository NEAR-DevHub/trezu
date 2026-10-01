import { waitForResponseIncludes } from "../helpers/wait-for-response";
import { BasePage } from "./base.page";

export class RequestsPage extends BasePage {
    async goto(treasuryId: string): Promise<void> {
        const authResp = waitForResponseIncludes(this.page, "/auth/me");
        const proposalsResp = waitForResponseIncludes(this.page, "/proposals/");
        await this.page.goto(`/${treasuryId}/requests`);
        await authResp;
        await proposalsResp;
    }

    /** Requests list on a given tab (`All`, `InProgress`, `Approved`, …), optionally with filter params (e.g. `my_vote`). */
    async gotoWithParams(
        treasuryId: string,
        params: Record<string, string>,
    ): Promise<void> {
        const authResp = waitForResponseIncludes(this.page, "/auth/me");
        const proposalsResp = waitForResponseIncludes(this.page, "/proposals/");
        await this.page.goto(
            `/${treasuryId}/requests?${new URLSearchParams(params).toString()}`,
        );
        await authResp;
        await proposalsResp;
    }

    /** Toolbar button that expands/collapses the filter panel ("Filters" / "Filters (2)"). */
    filterToggle() {
        return this.page.getByRole("button", {
            name: /^filters( \(\d+\))?$/i,
        });
    }

    addFilterButton() {
        return this.page.getByRole("button", { name: "Add filter" });
    }

    /** An entry in the "Add filter" popover, e.g. "My vote status". */
    addFilterOption(label: string) {
        return this.page.getByRole("button", { name: label, exact: true });
    }

    /** The active filter pill, e.g. "My vote status: Approved, No voted". Clicking it reopens its popover. */
    filterPill(label: string) {
        return this.page.getByRole("button", { name: new RegExp(`^${label}`) });
    }

    /**
     * An option inside the open checkbox filter popover (e.g. "No voted").
     * Targets the option text inside its <label>, so clicking toggles the
     * checkbox; scoped to the popover because the same words also appear
     * in tabs and status pills.
     */
    filterCheckbox(label: string) {
        return this.page.getByRole("dialog").getByText(label, { exact: true });
    }

    /** Table row for a proposal, matched on its "#<id>" cell. */
    proposalRow(proposalId: number) {
        return this.main
            .getByRole("row")
            .filter({ hasText: new RegExp(`#${proposalId}(?!\\d)`) });
    }
}

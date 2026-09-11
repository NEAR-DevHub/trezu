import { BasePage } from "./base.page";

export class CustomTemplatesPage extends BasePage {
    async gotoCreate(treasuryId: string): Promise<void> {
        await this.page.goto(`/${treasuryId}/custom-templates/create`);
    }

    async gotoList(treasuryId: string): Promise<void> {
        await this.page.goto(`/${treasuryId}/custom-templates`);
    }

    async gotoFill(treasuryId: string, slug: string): Promise<void> {
        await this.page.goto(`/${treasuryId}/custom-templates/${slug}`);
    }

    newTemplateHeading() {
        return this.page.getByRole("heading", { name: "New Template" });
    }

    createSubmitButton() {
        return this.page.getByRole("button", { name: "Create Template" });
    }

    codeTab() {
        return this.page.getByRole("tab", { name: "Code" });
    }

    codeTextarea() {
        return this.page.locator("textarea");
    }

    /** Addressed by aria-label — its placeholder "Set Greeting" collides with the manifest
     * textarea's example and the Visual builder's Title field. */
    nameInput() {
        return this.page.getByRole("textbox", { name: "Name", exact: true });
    }

    /** The "<Field> is required" message shown once a required field is touched. */
    fieldRequiredError(fieldName: string) {
        return this.page.getByText(`${fieldName} is required`);
    }

    codeErrorListFirstItem() {
        return this.page.locator("ul.text-destructive li").first();
    }

    visualReceiverInput() {
        return this.page.getByPlaceholder("guestbook.near");
    }

    templateActionsButton() {
        return this.page.getByRole("button", { name: "Template actions" });
    }

    pinMenuItem() {
        return this.page.getByRole("menuitem", { name: /pin to the sidebar/i });
    }

    unpinMenuItem() {
        return this.page.getByRole("menuitem", { name: /unpin template/i });
    }

    editMenuItem() {
        return this.page.getByRole("menuitem", { name: "Edit", exact: true });
    }

    deleteMenuItem() {
        return this.page.getByRole("menuitem", { name: "Delete", exact: true });
    }

    /** The template's row/list entry, matched by its name. */
    templateRowText(name: string) {
        return this.page.getByText(name);
    }

    fillHeading(name: string) {
        return this.page.getByRole("heading", { name });
    }

    fieldLabel(text: string) {
        return this.page.getByText(text, { exact: true });
    }

    fileProposalButton() {
        return this.page.getByRole("button", { name: "File Proposal" });
    }

    createRequestButton() {
        return this.page.getByRole("button", { name: "Create Request" });
    }

    addNewButton() {
        return this.page.getByRole("button", { name: "Add New" });
    }
}

import { expect } from "@playwright/test";
import { BasePage } from "./base.page";

/** The dashboard's deposit page (`/dashboard/deposit`): asset/network selectors and the receive card. */
export class DepositPage extends BasePage {
    heading() {
        return this.page.getByText("Deposit", { exact: true });
    }

    publicWalletSource() {
        return this.page.getByTestId("deposit-source-public_wallet");
    }

    confidentialUserSource() {
        return this.page.getByTestId("deposit-source-confidential_user");
    }

    selectPrompt() {
        return this.page.getByText(
            "Select asset and network to see deposit address",
        );
    }

    assetSelectorButton() {
        return this.page.getByTestId("deposit-asset-selector");
    }

    selectAssetHeading() {
        return this.page.getByRole("heading", { name: "Select Asset" });
    }

    assetOption(name: string | RegExp) {
        return this.page.getByRole("button", { name });
    }

    networkSelectorButton() {
        return this.page.getByTestId("deposit-network-selector");
    }

    selectNetworkHeading() {
        return this.page.getByRole("heading", { name: "Select Network" });
    }

    networkOption(name: string) {
        return this.page.getByRole("button", { name });
    }

    reusableNoticeText() {
        return this.page.getByText(/Doesn't expire/i).first();
    }

    /** The rendered deposit address — always the first `<code>` on the page, public or confidential. */
    addressCode() {
        return this.page.locator("code").first();
    }

    backButton() {
        return this.page.getByTestId("deposit-back-button");
    }

    confidentialOriginTrezu() {
        return this.page.getByTestId("deposit-origin-trezu");
    }

    confidentialOriginNearcom() {
        return this.page.getByTestId("deposit-origin-nearcom");
    }

    /** The QR code rendered next to the confidential deposit address — no test id, so matched generically. */
    qrCodeIcon() {
        return this.page.locator("svg").first();
    }

    /** The dark receive card shown for reusable confidential addresses. */
    receiveCard() {
        return this.page.getByTestId("deposit-receive-card");
    }

    /** The address inside the receive card. */
    receiveAddress() {
        return this.page.getByTestId("deposit-receive-address");
    }

    /** The styled QR drawing inside the receive card (an `<svg>` once drawn). */
    receiveQrCode() {
        return this.receiveCard().getByTestId("qr-code").locator("svg");
    }

    /** Opens the asset picker and selects the given option. */
    async selectAsset(name: string | RegExp): Promise<void> {
        await this.assetSelectorButton().click();
        await expect(this.selectAssetHeading()).toBeVisible({
            timeout: 10_000,
        });
        await this.assetOption(name).first().click();
        await this.waitForDialogToClose();
    }

    /** Opens the network picker and selects the given option. */
    async selectNetwork(name: string): Promise<void> {
        await this.networkSelectorButton().click();
        await expect(this.selectNetworkHeading()).toBeVisible({
            timeout: 10_000,
        });
        await this.networkOption(name).first().click();
        await this.waitForDialogToClose();
    }

    /**
     * Wait for the selector sheet to fully detach after picking an option.
     *
     * Radix marks the dialog `data-state="closed"` before its exit animation
     * finishes, and the still-mounted overlay/content can intercept pointer
     * events (or leave the next target detached mid-remount) for that
     * ~200ms window. Waiting for full detachment avoids racing a click right
     * after selection into that window.
     */
    private async waitForDialogToClose(): Promise<void> {
        // Scoped to our Radix dialog wrapper's own data-slot, not the bare
        // role="dialog" selector — that also matches the Gleap AI-assistant
        // widget, which sits permanently hidden in the DOM and never
        // detaches, hanging this wait forever.
        await this.page
            .locator('[data-slot="dialog-content"]')
            .first()
            .waitFor({ state: "detached", timeout: 10_000 });
    }
}

import { expect } from "@playwright/test";
import { BasePage } from "./base.page";

/** The dashboard's deposit page (`/dashboard/deposit`) — source-card picker, asset/network selectors, and the acknowledgement gate shared by every source's address-reveal step. */
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

    ackCheckbox() {
        return this.page.getByTestId("deposit-ack-checkbox");
    }

    ackCta() {
        return this.page.getByTestId("deposit-ack-cta");
    }

    oneTimeAddressText() {
        return this.page.getByText(/One-time deposit address/i).first();
    }

    /** The rendered deposit address — always the first `<code>` on the page, public or confidential. */
    addressCode() {
        return this.page.locator("code").first();
    }

    expiresInText() {
        return this.page.getByText(/Expires in/i);
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

    /** Opens the asset picker and selects the given option. */
    async selectAsset(name: string | RegExp): Promise<void> {
        await this.assetSelectorButton().click();
        await expect(this.selectAssetHeading()).toBeVisible({
            timeout: 10_000,
        });
        await this.assetOption(name).first().click();
    }

    /** Opens the network picker and selects the given option. */
    async selectNetwork(name: string): Promise<void> {
        await this.networkSelectorButton().click();
        await expect(this.selectNetworkHeading()).toBeVisible({
            timeout: 10_000,
        });
        await this.networkOption(name).first().click();
    }

    /** Ticks the acknowledgement checkbox and clicks the CTA once it enables — shared by the public-wallet "Generate Address" and confidential "Show address" sub-flows. */
    async acknowledgeAndContinue(): Promise<void> {
        await expect(this.ackCheckbox()).toBeVisible({ timeout: 10_000 });
        const cta = this.ackCta();
        await expect(cta).toBeDisabled();
        await this.ackCheckbox().click();
        await expect(cta).toBeEnabled();
        await cta.click();
    }
}

import type { FrameLocator } from "@playwright/test";
import { BasePage } from "./base.page";

/** The wallet sign-in flow: wallet picker → sandboxed executor iframe. Shared by every wallet-specific login spec (Ledger, Passkey, …). Navigate to the onboarding entry point via `StartPage.gotoCreate()` first. */
export class LoginPage extends BasePage {
    signInButton() {
        return this.page.getByRole("button", { name: /sign in/i });
    }

    chooseSignInText() {
        return this.page.getByText("Choose how to sign in");
    }

    /** A wallet option in the picker, e.g. "Ledger" or "Passkey". */
    walletOption(name: string) {
        return this.page.getByRole("button", { name });
    }

    /** The wallet executor UI, which always renders inside a sandboxed iframe. */
    executorFrame(): FrameLocator {
        return this.page
            .frameLocator('iframe[sandbox*="allow-scripts"]')
            .first();
    }

    async openWalletPicker(): Promise<void> {
        await this.signInButton().click();
    }
}

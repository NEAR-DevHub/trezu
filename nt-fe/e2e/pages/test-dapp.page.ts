import { BasePage } from "./base.page";

/** The dummy external dApp (`e2e/test-dapp.html`) used to drive the Trezu Wallet popup via postMessage, simulating a real near-connect integration. */
export class TestDappPage extends BasePage {
    async goto(): Promise<void> {
        await this.page.goto("/test-dapp.html");
    }

    connectButton() {
        return this.page.locator("#connect-btn");
    }

    transferButton() {
        return this.page.locator("#transfer-btn");
    }

    ftCallButton() {
        return this.page.locator("#ftcall-btn");
    }

    statusText() {
        return this.page.locator("#status");
    }

    /** Waits for the wallet popup's `trezu:result` postMessage to land on `window.__lastMessage`. */
    async waitForLastMessage(timeout = 5_000): Promise<unknown> {
        const handle = await this.page.waitForFunction(
            () => (window as any).__lastMessage,
            { timeout },
        );
        return handle.jsonValue();
    }

    async lastMessage(): Promise<unknown> {
        return this.page.evaluate(() => (window as any).__lastMessage);
    }

    /** Opens the wallet popup directly at the waiting-approval step (skipping the signing step) via `window.open`, so `window.opener` is set the same way a real near-connect integration would set it. */
    async openWalletPopupForApproval(
        daoId: string,
        proposalId: number,
    ): Promise<void> {
        await this.page.evaluate(
            ({ daoId, proposalId }) => {
                const url = new URL("/wallet", window.location.origin);
                url.searchParams.set("action", "sign_transactions");
                url.searchParams.set("network", "mainnet");
                url.searchParams.set("daoId", daoId);
                url.searchParams.set("proposalIds", String(proposalId));
                window.open(
                    url.toString(),
                    "TrezuWallet",
                    "width=520,height=700",
                );
            },
            { daoId, proposalId },
        );
    }

    /** Sets the dApp's connected-DAO state directly, skipping a real sign_in round trip. */
    async simulateConnected(daoId: string): Promise<void> {
        await this.page.evaluate((dao) => {
            (window as any).connectedAs = dao;
            const btns = ["transfer-btn", "ftcall-btn"];
            for (const id of btns) {
                const el = document.getElementById(id) as HTMLButtonElement | null;
                if (el) el.disabled = false;
            }
            const status = document.getElementById("status");
            if (status) status.textContent = "Status: Connected as " + dao;
        }, daoId);
    }
}

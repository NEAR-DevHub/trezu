import type { Page } from "@playwright/test";

/**
 * The @hot-labs/near-connect wallet popup. near-connect mounts each popup root
 * on document.body as `.hot-connector-popup` with `display: none` and only
 * shows it once the wallet has something on screen, so a mounted root is not
 * necessarily a visible one. It carries no role or test id; the class is the
 * only handle (components/modal.tsx keys off the same class).
 */
export class WalletConnectorPopupComponent {
    constructor(private readonly page: Page) {}

    /** Every popup root near-connect has mounted, hidden or shown. */
    get roots() {
        return this.page.locator(".hot-connector-popup");
    }

    /** Only the popup roots currently on screen. */
    get shown() {
        return this.roots.filter({ visible: true });
    }

    /** The Ledger executor's screen asking to reconnect the device. */
    ledgerReconnectScreen() {
        return this.page
            .frameLocator(".hot-connector-popup iframe")
            .getByText("Reconnect Ledger");
    }
}

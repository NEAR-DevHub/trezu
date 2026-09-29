/**
 * Drives the real near-connect Ledger executor without a device.
 *
 * near-connect namespaces an executor's own storage as `<walletId>:<key>` in
 * the page's localStorage, so a Ledger sign-in can be seeded from the page
 * side. Signing then starts with the executor's silent WebUSB reconnect
 * (`navigator.usb.getDevices()`), which `stubLedgerDevice` controls.
 */
import type { Page } from "@playwright/test";

// Sandbox genesis key for test.near, same as ledger-login.spec.ts.
export const LEDGER_TEST_PUBLIC_KEY =
    "ed25519:5BGSaf6YjVm7565VzWQHNxoyEjwr3jUpRJSGjREvU9dB";

/**
 * Signs `accountId` in with the Ledger wallet over WebHID, with no transport
 * open yet: near-connect's selected wallet, Trezu's forced direct-trigger
 * target (so the connector is built with Ledger included), and the executor's
 * stored accounts and transport mode. Call before navigation.
 */
export async function seedLedgerSession(
    page: Page,
    accountId: string,
    publicKey: string = LEDGER_TEST_PUBLIC_KEY,
) {
    await page.addInitScript(
        ({ accountId, publicKey }) => {
            // Init scripts also run in the executor's sandboxed iframe, which
            // has no localStorage of its own to seed.
            try {
                localStorage.setItem("selected-wallet", "ledger");
                localStorage.setItem("trezu:target-wallet", "ledger");
                localStorage.setItem(
                    "ledger:ledger:accounts",
                    JSON.stringify([{ accountId, publicKey }]),
                );
                localStorage.setItem("ledger:ledger:transportMode", "WebHID");
            } catch {}
        },
        { accountId, publicKey },
    );
}

/**
 * Fakes a Ledger that takes `wakeMs` to answer the silent reconnect and then
 * turns out not to be there, so the executor falls back to its "Reconnect
 * Ledger" screen. Runs in every frame, including the executor's iframe, where
 * the lookup happens. Call before navigation.
 */
export async function stubLedgerDevice(page: Page, wakeMs: number) {
    await page.addInitScript((wakeMs) => {
        Object.defineProperty(navigator, "usb", {
            configurable: true,
            value: {
                getDevices: () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve([]), wakeMs),
                    ),
                requestDevice: () =>
                    Promise.reject(
                        new DOMException(
                            "No device selected.",
                            "NotFoundError",
                        ),
                    ),
                addEventListener: () => {},
                removeEventListener: () => {},
            },
        });
    }, wakeMs);
}

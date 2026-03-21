/**
 * Test the confidential shield page with mock wallet connection.
 *
 * Uses the same mock wallet pattern from nt-fe/e2e/trezu-wallet-integration.spec.ts
 * to simulate petersalomonsendev.near being connected.
 */
import { test, expect, Page, BrowserContext, Route } from "@playwright/test";

const DAO_ID = "petersalomonsendev.sputnik-dao.near";
const ACCOUNT_ID = "petersalomonsendev.near";
const BASE_URL = "http://localhost:3000";

// ---- Mock wallet (same as nt-fe/e2e/helpers/mock-wallet.ts) ----

const MOCK_MANIFEST_ID = "mock-wallet";

const MOCK_WALLET_EXECUTOR_JS = `(function() {
  window.selector.ready({
    async signIn({ network }) {
      const a = window.sandboxedLocalStorage.getItem('signedAccountId') || '';
      return a ? [{ accountId: a, publicKey: '' }] : [];
    },
    async signOut() {
      window.sandboxedLocalStorage.removeItem('signedAccountId');
    },
    async getAccounts({ network }) {
      const a = window.sandboxedLocalStorage.getItem('signedAccountId');
      if (!a) return [];
      return [{ accountId: a, publicKey: '' }];
    },
    async verifyOwner() { throw new Error('Not supported'); },
    async signMessage()  { throw new Error('Not supported'); },
    async signAndSendTransaction(p)  { return {}; },
    async signAndSendTransactions(p) { return []; },
  });
})();`;

const MOCK_MANIFEST = {
    wallets: [
        {
            id: MOCK_MANIFEST_ID,
            name: "Mock Wallet",
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
            website: "https://example.com",
            description: "Mock wallet for testing",
            version: "1.0.0",
            type: "sandbox",
            executor: "/_near-connect-test/mock-wallet.js",
            features: {},
            permissions: { allowsOpen: false },
        },
    ],
};

// ---- Setup helpers ----

async function mockRoutes(context: BrowserContext) {
    // Mock NearConnect manifest
    for (const url of [
        "**/raw.githubusercontent.com/**manifest.json*",
        "**/cdn.jsdelivr.net/**manifest.json*",
    ]) {
        await context.route(url, async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(MOCK_MANIFEST),
            });
        });
    }

    // Mock wallet executor
    await context.route(
        "**/_near-connect-test/mock-wallet.js*",
        async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/javascript",
                body: MOCK_WALLET_EXECUTOR_JS,
            });
        },
    );

    // Mock auth endpoints
    await context.route("**/api/auth/me", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                accountId: ACCOUNT_ID,
                termsAccepted: true,
            }),
        });
    });

    await context.route("**/api/auth/challenge", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ nonce: "dGVzdC1ub25jZQ==" }),
        });
    });
}

async function seedWallet(page: Page) {
    await page.evaluate(
        ({ walletId, acct }) => {
            localStorage.setItem("selected-wallet", walletId);
            localStorage.setItem(`${walletId}:signedAccountId`, acct);
        },
        { walletId: MOCK_MANIFEST_ID, acct: ACCOUNT_ID },
    );
}

// ---- Test ----

test("confidential shield page - full flow", async ({ page, context }) => {
    test.setTimeout(120_000);

    // Log errors
    page.on("console", (msg) => {
        if (msg.type() === "error") {
            console.log(`[error] ${msg.text()}`);
        }
    });

    // Setup mocks
    await mockRoutes(context);

    // Navigate to a page first to set localStorage (same-origin)
    await page.goto(`${BASE_URL}/${DAO_ID}`);
    await seedWallet(page);

    // Now navigate to the confidential page
    console.log("Opening confidential page...");
    await page.goto(`${BASE_URL}/${DAO_ID}/confidential`);
    await page.waitForTimeout(3000);

    // Take initial screenshot
    await page.screenshot({ path: "fixtures/confidential-01-initial.png" });

    // Check button state
    const buttons = await page.locator("button").all();
    for (const btn of buttons) {
        const text = await btn.textContent();
        const disabled = await btn.isDisabled();
        if (text && text.trim().length > 2) {
            console.log(`Button: "${text.trim()}" disabled=${disabled}`);
        }
    }

    // Enter amount — TokenInput uses a regular input inside the card
    const amountInput = page.locator("input").first();
    if (await amountInput.isVisible()) {
        console.log("Entering amount: 0.1");
        await amountInput.click();
        await amountInput.fill("0.1");
        await page.waitForTimeout(2000);
    } else {
        console.log("No amount input found");
    }

    // Wait for quote
    console.log("Waiting for quote...");
    await page.waitForTimeout(3000);

    // Check for quote display
    const quoteVisible = await page
        .locator("text=You will receive")
        .isVisible();
    console.log(`Quote visible: ${quoteVisible}`);

    // Check Review button
    const reviewBtn = page.getByRole("button", {
        name: /Review Shield Request/i,
    });
    if (await reviewBtn.isVisible()) {
        const disabled = await reviewBtn.isDisabled();
        console.log(`Review button disabled: ${disabled}`);

        await page.screenshot({
            path: "fixtures/confidential-02-with-quote.png",
        });

        if (!disabled) {
            console.log("Clicking Review Shield Request...");
            await reviewBtn.click();
            await page.waitForTimeout(3000);

            await page.screenshot({
                path: "fixtures/confidential-03-review.png",
            });

            // Check submit button
            const submitBtn = page.getByRole("button", {
                name: /Confirm and Submit/i,
            });
            if (await submitBtn.isVisible()) {
                const submitDisabled = await submitBtn.isDisabled();
                console.log(`Submit button disabled: ${submitDisabled}`);
            }
        }
    }

    console.log("\nTest complete. Screenshots saved in fixtures/");
});

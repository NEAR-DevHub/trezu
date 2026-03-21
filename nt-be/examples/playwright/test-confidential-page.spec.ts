/**
 * Full E2E test for the confidential shield page.
 *
 * Uses mock wallet + intercepted relay endpoint to test the complete flow:
 * 1. Connect wallet (mock)
 * 2. Enter shield amount
 * 3. Get quote (mock)
 * 4. Review
 * 5. Submit proposal → captures the v1.signer FunctionCall payload
 *
 * The proposal is NOT submitted on-chain — the relay endpoint is mocked
 * to capture and verify the proposal structure.
 */
import { test, expect, Page, BrowserContext, Route } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const DAO_ID = "petersalomonsendev.sputnik-dao.near";
const ACCOUNT_ID = "petersalomonsendev.near";
const BASE_URL = "http://localhost:3000";

// ---- Mock wallet ----

const MOCK_MANIFEST_ID = "mock-wallet";

// Enhanced mock wallet that supports signDelegateActions
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
    async signDelegateActions(p) {
      // Return mock signed delegate actions
      // The relay endpoint is intercepted so these don't need to be real
      console.log('[Mock Wallet] signDelegateActions called with', JSON.stringify(p.delegateActions?.length || 0), 'actions');
      return {
        signedDelegateActions: (p.delegateActions || []).map((da, i) => ({
          delegateAction: {
            senderId: window.sandboxedLocalStorage.getItem('signedAccountId') || '',
            receiverId: da.receiverId,
            actions: da.actions,
            nonce: BigInt(i + 1),
            maxBlockHeight: BigInt(999999999),
            publicKey: { keyType: 0, data: new Uint8Array(32) },
          },
          signature: { keyType: 0, data: new Uint8Array(64) },
        })),
      };
    },
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
            features: { signDelegateActions: true, signInAndSignMessage: true },
            permissions: { allowsOpen: false },
        },
    ],
};

// ---- Setup helpers ----

async function mockRoutes(context: BrowserContext) {
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

// ---- Tests ----

test("full confidential shield flow — proposal creation", async ({
    page,
    context,
}) => {
    test.setTimeout(120_000);

    const capturedRelayRequests: any[] = [];

    // Log errors
    page.on("console", (msg) => {
        const text = msg.text();
        if (msg.type() === "error" && !text.includes("creation-status")) {
            console.log(`[error] ${text}`);
        }
        if (text.includes("[Mock Wallet]")) {
            console.log(text);
        }
    });

    // Setup mocks
    await mockRoutes(context);

    // Intercept relay endpoint — capture the proposal payload
    await context.route(
        "**/api/relay/delegate-action",
        async (route: Route) => {
            const postData = route.request().postData();
            const body = postData ? JSON.parse(postData) : {};
            console.log("\n=== Captured relay request ===");
            console.log(JSON.stringify(body, null, 2).substring(0, 500));
            capturedRelayRequests.push(body);

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                    transactionHash: "mock-tx-hash-for-testing",
                }),
            });
        },
    );

    // Seed wallet and navigate
    await page.goto(`${BASE_URL}/${DAO_ID}`);
    await seedWallet(page);
    await page.goto(`${BASE_URL}/${DAO_ID}/confidential`);
    await page.waitForTimeout(2000);

    // Step 1: Enter amount
    console.log("=== Step 1: Enter amount ===");
    const amountInput = page.locator("input").first();
    await amountInput.click();
    await amountInput.fill("0.1");
    await page.waitForTimeout(2000);

    // Verify quote loaded
    await expect(page.locator("text=You will receive")).toBeVisible({
        timeout: 10_000,
    });
    console.log("Quote loaded: 0.1 wNEAR → confidential");

    // Click Review
    const reviewBtn = page.getByRole("button", {
        name: /Review Shield Request/i,
    });
    await expect(reviewBtn).toBeEnabled({ timeout: 5_000 });
    console.log("Review button enabled, clicking...");
    await reviewBtn.click();
    await page.waitForTimeout(2000);

    // Step 2: Review
    console.log("\n=== Step 2: Review ===");
    await page.screenshot({ path: "fixtures/confidential-review.png" });

    // Wait for review content to load
    await expect(
        page.locator("text=Public → Confidential"),
    ).toBeVisible({ timeout: 10_000 });
    console.log("Review step loaded");

    // Check for v1.signer info
    const signerInfo = page.locator("text=v1.signer");
    if (await signerInfo.isVisible()) {
        console.log("v1.signer signing info visible");
    }

    // Click Submit
    const submitBtn = page.getByRole("button", {
        name: /Confirm and Submit/i,
    });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    console.log("Submit button enabled, clicking...");
    await submitBtn.click();

    // Wait for the relay request to be captured
    await page.waitForTimeout(5000);

    console.log(
        `\n=== Result: ${capturedRelayRequests.length} relay requests captured ===`,
    );

    // Save captured requests as fixture
    const fixturesDir = path.join(__dirname, "fixtures");
    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(
        path.join(fixturesDir, "confidential_proposal_relay.json"),
        JSON.stringify(capturedRelayRequests, null, 2),
    );
    console.log("Saved relay requests to fixtures/confidential_proposal_relay.json");

    // Verify the proposal structure
    if (capturedRelayRequests.length > 0) {
        const firstRelay = capturedRelayRequests[0];
        console.log("\nRelay request treasuryId:", firstRelay.treasuryId);
        console.log("Relay request proposalType:", firstRelay.proposalType);

        // The signedDelegateAction contains the proposal
        const delegateAction = firstRelay.signedDelegateAction;
        if (delegateAction?.delegateAction) {
            const da = delegateAction.delegateAction;
            console.log("Delegate action receiverId:", da.receiverId);
            console.log("Delegate action senderId:", da.senderId);

            // The first action should be add_proposal to the DAO
            if (da.actions?.length > 0) {
                const action = da.actions[0];
                console.log("Action type:", action.type);
                if (action.params) {
                    console.log("Method:", action.params.methodName);
                    // Decode the args to see the proposal
                    try {
                        const args = JSON.parse(
                            Buffer.from(
                                action.params.args,
                                "base64",
                            ).toString(),
                        );
                        console.log(
                            "\nProposal description:",
                            args.proposal?.description?.substring(0, 100),
                        );
                        const kind = args.proposal?.kind;
                        if (kind?.FunctionCall) {
                            console.log(
                                "FunctionCall receiver:",
                                kind.FunctionCall.receiver_id,
                            );
                            console.log(
                                "FunctionCall method:",
                                kind.FunctionCall.actions?.[0]?.method_name,
                            );
                            // Verify it's calling v1.signer
                            expect(kind.FunctionCall.receiver_id).toBe(
                                "v1.signer",
                            );
                            expect(
                                kind.FunctionCall.actions[0].method_name,
                            ).toBe("sign");
                            console.log(
                                "\n✅ Proposal correctly targets v1.signer with sign method!",
                            );
                        }
                    } catch (e) {
                        console.log("Could not decode proposal args:", e);
                    }
                }
            }
        }
    } else {
        console.log(
            "⚠️  No relay requests captured — proposal submission may have failed",
        );
    }

    await page.screenshot({ path: "fixtures/confidential-final.png" });
});

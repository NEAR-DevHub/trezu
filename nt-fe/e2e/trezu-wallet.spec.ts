import { test, expect, Page, Route } from "@playwright/test";

/**
 * E2E tests for the Trezu Wallet page (/wallet).
 *
 * The /wallet page is a standalone popup that external dApps open to:
 *   1. sign_in  — let the user pick a treasury to sign in as
 *   2. sign_transactions — convert dApp transactions into DAO proposals
 *
 * The page communicates results back to the opener via postMessage:
 *   { type: "trezu:result", status: "success"|"failure", ... }
 *
 * Testing strategy
 * ----------------
 * Most states can be reached directly via URL params without a real NEAR
 * wallet connection:
 *
 *  • connect step       — default when no daoId/proposalIds in URL
 *  • error step         — triggered by malformed `transactions` base64
 *  • waiting-approval   — restored from ?daoId=…&proposalIds=…
 *
 * Full wallet connection (sign_in → treasury list → done) requires the
 * NearConnector to emit a wallet:signIn event. We simulate this by injecting
 * localStorage ("trezu:signedAccountId") before page load and mocking the
 * backend's /api/user/treasuries endpoint.
 *
 * postMessage assertions use page.addInitScript to mock window.opener and
 * window.close before the page boots.
 */

/** Encode a value as the UTF-8-safe base64 format used by jsonToBase64() */
function jsonToBase64(value: unknown): string {
    const uint8Array = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
}

const DAO_ID = "treasury.sputnik-dao.near";

// ---------- connect step ----------

test.describe("connect step (sign_in)", () => {
    test("shows Connect Wallet button and Cancel", async ({ page }) => {
        await page.goto("/wallet?action=sign_in&network=mainnet");

        await expect(
            page.getByRole("button", { name: "Connect Wallet" }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(
            page.getByRole("button", { name: "Cancel" }),
        ).toBeVisible();
    });

    test("shows Connect Wallet button for sign_transactions before wallet connects", async ({
        page,
    }) => {
        const transactions = [
            {
                receiverId: "some.near",
                actions: [
                    {
                        type: "FunctionCall",
                        params: {
                            methodName: "transfer",
                            args: { receiver_id: "alice.near", amount: "1" },
                            gas: "100000000000000",
                            deposit: "0",
                        },
                    },
                ],
            },
        ];

        const url = `/wallet?action=sign_transactions&network=mainnet&transactions=${jsonToBase64(transactions)}`;
        await page.goto(url);

        await expect(
            page.getByRole("button", { name: "Connect Wallet" }),
        ).toBeVisible({ timeout: 10_000 });
    });
});

// ---------- error step ----------

test.describe("error step", () => {
    test("shows error for malformed transactions base64", async ({ page }) => {
        await page.goto(
            "/wallet?action=sign_transactions&network=mainnet&transactions=!!!not-valid-base64!!!",
        );

        await expect(
            page.getByText("Failed to parse the transaction request"),
        ).toBeVisible({ timeout: 10_000 });
        // "Try again" button resets to connect step
        await expect(
            page.getByRole("button", { name: "Try again" }),
        ).toBeVisible();
    });

    test("Try again resets to connect step", async ({ page }) => {
        await page.goto(
            "/wallet?action=sign_transactions&network=mainnet&transactions=!!!bad!!!",
        );
        await expect(
            page.getByText("Failed to parse the transaction request"),
        ).toBeVisible({ timeout: 10_000 });

        await page.getByRole("button", { name: "Try again" }).click();

        await expect(
            page.getByRole("button", { name: "Connect Wallet" }),
        ).toBeVisible({ timeout: 5_000 });
    });
});

// ---------- waiting-approval step (URL restoration) ----------

test.describe("waiting-approval step", () => {
    test("restores state from URL params with a single proposal", async ({
        page,
    }) => {
        const proposalId = 42;

        await page.goto(
            `/wallet?action=sign_transactions&network=mainnet&daoId=${DAO_ID}&proposalIds=${proposalId}`,
        );

        await expect(page.getByText("Proposal Submitted")).toBeVisible({
            timeout: 10_000,
        });
        // Link to the proposal should be visible
        await expect(
            page.getByText(`${DAO_ID} — Proposal #${proposalId}`),
        ).toBeVisible();
        await expect(
            page.getByRole("button", {
                name: "The Proposal is Approved. Proceed",
            }),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Cancel" }),
        ).toBeVisible();
    });

    test("restores state with multiple proposal IDs", async ({ page }) => {
        const proposalIds = [1, 2, 3];

        await page.goto(
            `/wallet?action=sign_transactions&network=mainnet&daoId=${DAO_ID}&proposalIds=${proposalIds.join(",")}`,
        );

        await expect(page.getByText("Proposal Submitted")).toBeVisible({
            timeout: 10_000,
        });
        for (const id of proposalIds) {
            await expect(
                page.getByText(`${DAO_ID} — Proposal #${id}`),
            ).toBeVisible();
        }
    });

    test("Proceed shows 'pending approval' when proposal is InProgress", async ({
        page,
    }) => {
        const proposalId = 42;

        await page.route(
            "**/api/treasury/policy*",
            async (route: Route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        proposal_period: "604800000000000",
                        proposal_bond: "0",
                    }),
                });
            },
        );

        await page.route(
            `**/api/proposal/${DAO_ID}/${proposalId}`,
            async (route: Route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        id: proposalId,
                        status: "InProgress",
                        submission_time: String(Date.now() * 1_000_000),
                        description: "Test proposal",
                        kind: {},
                        proposer: "alice.near",
                        vote_counts: {},
                        votes: {},
                        last_actions_log: null,
                    }),
                });
            },
        );

        await page.goto(
            `/wallet?action=sign_transactions&network=mainnet&daoId=${DAO_ID}&proposalIds=${proposalId}`,
        );
        await expect(page.getByText("Proposal Submitted")).toBeVisible({
            timeout: 10_000,
        });

        await page
            .getByRole("button", { name: "The Proposal is Approved. Proceed" })
            .click();

        await expect(
            page.getByText(/still pending approval/),
        ).toBeVisible({ timeout: 5_000 });
    });

    test("Proceed sends success postMessage when proposal is Approved and tx hash found", async ({
        page,
    }) => {
        const proposalId = 42;
        const txHash = "abc123txhash456";

        // Capture postMessage calls before the page loads
        await page.addInitScript(() => {
            (window as any).__walletMessages = [];
            (window as any).__windowClosed = false;
            Object.defineProperty(window, "opener", {
                configurable: true,
                get: () => ({
                    postMessage: (data: unknown) => {
                        (window as any).__walletMessages.push(data);
                    },
                }),
            });
            window.close = () => {
                (window as any).__windowClosed = true;
            };
        });

        await page.route(
            "**/api/treasury/policy*",
            async (route: Route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        proposal_period: "604800000000000",
                        proposal_bond: "0",
                    }),
                });
            },
        );

        await page.route(
            `**/api/proposal/${DAO_ID}/${proposalId}`,
            async (route: Route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        id: proposalId,
                        status: "Approved",
                        submission_time: String(Date.now() * 1_000_000),
                        description: "Test proposal",
                        kind: {},
                        proposer: "alice.near",
                        vote_counts: {},
                        votes: {},
                        last_actions_log: null,
                    }),
                });
            },
        );

        await page.route(
            `**/api/proposal/${DAO_ID}/${proposalId}/tx*`,
            async (route: Route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ transaction_hash: txHash }),
                });
            },
        );

        await page.goto(
            `/wallet?action=sign_transactions&network=mainnet&daoId=${DAO_ID}&proposalIds=${proposalId}`,
        );
        await expect(page.getByText("Proposal Submitted")).toBeVisible({
            timeout: 10_000,
        });

        await page
            .getByRole("button", { name: "The Proposal is Approved. Proceed" })
            .click();

        // Should transition to done step
        await expect(
            page.getByText("Proposal created successfully"),
        ).toBeVisible({ timeout: 10_000 });

        // Should have sent a success result to the opener
        const messages = await page.evaluate(
            () => (window as any).__walletMessages,
        );
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            type: "trezu:result",
            status: "success",
            transactionHashes: expect.stringContaining(txHash),
        });
    });

    test("Proceed shows error when tx endpoint fails (proposal not indexed yet)", async ({
        page,
    }) => {
        const proposalId = 99;

        await page.route(
            "**/api/treasury/policy*",
            async (route: Route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        proposal_period: "604800000000000",
                        proposal_bond: "0",
                    }),
                });
            },
        );

        await page.route(
            `**/api/proposal/${DAO_ID}/${proposalId}`,
            async (route: Route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        id: proposalId,
                        status: "Approved",
                        submission_time: String(Date.now() * 1_000_000),
                        description: "Test proposal",
                        kind: {},
                        proposer: "alice.near",
                        vote_counts: {},
                        votes: {},
                        last_actions_log: null,
                    }),
                });
            },
        );

        // Tx endpoint returns 404 (not indexed yet)
        await page.route(
            `**/api/proposal/${DAO_ID}/${proposalId}/tx*`,
            async (route: Route) => {
                await route.fulfill({ status: 404 });
            },
        );

        await page.goto(
            `/wallet?action=sign_transactions&network=mainnet&daoId=${DAO_ID}&proposalIds=${proposalId}`,
        );
        await expect(page.getByText("Proposal Submitted")).toBeVisible({
            timeout: 10_000,
        });

        await page
            .getByRole("button", { name: "The Proposal is Approved. Proceed" })
            .click();

        // Should show "not yet indexed" message
        await expect(
            page.getByText(/not yet indexed/),
        ).toBeVisible({ timeout: 10_000 });
    });
});

// ---------- cancel ----------

test.describe("cancel button", () => {
    test("sends failure postMessage and closes window", async ({ page }) => {
        await page.addInitScript(() => {
            (window as any).__walletMessages = [];
            (window as any).__windowClosed = false;
            Object.defineProperty(window, "opener", {
                configurable: true,
                get: () => ({
                    postMessage: (data: unknown) => {
                        (window as any).__walletMessages.push(data);
                    },
                }),
            });
            window.close = () => {
                (window as any).__windowClosed = true;
            };
        });

        await page.goto("/wallet?action=sign_in&network=mainnet");
        await expect(
            page.getByRole("button", { name: "Cancel" }),
        ).toBeVisible({ timeout: 10_000 });

        await page.getByRole("button", { name: "Cancel" }).click();

        const messages = await page.evaluate(
            () => (window as any).__walletMessages,
        );
        const closed = await page.evaluate(
            () => (window as any).__windowClosed,
        );

        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            type: "trezu:result",
            status: "failure",
            errorMessage: "User cancelled",
        });
        expect(closed).toBe(true);
    });

    test("cancel from waiting-approval also sends failure postMessage", async ({
        page,
    }) => {
        await page.addInitScript(() => {
            (window as any).__walletMessages = [];
            Object.defineProperty(window, "opener", {
                configurable: true,
                get: () => ({
                    postMessage: (data: unknown) => {
                        (window as any).__walletMessages.push(data);
                    },
                }),
            });
            window.close = () => {};
        });

        await page.goto(
            `/wallet?action=sign_transactions&network=mainnet&daoId=${DAO_ID}&proposalIds=1`,
        );
        await expect(page.getByText("Proposal Submitted")).toBeVisible({
            timeout: 10_000,
        });

        await page.getByRole("button", { name: "Cancel" }).click();

        const messages = await page.evaluate(
            () => (window as any).__walletMessages,
        );
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            type: "trezu:result",
            status: "failure",
            errorMessage: "User cancelled",
        });
    });
});

// ---------- sign_in with pre-connected wallet ----------

/**
 * NearConnector sandboxes executor localStorage behind postMessage using a
 * `${manifest.id}:key` prefix. To simulate a pre-connected wallet we:
 *  1. Intercept the NearConnect manifest URL and inject a custom "mock-wallet"
 *     whose executor immediately calls window.selector.ready() with alice.near.
 *  2. Pre-seed localStorage["mock-wallet:signedAccountId"] = "alice.near" so
 *     the injected sandboxedLocalStorage carries the account on first load.
 *  3. Also store localStorage["selected-wallet"] = "mock-wallet" so
 *     NearConnector's getConnectedWallet() finds the right wallet.
 */
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

async function setupMockWallet(page: Page, accountId: string) {
    // Serve the custom manifest
    for (const url of [
        "**/raw.githubusercontent.com/**manifest.json*",
        "**/cdn.jsdelivr.net/**manifest.json*",
    ]) {
        await page.route(url, async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(MOCK_MANIFEST),
            });
        });
    }

    // Serve the mock executor JS
    await page.route(
        "**/_near-connect-test/mock-wallet.js*",
        async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/javascript",
                body: MOCK_WALLET_EXECUTOR_JS,
            });
        },
    );

    // Seed localStorage keys before the page loads
    await page.addInitScript(
        ({ walletId, acct }) => {
            // NearConnector stores the selected wallet id directly
            localStorage.setItem("selected-wallet", walletId);
            // Executor sandbox storage is prefixed with manifest.id
            localStorage.setItem(`${walletId}:signedAccountId`, acct);
        },
        { walletId: MOCK_MANIFEST_ID, acct: accountId },
    );
}

test.describe("sign_in with pre-connected wallet", () => {
    test("shows treasury selection when wallet already connected (select-treasury step)", async ({
        page,
    }) => {
        await setupMockWallet(page, "alice.near");

        await page.route(
            "**/api/user/treasuries*",
            async (route: Route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify([
                        {
                            daoId: DAO_ID,
                            config: { name: "My Test Treasury" },
                            isMember: true,
                        },
                    ]),
                });
            },
        );

        await page.goto("/wallet?action=sign_in&network=mainnet");

        // Should skip connect step and go directly to treasury selection
        await expect(
            page.getByText("Select a treasury to"),
        ).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(DAO_ID)).toBeVisible();
        await expect(page.getByText("My Test Treasury")).toBeVisible();
    });

    test("clicking a treasury sends success postMessage (sign_in done step)", async ({
        page,
    }) => {
        await setupMockWallet(page, "alice.near");

        // Mock window.opener to capture postMessage calls
        await page.addInitScript(() => {
            (window as any).__walletMessages = [];
            Object.defineProperty(window, "opener", {
                configurable: true,
                get: () => ({
                    postMessage: (data: unknown) => {
                        (window as any).__walletMessages.push(data);
                    },
                }),
            });
            window.close = () => {};
        });

        await page.route(
            "**/api/user/treasuries*",
            async (route: Route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify([
                        {
                            daoId: DAO_ID,
                            config: { name: "My Test Treasury" },
                            isMember: true,
                        },
                    ]),
                });
            },
        );

        await page.goto("/wallet?action=sign_in&network=mainnet");

        await expect(page.getByText(DAO_ID)).toBeVisible({ timeout: 10_000 });
        await page.getByText(DAO_ID).click();

        // Should show done step
        await expect(
            page.getByText("Signed in successfully"),
        ).toBeVisible({ timeout: 5_000 });

        // Should have sent the DAO account ID as the signed-in account
        const messages = await page.evaluate(
            () => (window as any).__walletMessages,
        );
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            type: "trezu:result",
            status: "success",
            accountId: DAO_ID,
        });
    });
});

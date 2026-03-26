/**
 * E2E test for the confidential shield page.
 *
 * Tests the full flow:
 * 1. Navigate to /{treasuryId}/confidential
 * 2. Enter shield amount
 * 3. Verify mock quote loads
 * 4. Review the shield request
 * 5. Submit → verify the v1.signer proposal uses payload_v2 Eddsa format
 *
 * Uses mock wallet with signDelegateActions + intercepted relay endpoint.
 * The proposal is NOT submitted on-chain.
 */
import { test, expect, BrowserContext, Route } from "@playwright/test";
import {
    MOCK_MANIFEST_ID,
    MOCK_WALLET_EXECUTOR_JS,
    MOCK_MANIFEST,
} from "./helpers/mock-wallet";

const DAO_ID = "petersalomonsendev.sputnik-dao.near";
const ACCOUNT_ID = "petersalomonsendev.near";

async function mockRoutes(context: BrowserContext) {
    // NearConnect manifest CDN
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

    // Mock wallet executor JS
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

    // Auth endpoints
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

    // Treasury config (needed by layout)
    await context.route("**/api/treasury/config*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                name: "Test DAO",
                purpose: "Testing confidential intents",
                metadata: "",
            }),
        });
    });

    // Treasury policy (needed for proposal bond and permissions)
    await context.route("**/api/treasury/policy*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                roles: [
                    {
                        name: "all",
                        kind: "Everyone",
                        permissions: [
                            "call:AddProposal",
                            "call:VoteApprove",
                            "call:VoteReject",
                        ],
                        vote_policy: {},
                    },
                ],
                default_vote_policy: {
                    weight_kind: "RoleWeight",
                    quorum: "0",
                    threshold: [1, 2],
                },
                proposal_bond: "100000000000000000000000",
                proposal_period: "604800000000000",
                bounty_bond: "1000000000000000000000000",
                bounty_forgiveness_period: "604800000000000",
            }),
        });
    });

    // User treasuries
    await context.route("**/api/user/treasuries*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([
                {
                    daoId: DAO_ID,
                    config: {
                        name: "Test DAO",
                        purpose: "Testing confidential intents",
                        metadata: "",
                    },
                    isMember: true,
                },
            ]),
        });
    });

    // Monitored accounts (may be polled by layout)
    await context.route("**/api/monitored-accounts*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([]),
        });
    });

    // Subscription status (needed by CreateRequestButton)
    await context.route("**/api/subscription/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                planId: "free",
                gasCoveredTransactions: 100,
                planConfig: {
                    limits: {
                        gasCoveredTransactions: null,
                    },
                },
            }),
        });
    });

    // Proposal storage estimation RPC (let it return a reasonable value)
    await context.route("**/api/rpc*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ result: 500 }),
        });
    });

    // Proposals list (sidebar badge count)
    await context.route("**/api/proposals/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                page: 0,
                page_size: 10,
                total: 0,
                proposals: [],
            }),
        });
    });

    // Treasury creation status (polled on init)
    await context.route("**/api/treasury/creation-status*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(null),
        });
    });
}

test.describe("Confidential Shield", () => {
    test("full shield flow — quote, review, and proposal submission", async ({
        page,
        context,
    }) => {
        test.setTimeout(60_000);

        const capturedRelayRequests: any[] = [];
        const consoleErrors: string[] = [];

        page.on("console", (msg) => {
            if (msg.type() === "error") {
                consoleErrors.push(msg.text());
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
        await page.goto(`/${DAO_ID}`);
        await page.evaluate(
            ({ walletId, acct }) => {
                localStorage.setItem("selected-wallet", walletId);
                localStorage.setItem(`${walletId}:signedAccountId`, acct);
            },
            { walletId: MOCK_MANIFEST_ID, acct: ACCOUNT_ID },
        );
        await page.goto(`/${DAO_ID}/confidential`);

        // Step 1: Enter amount
        const amountInput = page.locator("input").first();
        await amountInput.click();
        await amountInput.fill("0.01");

        // Verify quote loads (mock quotes are immediate)
        await expect(page.locator("text=You will receive")).toBeVisible({
            timeout: 10_000,
        });

        // Click Review
        const reviewBtn = page.getByRole("button", {
            name: /Review Shield Request/i,
        });
        await expect(reviewBtn).toBeEnabled({ timeout: 5_000 });
        await reviewBtn.click();

        // Step 2: Verify review content
        await expect(
            page.getByText("Public → Confidential", { exact: true }),
        ).toBeVisible({ timeout: 10_000 });

        // Verify v1.signer signing info is shown
        await expect(
            page.getByText("v1.signer (MPC chain-signatures)"),
        ).toBeVisible();

        // Verify warning alert
        await expect(
            page.locator("text=This proposal will sign a confidential intent"),
        ).toBeVisible();

        // Click Submit
        const submitBtn = page.getByRole("button", {
            name: /Confirm and Submit/i,
        });
        await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
        await submitBtn.click();

        // Wait for the relay request to be captured
        await expect
            .poll(() => capturedRelayRequests.length, { timeout: 15_000 })
            .toBeGreaterThan(0);

        // Verify the proposal structure
        const relayBody = capturedRelayRequests[0];
        expect(relayBody.treasuryId).toBe(DAO_ID);
        expect(relayBody.proposalType).toBe("confidential_transfer");

        // Decode the delegate action to verify proposal targets v1.signer
        const delegateAction = relayBody.signedDelegateAction;
        expect(delegateAction).toBeDefined();

        const da = delegateAction.delegateAction;
        expect(da.receiverId).toBe(DAO_ID);

        // The first action should be add_proposal
        expect(da.actions.length).toBeGreaterThan(0);
        const action = da.actions[0];
        expect(action.params.methodName).toBe("add_proposal");

        // Decode proposal args (may be base64 string or raw object depending on wallet)
        const rawArgs = action.params.args;
        const args =
            typeof rawArgs === "string"
                ? JSON.parse(Buffer.from(rawArgs, "base64").toString())
                : rawArgs;
        const kind = args.proposal.kind;
        expect(kind.FunctionCall).toBeDefined();
        expect(kind.FunctionCall.receiver_id).toBe("v1.signer");
        expect(kind.FunctionCall.actions[0].method_name).toBe("sign");

        // Verify v1.signer sign args use payload_v2 Eddsa format (not deprecated payload)
        const rawSignArgs = kind.FunctionCall.actions[0].args;
        const signArgs =
            typeof rawSignArgs === "string"
                ? JSON.parse(Buffer.from(rawSignArgs, "base64").toString())
                : rawSignArgs;
        expect(signArgs.request.payload_v2).toBeDefined();
        expect(signArgs.request.payload_v2.Eddsa).toBeDefined();
        expect(signArgs.request.domain_id).toBe(1);
        expect(signArgs.request.path).toBe(DAO_ID);

        // Verify the Eddsa value is a valid hex string (64 chars = 32 bytes SHA-256)
        expect(signArgs.request.payload_v2.Eddsa).toMatch(/^[0-9a-f]{64}$/);
    });

    test("step 1 — shows quote details for entered amount", async ({
        page,
        context,
    }) => {
        await mockRoutes(context);

        await page.goto(`/${DAO_ID}`);
        await page.evaluate(
            ({ walletId, acct }) => {
                localStorage.setItem("selected-wallet", walletId);
                localStorage.setItem(`${walletId}:signedAccountId`, acct);
            },
            { walletId: MOCK_MANIFEST_ID, acct: ACCOUNT_ID },
        );
        await page.goto(`/${DAO_ID}/confidential`);

        // Page title
        await expect(page.locator("text=Shield to Confidential")).toBeVisible({
            timeout: 10_000,
        });

        // Enter amount
        const amountInput = page.locator("input").first();
        await amountInput.fill("0.5");

        // Quote should appear
        await expect(page.locator("text=You will receive")).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.locator("text=Estimated Time")).toBeVisible();

        // Review button should be enabled
        const reviewBtn = page.getByRole("button", {
            name: /Review Shield Request/i,
        });
        await expect(reviewBtn).toBeEnabled({ timeout: 5_000 });
    });

    test("step 1 — review button disabled without amount", async ({
        page,
        context,
    }) => {
        await mockRoutes(context);

        await page.goto(`/${DAO_ID}`);
        await page.evaluate(
            ({ walletId, acct }) => {
                localStorage.setItem("selected-wallet", walletId);
                localStorage.setItem(`${walletId}:signedAccountId`, acct);
            },
            { walletId: MOCK_MANIFEST_ID, acct: ACCOUNT_ID },
        );
        await page.goto(`/${DAO_ID}/confidential`);

        await expect(page.locator("text=Shield to Confidential")).toBeVisible({
            timeout: 10_000,
        });

        // Without entering an amount, the button should show "Enter an amount to shield"
        await expect(
            page.locator("text=Enter an amount to shield"),
        ).toBeVisible({ timeout: 5_000 });
    });
});

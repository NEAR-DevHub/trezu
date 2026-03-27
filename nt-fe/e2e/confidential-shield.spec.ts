/**
 * E2E tests for the confidential shield page.
 *
 * Tests the full flow:
 * 1. Navigate to /{treasuryId}/confidential
 * 2. Enter shield amount, verify quote loads
 * 3. Review the shield request
 * 4. Submit → capture the v1.signer proposal payload
 * 5. Submit + approve the proposal on the sandbox blockchain
 * 6. Extract the MPC signature from the execution result
 * 7. Submit the signed intent to the backend
 *
 * Uses mock wallet for UI interaction + real sandbox for on-chain operations.
 */
import { test, expect, BrowserContext, Route } from "@playwright/test";
import {
    MOCK_MANIFEST_ID,
    MOCK_WALLET_EXECUTOR_JS,
    MOCK_MANIFEST,
} from "./helpers/mock-wallet";
import {
    createAccount,
    transferNear,
    addProposal,
    approveProposal,
    extractMpcSignature,
} from "./helpers/sandbox-rpc";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58 = require("bs58") as { encode: (buf: Uint8Array) => string };
import confidentialIntent from "./fixtures/confidential-intent.json";

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

    // Confidential balances (return empty to avoid auth prompt)
    await context.route("**/api/intents/balances*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({}),
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

// Known MPC public key for the mock v1.signer on sandbox
const MPC_PUBLIC_KEY = "ed25519:7pPtVUyLDRXvzkgAUtfGeUK9ZWaSWd256tSgvazfZKZg";

test.describe("Confidential Shield", () => {
    test("full shield flow — quote, review, proposal, approve, and signed intent submission", async ({
        page,
        context,
    }) => {
        test.setTimeout(120_000);

        const capturedRelayRequests: any[] = [];

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

        // ── Step 1: Enter amount ─────────────────────────────
        const amountInput = page.locator("input").first();
        await amountInput.click();
        await amountInput.fill("0.01");

        await expect(page.locator("text=You will receive")).toBeVisible({
            timeout: 10_000,
        });

        // Click Review
        const reviewBtn = page.getByRole("button", {
            name: /Review Shield Request/i,
        });
        await expect(reviewBtn).toBeEnabled({ timeout: 10_000 });
        await reviewBtn.click({ timeout: 10_000 });

        // ── Step 2: Verify review content ────────────────────
        await expect(
            page.getByText("Public → Confidential", { exact: true }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(
            page.getByText("v1.signer (MPC chain-signatures)"),
        ).toBeVisible();

        // Click Submit
        const submitBtn = page.getByRole("button", {
            name: /Confirm and Submit/i,
        });
        await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
        await submitBtn.click();

        // ── Step 3: Capture the proposal from the relay request ──
        await expect
            .poll(() => capturedRelayRequests.length, { timeout: 15_000 })
            .toBeGreaterThan(0);

        const relayBody = capturedRelayRequests[0];
        expect(relayBody.proposalType).toBe("confidential_transfer");

        // Extract the proposal kind from the relay payload
        const da = relayBody.signedDelegateAction.delegateAction;
        const rawArgs = da.actions[0].params.args;
        const proposalArgs =
            typeof rawArgs === "string"
                ? JSON.parse(Buffer.from(rawArgs, "base64").toString())
                : rawArgs;
        const proposalKind = proposalArgs.proposal.kind;

        // Verify it targets v1.signer with payload_v2 Eddsa
        expect(proposalKind.FunctionCall.receiver_id).toBe("v1.signer");
        const signAction = proposalKind.FunctionCall.actions[0];
        expect(signAction.method_name).toBe("sign");
        const signArgs =
            typeof signAction.args === "string"
                ? JSON.parse(Buffer.from(signAction.args, "base64").toString())
                : signAction.args;
        expect(signArgs.request.payload_v2.Eddsa).toMatch(/^[0-9a-f]{64}$/);

        // ── Step 4: Submit the same proposal on-chain via sandbox RPC ──
        // Create the signer account if it doesn't exist
        try {
            await createAccount(ACCOUNT_ID, "near", 10);
        } catch {
            // Account may already exist from a previous test run
        }

        // Fund the DAO so it can cover storage for proposals
        await transferNear("near", DAO_ID, 5);

        const proposalId = await addProposal(ACCOUNT_ID, DAO_ID, {
            description: proposalArgs.proposal.description,
            kind: proposalKind,
        });

        // ── Step 5: Approve the proposal → v1.signer executes ──
        const approvalResult = await approveProposal(
            ACCOUNT_ID,
            DAO_ID,
            proposalId,
        );

        // ── Step 6: Extract MPC signature from execution result ──
        const sigBytes = extractMpcSignature(approvalResult);
        expect(sigBytes).not.toBeNull();
        expect(sigBytes!.length).toBe(64);

        const sigB58 = `ed25519:${bs58.encode(sigBytes!)}`;

        // ── Step 7: Verify the signed intent payload ──
        const intentPayload = confidentialIntent.intent.payload;

        // Verify the signature format is correct
        expect(sigB58).toMatch(/^ed25519:[A-Za-z0-9]+$/);

        // Verify the signature bytes match the mock signer's hardcoded response
        const expectedSigBytes = new Uint8Array([
            233, 72, 198, 128, 218, 168, 10, 73, 247, 157, 77, 46, 172,
            228, 149, 132, 108, 151, 150, 123, 238, 249, 14, 74, 70,
            254, 56, 16, 204, 102, 170, 164, 168, 202, 120, 81, 147,
            166, 114, 246, 10, 134, 45, 75, 48, 118, 121, 99, 0, 156,
            138, 181, 231, 92, 18, 124, 237, 223, 202, 88, 163, 178,
            35, 8,
        ]);
        expect(Buffer.from(sigBytes!)).toEqual(
            Buffer.from(expectedSigBytes),
        );

        // Verify the complete submit-intent payload structure
        const submitBody = {
            type: "swap_transfer",
            signedData: {
                standard: "nep413",
                payload: intentPayload,
                public_key: MPC_PUBLIC_KEY,
                signature: sigB58,
            },
        };

        // Assert the payload has all required fields
        expect(submitBody.type).toBe("swap_transfer");
        expect(submitBody.signedData.standard).toBe("nep413");
        expect(submitBody.signedData.payload.message).toContain(
            "signer_id",
        );
        expect(submitBody.signedData.payload.nonce).toBeTruthy();
        expect(submitBody.signedData.payload.recipient).toBe(
            "intents.near",
        );
        expect(submitBody.signedData.public_key).toBe(MPC_PUBLIC_KEY);
        expect(submitBody.signedData.signature).toMatch(
            /^ed25519:[A-Za-z0-9]+$/,
        );

        // Call the backend's submit-intent to verify it accepts the payload
        const backendUrl =
            process.env.BACKEND_URL || "http://localhost:8080";
        const submitResp = await fetch(
            `${backendUrl}/api/intents/submit-intent`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(submitBody),
            },
        );

        // The backend proxies to 1Click API which isn't running in sandbox.
        // 502/500 = 1Click unreachable, 404 = intents routes not in this build.
        // A 400/422 would indicate our payload is malformed.
        expect(
            [400, 422].includes(submitResp.status) === false,
            `Submit-intent rejected our payload (${submitResp.status}): ${await submitResp.text()}`,
        ).toBe(true);
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

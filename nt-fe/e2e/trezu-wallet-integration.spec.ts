/**
 * Integration tests for the Trezu Wallet end-to-end flow.
 *
 * These tests simulate a real external dApp (e2e/test-dapp.html) that
 * communicates with the Trezu Wallet popup using the same postMessage protocol
 * that the near-connect trezu-wallet.js plugin uses.
 *
 * The full flow being tested:
 *   1. dApp opens /wallet?action=sign_in  → user selects treasury  → dApp gets accountId
 *   2. dApp opens /wallet?action=sign_transactions → user reviews proposal → closes or...
 *   3. After DAO approval, the waiting-approval popup polls the backend and
 *      auto-advances → dApp gets the tx hash (no manual clicking).
 *
 * The confirm-transactions step requires the user's personal NEAR wallet to sign
 * add_proposal on chain. Rather than bootstrapping a full NEAR signing stack, we
 * test that step at the UI level (correct preview, closing the popup fails the
 * dApp promise) and test the post-creation flow (waiting-approval → approved →
 * tx hash) separately.
 *
 * The wallet page requires a full session: a backend session cookie (mocked
 * via /api/auth/me) AND a connected near-connect wallet (mock manifest +
 * seeded localStorage).
 */

import type { BrowserContext, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { expect, test } from "./fixtures/test-with-pages";
import {
    registerMockWalletRoutes,
    seedMockWalletAccount,
} from "./helpers/mock-wallet";
import { WalletPopupPage } from "./pages/wallet-popup.page";

const TEST_DAPP_HTML = fs.readFileSync(
    path.join(__dirname, "test-dapp.html"),
    "utf-8",
);

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const DAO_ID = "webassemblymusic-treasury.sputnik-dao.near";
const SIGNED_IN_ACCOUNT = "alice.near";

const PROPOSAL_ID = 42;
const TX_HASH = "7HBqrPAEtBVR5dRHKqtpFBgJqwWnmjXDDvQ3NEAR1abc";

/** submission_time in nanoseconds (2025-02-18T00:00:00Z). */
const SUBMISSION_TIME_NS = "1739836800000000000";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const TREASURY_RESPONSE = [
    {
        daoId: DAO_ID,
        config: { name: "WebAssembly Music", purpose: "", metadata: {} },
        isMember: true,
    },
];

/**
 * Mock backend API routes + NearConnect manifest/executor on the context
 * (applies to all pages including popups).
 */
async function mockBackendRoutes(context: BrowserContext) {
    // Serve mock NearConnect manifest so the wallet popup auto-connects
    await registerMockWalletRoutes(context);

    // Serve the dummy dApp from e2e/ (not public/) so it's never shipped to prod.
    await context.route("**/test-dapp.html", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: TEST_DAPP_HTML,
        });
    });

    // Backend session — the wallet page only acts on a fully authenticated
    // account (session + accepted terms).
    await context.route("**/api/auth/me", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                accountId: SIGNED_IN_ACCOUNT,
                termsAccepted: true,
            }),
        });
    });

    await context.route("**/api/user/treasuries*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(TREASURY_RESPONSE),
        });
    });

    await context.route("**/api/treasury/policy*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                proposal_bond: "100000000000000000000000",
                proposal_period: "604800000000000",
            }),
        });
    });

    await context.route(
        `**/api/proposal/${DAO_ID}/${PROPOSAL_ID}/tx*`,
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ transaction_hash: TX_HASH }),
            });
        },
    );

    await context.route(
        `**/api/proposal/${DAO_ID}/${PROPOSAL_ID}`,
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: PROPOSAL_ID,
                    status: "Approved",
                    submission_time: SUBMISSION_TIME_NS,
                    description: "Proposal from external dApp",
                    kind: { Transfer: {} },
                    proposer: SIGNED_IN_ACCOUNT,
                    vote_counts: {},
                    votes: {},
                    last_actions_log: null,
                }),
            });
        },
    );
}

/**
 * Seed the NearConnector wallet account in localStorage.
 * Same-origin popups share localStorage, so this pre-connects the mock wallet
 * for any popup opened after this call.
 */
async function seedWalletAccount(page: Page, accountId: string) {
    await seedMockWalletAccount(page, accountId, "evaluate");
}

/* ------------------------------------------------------------------ */
/* Test 1: sign_in roundtrip                                            */
/* ------------------------------------------------------------------ */

test.describe("sign_in: connect via Trezu Wallet popup", () => {
    test("user selects treasury → dApp receives DAO account as signed-in accountId", async ({
        page,
        context,
        testDappPage,
    }) => {
        test.setTimeout(60_000);

        await mockBackendRoutes(context);
        await testDappPage.goto();

        // Seed mock wallet account — localStorage is shared across same-origin pages,
        // so the wallet popup will also see this and skip the "Connect Wallet" step.
        await seedWalletAccount(page, SIGNED_IN_ACCOUNT);

        const popupPromise = context.waitForEvent("page");
        await testDappPage.connectButton().click();
        const popup = await popupPromise;
        const walletPopup = new WalletPopupPage(popup);

        // Wallet popup should reach the select-treasury step
        await expect(walletPopup.chooseTreasuryText()).toBeVisible({
            timeout: 15_000,
        });

        // Click the treasury
        await walletPopup.treasuryRow(DAO_ID).click();

        // Popup shows done confirmation
        await expect(walletPopup.treasuryConnectedText()).toBeVisible({
            timeout: 8_000,
        });

        // dApp received trezu:result with the DAO account
        const msg = await testDappPage.waitForLastMessage();
        expect(msg).toMatchObject({
            type: "trezu:result",
            status: "success",
            accountId: DAO_ID,
        });

        await expect(testDappPage.statusText()).toContainText(
            `Connected as ${DAO_ID}`,
        );
    });
});

/* ------------------------------------------------------------------ */
/* Test 2: sign_transactions — proposal preview UI (Transfer)          */
/* ------------------------------------------------------------------ */

test.describe("sign_transactions: Transfer NEAR proposal preview", () => {
    test("wallet popup shows Transfer proposal; closing the popup fails the dApp promise", async ({
        page,
        context,
        testDappPage,
    }) => {
        test.setTimeout(60_000);

        await mockBackendRoutes(context);
        await testDappPage.goto();

        await seedWalletAccount(page, SIGNED_IN_ACCOUNT);
        await testDappPage.simulateConnected(DAO_ID);

        // Click "Transfer 1 NEAR to alice.near"
        const popupPromise = context.waitForEvent("page");
        await testDappPage.transferButton().click();
        const popup = await popupPromise;
        const walletPopup = new WalletPopupPage(popup);

        // The wallet popup auto-selects the DAO (signerId matches) and
        // shows the confirm-transactions step.
        await expect(walletPopup.createProposalHeading()).toBeVisible({
            timeout: 15_000,
        });

        // Verify the proposal preview shows the correct recipient
        await expect(walletPopup.previewText("alice.near")).toBeVisible();

        // Acting-as block shows the selected DAO
        await expect(walletPopup.previewText(DAO_ID)).toBeVisible();

        // Closing the popup without signing → dApp promise rejects
        await popup.close();

        await expect(testDappPage.statusText()).toContainText(
            "Popup was closed",
            { timeout: 5_000 },
        );
    });
});

/* ------------------------------------------------------------------ */
/* Test 3: sign_transactions — FunctionCall proposal preview           */
/* ------------------------------------------------------------------ */

test.describe("sign_transactions: FunctionCall (ft_transfer) proposal preview", () => {
    test("wallet popup shows the ft_transfer recipient; closing the popup fails the dApp promise", async ({
        page,
        context,
        testDappPage,
    }) => {
        test.setTimeout(60_000);

        await mockBackendRoutes(context);
        await testDappPage.goto();

        await seedWalletAccount(page, SIGNED_IN_ACCOUNT);
        await testDappPage.simulateConnected(DAO_ID);

        const popupPromise = context.waitForEvent("page");
        await testDappPage.ftCallButton().click();
        const popup = await popupPromise;
        const walletPopup = new WalletPopupPage(popup);

        await expect(walletPopup.createProposalHeading()).toBeVisible({
            timeout: 15_000,
        });

        // The wallet renders the recipient from ft_transfer args (receiver_id),
        // not from the raw function name.
        await expect(walletPopup.previewText("alice.near")).toBeVisible();

        // Acting-as block shows the selected DAO
        await expect(walletPopup.previewText(DAO_ID)).toBeVisible();

        await popup.close();

        await expect(testDappPage.statusText()).toContainText(
            "Popup was closed",
            { timeout: 5_000 },
        );
    });
});

/* ------------------------------------------------------------------ */
/* Test 4: waiting-approval → approved → dApp receives tx hash         */
/* ------------------------------------------------------------------ */

test.describe("waiting-approval: after DAO votes Approve, dApp receives tx hash", () => {
    /**
     * This test simulates the second phase of the sign_transactions flow:
     * the proposal was already submitted (proposalId=42), treasury members voted,
     * and now the wallet popup's status poll (which runs immediately on entry)
     * discovers the approval and retrieves the tx hash — no clicking involved.
     *
     * The popup is opened by the dApp via window.open() so window.opener is set,
     * and the URL includes daoId+proposalIds to jump straight to waiting-approval.
     */
    test("approval poll sends transactionHashes to dApp opener automatically", async ({
        page,
        context,
        testDappPage,
    }) => {
        test.setTimeout(60_000);

        await mockBackendRoutes(context);
        await testDappPage.goto();
        await seedWalletAccount(page, SIGNED_IN_ACCOUNT);

        // Open the wallet popup from the dApp page so window.opener is set.
        // Use waiting-approval URL params to skip the signing step.
        const popupPromise = context.waitForEvent("page");
        await testDappPage.openWalletPopupForApproval(DAO_ID, PROPOSAL_ID);
        const popup = await popupPromise;
        const walletPopup = new WalletPopupPage(popup);

        // The proposal API is mocked as Approved with an indexed tx, so the
        // immediate poll advances straight to the done step.
        await expect(walletPopup.doneText()).toBeVisible({ timeout: 10_000 });

        // dApp received the trezu:result with the transaction hash
        const msg = await testDappPage.waitForLastMessage();
        expect(msg).toMatchObject({
            type: "trezu:result",
            status: "success",
            transactionHashes: TX_HASH,
        });
    });

    test("InProgress status keeps the checklist open without notifying the dApp", async ({
        page,
        context,
        testDappPage,
    }) => {
        test.setTimeout(60_000);

        // Set up all base mocks first, then override the proposal route to return InProgress
        await mockBackendRoutes(context);
        await context.route(
            `**/api/proposal/${DAO_ID}/${PROPOSAL_ID}`,
            async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        id: PROPOSAL_ID,
                        status: "InProgress",
                        submission_time: SUBMISSION_TIME_NS,
                        description: "Pending",
                        kind: { Transfer: {} },
                        proposer: SIGNED_IN_ACCOUNT,
                        vote_counts: {},
                        votes: {},
                        last_actions_log: null,
                    }),
                });
            },
        );

        await testDappPage.goto();
        await seedWalletAccount(page, SIGNED_IN_ACCOUNT);

        const popupPromise = context.waitForEvent("page");
        await testDappPage.openWalletPopupForApproval(DAO_ID, PROPOSAL_ID);
        const popup = await popupPromise;
        const walletPopup = new WalletPopupPage(popup);

        // Shows the approval checklist with the proposal link
        await expect(walletPopup.whatToDoNextText()).toBeVisible({
            timeout: 10_000,
        });
        await expect(
            walletPopup.proposalLinkText(DAO_ID, PROPOSAL_ID),
        ).toBeVisible();

        // The immediate poll found InProgress — the popup stays open and the
        // dApp has not received any message.
        await popup.waitForTimeout(1_000);
        await expect(walletPopup.whatToDoNextText()).toBeVisible();
        const msg = await testDappPage.lastMessage();
        expect(msg).toBeUndefined();
    });
});

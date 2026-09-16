/**
 * E2E coverage for the single-payment creation wizard (previously zero
 * automated coverage — see MANUAL_REGRESSION_CHECKLIST.md §5, PAY-06/PAY-07).
 *
 * Scoped to the form-validation and review-step-accuracy checks only: the
 * wizard is driven up to (and back from) the review step, never submitted.
 * Submitting a real proposal needs a signed wallet transaction — a separate,
 * heavier "full lifecycle" test (PAY-01) — out of scope here.
 *
 * Deep-links straight to a native NEAR transfer (`?token=NEAR&network=near`)
 * so the token/network pickers never need driving, and uses a 64-hex-char
 * "implicit account" as the valid recipient — near-validation.ts treats that
 * format as valid without an on-chain existence check, so no RPC/backend
 * account-lookup mocking is needed either.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test-with-pages";
import {
    maybeFulfillMockWalletRequest,
    seedMockWalletAccount,
} from "./helpers/mock-wallet";

// Reuses the shared, sandbox-seeded fixture DAO from global-setup.ts (also
// used by exchange-amount-formatting.spec.ts) — a treasuryId not pre-seeded
// there gets "UnknownAccount" from a real NEAR RPC call the server makes
// during SSR, which page.route() can't intercept (it only sees browser-side
// requests).
const TREASURY_ID = "requests-e2e-test.sputnik-dao.near";
const ACCOUNT_ID = "test.near";
const VALID_IMPLICIT_RECIPIENT = "a".repeat(64);

const POLICY = {
    roles: [
        {
            name: "council",
            kind: { Group: [ACCOUNT_ID] },
            permissions: ["*:AddProposal"],
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
    bounty_bond: "100000000000000000000000",
    bounty_forgiveness_period: "604800000000000",
};

const ASSETS = [
    {
        id: "near",
        contractId: "near",
        residency: "Near",
        network: "near",
        chainName: "NEAR Protocol",
        symbol: "NEAR",
        balance: {
            Standard: { total: "100000000000000000000000000", locked: "0" },
        },
        decimals: 24,
        price: "5",
        name: "NEAR",
        icon: "",
        chainIcons: { icon: "" },
    },
];

async function setupPaymentsMocks(page: Page) {
    await seedMockWalletAccount(page, ACCOUNT_ID, "init");
    // Otherwise the payments-bulk onboarding tour's overlay covers the page
    // on first visit and intercepts every click, including Review.
    await page.addInitScript(() => {
        localStorage.setItem("payments-bulk-tour-shown:v1", "true");
    });

    await page.route("**/*", async (route) => {
        if (await maybeFulfillMockWalletRequest(route)) return;

        const url = route.request().url();
        const json = (body: unknown) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(body),
            });

        if (url.includes("/auth/me")) {
            return json({ accountId: ACCOUNT_ID, termsAccepted: true });
        }
        if (url.includes("/treasury/creation-status")) {
            return json({ creationAvailable: true });
        }
        if (url.includes("/user/treasuries")) {
            return json([
                {
                    daoId: TREASURY_ID,
                    config: { name: "Payments E2E Test", metadata: {} },
                    isMember: true,
                    isSaved: true,
                    isHidden: false,
                },
            ]);
        }
        if (url.includes("/treasury/policy")) return json(POLICY);
        if (url.includes("/user/assets")) return json(ASSETS);
        if (
            url.includes("/intents/deposit-tokens") ||
            url.includes("/intents/swap-tokens")
        ) {
            return json({ assets: [] });
        }
        if (url.includes("/address-book")) return json([]);
        if (url.includes("/chains")) return json([]);
        if (url.includes("/warnings")) return json({ warnings: [] });
        if (url.includes("/subscription/")) {
            return json({
                accountId: TREASURY_ID,
                planType: "free",
                planConfig: {
                    planType: "free",
                    limits: { gasCoveredTransactions: null },
                    pricing: {},
                },
                exportCredits: 10,
                batchPaymentCredits: 10,
                gasCoveredTransactions: 100,
            });
        }

        return route.continue();
    });
}

test.describe("Payments — form validation (PAY-06)", () => {
    test("Review stays disabled until recipient and amount are filled", async ({
        page,
        paymentsPage,
    }) => {
        await setupPaymentsMocks(page);
        await paymentsPage.goto(TREASURY_ID, {
            token: "NEAR",
            network: "near",
        });

        await expect(paymentsPage.reviewButton()).toBeDisabled({
            timeout: 15_000,
        });

        await paymentsPage.amountInput().fill("1");
        await expect(paymentsPage.reviewButton()).toBeDisabled();

        await paymentsPage.recipientInput().fill(VALID_IMPLICIT_RECIPIENT);
        await expect(paymentsPage.reviewButton()).toBeEnabled({
            timeout: 10_000,
        });
    });

    test("a malformed recipient address keeps Review disabled", async ({
        page,
        paymentsPage,
    }) => {
        await setupPaymentsMocks(page);
        await paymentsPage.goto(TREASURY_ID, {
            token: "NEAR",
            network: "near",
        });

        await paymentsPage.amountInput().fill("1");
        await paymentsPage.recipientInput().fill("not-a-valid-address!!!");

        // Malformed NEAR address is incompatible with the only available
        // ("near") destination network, so the network selection clears and
        // Review stays disabled — the observable, user-facing validation gate.
        await expect(paymentsPage.reviewButton()).toBeDisabled({
            timeout: 10_000,
        });
    });

    test("a zero amount keeps Review disabled", async ({
        page,
        paymentsPage,
    }) => {
        await setupPaymentsMocks(page);
        await paymentsPage.goto(TREASURY_ID, {
            token: "NEAR",
            network: "near",
        });

        await paymentsPage.recipientInput().fill(VALID_IMPLICIT_RECIPIENT);
        await paymentsPage.amountInput().fill("0");

        await expect(paymentsPage.reviewButton()).toBeDisabled({
            timeout: 10_000,
        });
    });
});

test.describe("Payments — review step accuracy (PAY-07)", () => {
    test("review step mirrors step-1 inputs, and Back preserves them", async ({
        page,
        paymentsPage,
    }) => {
        await setupPaymentsMocks(page);
        await paymentsPage.goto(TREASURY_ID, {
            token: "NEAR",
            network: "near",
        });

        await paymentsPage.recipientInput().fill(VALID_IMPLICIT_RECIPIENT);
        await paymentsPage.amountInput().fill("2.5");
        await expect(paymentsPage.reviewButton()).toBeEnabled({
            timeout: 10_000,
        });

        await paymentsPage.reviewButton().click();

        await expect(paymentsPage.reviewHeading()).toBeVisible({
            timeout: 10_000,
        });
        // The <Address> component truncates long recipients to
        // prefix...suffix (8 chars each by default), so the full 64-char
        // implicit account never renders as one text node — match the
        // truncated form it actually displays.
        await expect(
            paymentsPage.stepText(
                `${VALID_IMPLICIT_RECIPIENT.slice(0, 8)}...${VALID_IMPLICIT_RECIPIENT.slice(-8)}`,
            ),
        ).toBeVisible();
        await expect(paymentsPage.stepText(/2\.5/)).toBeVisible();
        await expect(paymentsPage.stepText("NEAR")).toBeVisible();

        await paymentsPage.backButton().click();

        await expect(paymentsPage.reviewHeading()).not.toBeVisible();
        await expect(paymentsPage.recipientInput()).toHaveValue(
            VALID_IMPLICIT_RECIPIENT,
        );
        await expect(paymentsPage.amountInput()).toHaveValue("2.5");
    });
});

/**
 * Error States (Phase 1): every failure a sponsored transaction can surface,
 * asserted on the toast the user actually sees.
 *
 * The relay endpoint is route-mocked so each backend error code is exercised
 * deterministically; the wallet is the shared mock executor with signing
 * stubbed, and wallet-side failures are produced by an executor variant that
 * throws. The sandbox is still needed for the treasury layout's SSR config
 * fetch (same fixture DAO as payments.spec.ts).
 *
 * Copy is read from messages/en.json so the spec follows the i18n source of
 * truth rather than duplicating strings.
 */
import type { Page, Route } from "@playwright/test";
import en from "../messages/en.json";
import { expect, test } from "./fixtures/test-with-pages";
import {
    MOCK_WALLET_EXECUTOR_JS,
    maybeFulfillMockWalletRequest,
    seedMockWalletAccount,
} from "./helpers/mock-wallet";

const TREASURY_ID = "requests-e2e-test.sputnik-dao.near";
const ACCOUNT_ID = "test.near";
const RECIPIENT = "a".repeat(64);
const REQUEST_ID = "a1b2c3d4e5f6";
const TX_HASH = "8xQkErrorStatesTestHash";

const errors = en.errors;
const codes = errors.codes;
const reasons = errors.reasons;

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

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

interface Envelope {
    code: string;
    funds_state: string;
    retryable: boolean;
    details?: { tx_hash?: string; reason?: string };
}

/** How the mocked relay answers the submit. */
type RelayBehaviour =
    | { kind: "envelope"; status: number; error: Envelope; requestId?: string }
    | { kind: "body"; status: number; body: unknown; requestId?: string }
    | { kind: "abort" }
    | { kind: "wallet-throws"; message: string };

interface Expected {
    title: string;
    /** Substrings the description must contain. */
    body?: string[];
    /** Substrings the description must NOT contain. */
    notBody?: string[];
    action?: { label: string; opens: string };
}

interface Case {
    name: string;
    relay: RelayBehaviour;
    expected: Expected;
}

const envelope = (status: number, error: Envelope): RelayBehaviour => ({
    kind: "envelope",
    status,
    error,
    requestId: REQUEST_ID,
});

const REQUESTS_URL = `/${TREASURY_ID}/requests?tab=InProgress`;
const EXPLORER_URL = `https://nearblocks.io/txns/${TX_HASH}`;
const CONTACT_US_URL = "https://trezu.org/contact-us";

const CASES: Case[] = [
    {
        name: "SPONSORSHIP_NOT_AVAILABLE (402)",
        relay: envelope(402, {
            code: "SPONSORSHIP_NOT_AVAILABLE",
            funds_state: "not_sent",
            retryable: false,
        }),
        expected: {
            title: codes.SPONSORSHIP_NOT_AVAILABLE.title,
            body: [codes.SPONSORSHIP_NOT_AVAILABLE.body],
            action: { label: errors.contactUs, opens: CONTACT_US_URL },
        },
    },
    {
        name: "NOT_AUTHORIZED (403)",
        relay: envelope(403, {
            code: "NOT_AUTHORIZED",
            funds_state: "not_sent",
            retryable: false,
        }),
        expected: {
            title: codes.NOT_AUTHORIZED.title,
            body: [codes.NOT_AUTHORIZED.body],
        },
    },
    {
        name: "REQUEST_REJECTED (400)",
        relay: envelope(400, {
            code: "REQUEST_REJECTED",
            funds_state: "not_sent",
            retryable: false,
        }),
        expected: {
            title: codes.REQUEST_REJECTED.title,
            body: [codes.REQUEST_REJECTED.body],
        },
    },
    {
        name: "RPC_UNAVAILABLE (502)",
        relay: envelope(502, {
            code: "RPC_UNAVAILABLE",
            funds_state: "not_sent",
            retryable: true,
        }),
        expected: {
            title: codes.RPC_UNAVAILABLE.title,
            body: [codes.RPC_UNAVAILABLE.body],
        },
    },
    {
        name: "TX_STATUS_UNKNOWN (504) offers the requests list, never a retry",
        relay: envelope(504, {
            code: "TX_STATUS_UNKNOWN",
            funds_state: "unknown",
            retryable: false,
            details: { tx_hash: TX_HASH },
        }),
        expected: {
            title: codes.TX_STATUS_UNKNOWN.title,
            body: [codes.TX_STATUS_UNKNOWN.body],
            action: { label: errors.viewRequests, opens: REQUESTS_URL },
        },
    },
    ...(Object.keys(reasons) as (keyof typeof reasons)[]).map(
        (reason): Case => ({
            name: `TX_FAILED (422) · ${reason}`,
            relay: envelope(422, {
                code: "TX_FAILED",
                funds_state: "failed_onchain",
                retryable: false,
                details: { tx_hash: TX_HASH, reason },
            }),
            expected: {
                title: codes.TX_FAILED.title,
                body: [reasons[reason]],
                // Only a failure we can't explain sends the user to the explorer.
                action:
                    reason === "UNKNOWN"
                        ? { label: errors.viewOnExplorer, opens: EXPLORER_URL }
                        : undefined,
            },
        }),
    ),
    {
        name: "TX_FAILED · UNKNOWN without a tx hash has no explorer link",
        relay: envelope(422, {
            code: "TX_FAILED",
            funds_state: "failed_onchain",
            retryable: false,
            details: { reason: "UNKNOWN" },
        }),
        expected: {
            title: codes.TX_FAILED.title,
            body: [reasons.UNKNOWN],
        },
    },
    {
        name: "TX_FAILED with a reason the client does not know falls back to UNKNOWN text",
        relay: envelope(422, {
            code: "TX_FAILED",
            funds_state: "failed_onchain",
            retryable: false,
            details: { tx_hash: TX_HASH, reason: "SOMETHING_NEW" },
        }),
        expected: {
            title: codes.TX_FAILED.title,
            body: [reasons.UNKNOWN],
            action: { label: errors.viewOnExplorer, opens: EXPLORER_URL },
        },
    },
    {
        name: "UNEXPECTED (500)",
        relay: envelope(500, {
            code: "UNEXPECTED",
            funds_state: "not_sent",
            retryable: true,
        }),
        expected: {
            title: codes.UNEXPECTED.title,
            body: [codes.UNEXPECTED.body],
        },
    },
    {
        name: "a code the client does not know falls back to UNEXPECTED",
        relay: envelope(500, {
            code: "BRAND_NEW_CODE",
            funds_state: "none",
            retryable: true,
        }),
        expected: {
            title: codes.UNEXPECTED.title,
            body: [codes.UNEXPECTED.body],
        },
    },
    {
        name: "a response without x-request-id renders the same toast",
        relay: {
            kind: "envelope",
            status: 500,
            error: {
                code: "UNEXPECTED",
                funds_state: "not_sent",
                retryable: true,
            },
        },
        expected: {
            title: codes.UNEXPECTED.title,
            body: [codes.UNEXPECTED.body],
        },
    },
    {
        name: "legacy 5xx string body never claims funds were untouched",
        relay: {
            kind: "body",
            status: 500,
            body: { success: false, error: "Failed to relay: boom" },
            requestId: REQUEST_ID,
        },
        expected: {
            title: codes.UNEXPECTED.title,
            body: [codes.UNEXPECTED.body],
            notBody: ["boom", "No funds were moved", "nothing was sent"],
        },
    },
    {
        name: "503 with no envelope is SERVICE_UNAVAILABLE",
        relay: { kind: "body", status: 503, body: "Service Unavailable" },
        expected: {
            title: codes.SERVICE_UNAVAILABLE.title,
            body: [codes.SERVICE_UNAVAILABLE.body],
        },
    },
    {
        name: "no response at all (backend down) is SERVICE_UNAVAILABLE",
        relay: { kind: "abort" },
        expected: {
            title: codes.SERVICE_UNAVAILABLE.title,
            body: [codes.SERVICE_UNAVAILABLE.body],
        },
    },
    {
        name: "wallet decline keeps the plain 'not approved' toast",
        relay: { kind: "wallet-throws", message: "User rejected the request" },
        expected: {
            title: en.nearStore.transactionNotApproved,
        },
    },
    {
        name: "wallet signing failure is WALLET_FAILED",
        relay: { kind: "wallet-throws", message: "couldnt_parse_arg_tx" },
        expected: {
            title: codes.WALLET_FAILED.title,
            body: [codes.WALLET_FAILED.body],
        },
    },
];

async function setupMocks(page: Page, relay: RelayBehaviour) {
    await seedMockWalletAccount(page, ACCOUNT_ID, "init");
    await page.addInitScript(() => {
        localStorage.setItem("payments-bulk-tour-shown:v1", "true");
        // Toast actions navigate via window.open; record instead of opening.
        const opened: string[] = [];
        (window as unknown as { __opened: string[] }).__opened = opened;
        window.open = ((url: string | URL) => {
            opened.push(String(url));
            return null;
        }) as typeof window.open;
    });

    await page.route("**/*", async (route) => {
        if (await maybeFulfillMockWalletRequest(route)) return;
        const url = route.request().url();

        if (url.includes("/auth/me")) {
            return json(route, { accountId: ACCOUNT_ID, termsAccepted: true });
        }
        if (url.includes("/treasury/creation-status")) {
            return json(route, { creationAvailable: true });
        }
        if (url.includes("/user/treasuries")) {
            return json(route, [
                {
                    daoId: TREASURY_ID,
                    config: { name: "Error States E2E", metadata: {} },
                    isMember: true,
                    isSaved: true,
                    isHidden: false,
                },
            ]);
        }
        if (url.includes("/treasury/policy")) return json(route, POLICY);
        if (url.includes("/user/assets")) return json(route, ASSETS);
        if (
            url.includes("/intents/deposit-tokens") ||
            url.includes("/intents/swap-tokens")
        ) {
            return json(route, { assets: [] });
        }
        if (url.includes("/address-book")) return json(route, []);
        if (url.includes("/chains")) return json(route, []);
        if (url.includes("/warnings")) return json(route, { warnings: [] });
        if (url.includes("/monitored-accounts")) {
            return json(route, { accountId: TREASURY_ID, enabled: true });
        }
        if (url.includes("/subscription/")) {
            return json(route, {
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

    // Registered after the catch-all so they take precedence.

    // The mock executor signs through the sandbox's :4000 helper, which is not
    // published from the container; the relay is mocked, so a stub suffices.
    await page.route("**/_test/sign-delegate-action", (route) =>
        json(route, { signedDelegateAction: { stub: true } }),
    );

    if (relay.kind === "wallet-throws") {
        const throwing = MOCK_WALLET_EXECUTOR_JS.replace(
            "async signDelegateActions(p) {",
            `async signDelegateActions(p) { throw new Error(${JSON.stringify(relay.message)});`,
        );
        await page.route("**/_near-connect-test/mock-wallet.js*", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/javascript",
                body: throwing,
            }),
        );
    }

    await page.route("**/relay/delegate-action", async (route) => {
        switch (relay.kind) {
            case "abort":
                return route.abort("connectionrefused");
            case "envelope":
            case "body": {
                const body =
                    relay.kind === "envelope"
                        ? { error: relay.error }
                        : relay.body;
                return route.fulfill({
                    status: relay.status,
                    contentType:
                        typeof body === "string"
                            ? "text/plain"
                            : "application/json",
                    headers: {
                        "access-control-expose-headers": "x-request-id",
                        ...(relay.requestId
                            ? { "x-request-id": relay.requestId }
                            : {}),
                    },
                    body:
                        typeof body === "string" ? body : JSON.stringify(body),
                });
            }
            case "wallet-throws":
                // Never reached: the wallet throws before the relay.
                return json(route, { success: true, txHash: TX_HASH });
        }
    });
}

test.describe("Error states — sponsored transaction failures", () => {
    for (const { name, relay, expected } of CASES) {
        test(name, async ({ page, paymentsPage }) => {
            await setupMocks(page, relay);
            await paymentsPage.goto(TREASURY_ID, {
                token: "NEAR",
                network: "near",
            });

            await paymentsPage.amountInput().fill("1");
            await paymentsPage.recipientInput().fill(RECIPIENT);
            await expect(paymentsPage.reviewButton()).toBeEnabled({
                timeout: 15_000,
            });
            await paymentsPage.reviewButton().click();
            await expect(paymentsPage.reviewHeading()).toBeVisible();
            await page
                .getByRole("button", { name: en.payments.confirmSubmit })
                .click();

            const toast = page.locator("[data-sonner-toast]").last();
            await expect(toast).toBeVisible({ timeout: 20_000 });
            await expect(toast.locator("[data-title]")).toHaveText(
                expected.title,
            );

            const description = toast.locator("[data-description]");
            for (const fragment of expected.body ?? []) {
                await expect(description).toContainText(fragment);
            }
            for (const fragment of expected.notBody ?? []) {
                await expect(description).not.toContainText(fragment);
            }
            // The request id is for logs and support, never shown to the user.
            await expect(toast).not.toContainText(REQUEST_ID);

            // Keep a picture of the toast before the action click dismisses it.
            const shot = test.info().outputPath("toast.png");
            await toast.screenshot({ path: shot });
            await test.info().attach("toast", {
                path: shot,
                contentType: "image/png",
            });

            const action = toast.locator("[data-button]");
            if (expected.action) {
                await expect(action).toHaveText(expected.action.label);
                await action.click();
                await expect
                    .poll(() =>
                        page.evaluate(
                            () =>
                                (window as unknown as { __opened: string[] })
                                    .__opened,
                        ),
                    )
                    .toEqual([expected.action.opens]);
            } else {
                await expect(action).toHaveCount(0);
            }

            // One primary action, one toast: nothing else stacked on top.
            await expect(page.locator("[data-sonner-toast]")).toHaveCount(1);
        });
    }
});

/**
 * The durable relay answers `202` when the result is not known within the
 * request. No stream event is delivered here (the relay is mocked), so these
 * prove the page finds the outcome by reading the status endpoint itself.
 */
test.describe("Pending relay — the result arrives by status read", () => {
    const SUBMISSION_ID = "5f0c2a9e-0000-4000-8000-00000000e2e0";
    const pending = {
        submissionId: SUBMISSION_ID,
        treasuryId: TREASURY_ID,
        state: "pending",
    };
    const confirming = en.nearStore.confirmingTransaction;

    async function submitPayment(
        page: Page,
        paymentsPage: {
            goto: (
                id: string,
                o: { token: string; network: string },
            ) => Promise<void>;
            amountInput: () => ReturnType<Page["locator"]>;
            recipientInput: () => ReturnType<Page["locator"]>;
            reviewButton: () => ReturnType<Page["locator"]>;
            reviewHeading: () => ReturnType<Page["locator"]>;
        },
    ) {
        await paymentsPage.goto(TREASURY_ID, {
            token: "NEAR",
            network: "near",
        });
        await paymentsPage.amountInput().fill("1");
        await paymentsPage.recipientInput().fill(RECIPIENT);
        await expect(paymentsPage.reviewButton()).toBeEnabled({
            timeout: 15_000,
        });
        await paymentsPage.reviewButton().click();
        await expect(paymentsPage.reviewHeading()).toBeVisible();
        await page
            .getByRole("button", { name: en.payments.confirmSubmit })
            .click();
    }

    const pendingIds = (page: Page) =>
        page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]") as string[],
            `relay:pending:${TREASURY_ID}`,
        );

    test("pending, then succeeded on a later read", async ({
        page,
        paymentsPage,
    }) => {
        await setupMocks(page, { kind: "body", status: 202, body: pending });
        let reads = 0;
        await page.route("**/relay/submissions/*", (route) => {
            reads += 1;
            return json(
                route,
                reads < 2
                    ? pending
                    : {
                          ...pending,
                          state: "succeeded",
                          txHash: TX_HASH,
                          proposalIds: [7],
                      },
            );
        });
        await submitPayment(page, paymentsPage);

        const waiting = page
            .locator("[data-sonner-toast]")
            .filter({ hasText: confirming });
        await expect(waiting).toBeVisible({ timeout: 20_000 });
        expect(await pendingIds(page)).toEqual([SUBMISSION_ID]);

        await expect(waiting).toHaveCount(0, { timeout: 10_000 });
        expect(reads).toBeGreaterThanOrEqual(2);
        expect(await pendingIds(page)).toEqual([]);
        await expect(
            page
                .locator("[data-sonner-toast]")
                .filter({ hasText: codes.TX_STATUS_UNKNOWN.title }),
        ).toHaveCount(0);
    });

    test("pending, then refused by the worker", async ({
        page,
        paymentsPage,
    }) => {
        await setupMocks(page, { kind: "body", status: 202, body: pending });
        await page.route("**/relay/submissions/*", (route) =>
            json(route, {
                ...pending,
                state: "failed",
                error: {
                    code: "NOT_AUTHORIZED",
                    funds_state: "not_sent",
                    retryable: false,
                    details: {},
                },
            }),
        );
        await submitPayment(page, paymentsPage);

        const toast = page
            .locator("[data-sonner-toast]")
            .filter({ hasText: codes.NOT_AUTHORIZED.title });
        await expect(toast).toBeVisible({ timeout: 20_000 });
        await expect(
            page.locator("[data-sonner-toast]").filter({ hasText: confirming }),
        ).toHaveCount(0);
        expect(await pendingIds(page)).toEqual([]);
    });

    test("a refused status read keeps waiting and keeps the id", async ({
        page,
        paymentsPage,
    }) => {
        await setupMocks(page, { kind: "body", status: 202, body: pending });
        let reads = 0;
        await page.route("**/relay/submissions/*", (route) => {
            reads += 1;
            return json(route, { error: "Authentication required" }, 401);
        });
        await submitPayment(page, paymentsPage);

        const waiting = page
            .locator("[data-sonner-toast]")
            .filter({ hasText: confirming });
        await expect(waiting).toBeVisible({ timeout: 20_000 });
        await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThan(0);
        const afterFirst = reads;
        // Several poll intervals later nothing more was asked.
        await page.waitForTimeout(6_000);
        expect(reads).toBe(afterFirst);
        await expect(waiting).toBeVisible();
        expect(await pendingIds(page)).toEqual([SUBMISSION_ID]);
    });
});

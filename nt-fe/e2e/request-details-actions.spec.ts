import { expect, type Page, type Route, test } from "@playwright/test";
import {
    maybeFulfillMockWalletRequest,
    seedMockWalletAccount,
} from "./helpers/mock-wallet";

/**
 * Regression coverage for issue #1719: on Request details the Delete action
 * must sit next to Copy link, and the insufficient-balance CTA must read
 * "Receive" (not "Deposit").
 *
 * Server-side calls (getTreasuryConfig in layout.tsx) hit the sandbox backend,
 * so TREASURY_ID must be one of the treasuries seeded by global-setup.ts.
 */
const TREASURY_ID = "webassemblymusic-treasury.sputnik-dao.near";
const ACCOUNT_ID = "test.near";
const PROPOSAL_ID = 7;

const ONE_NEAR = "1000000000000000000000000";
const TENTH_NEAR = "100000000000000000000000";

const TREASURY_POLICY = {
    roles: [
        {
            name: "council",
            kind: { Group: [ACCOUNT_ID] },
            permissions: [
                "*:AddProposal",
                "*:VoteApprove",
                "*:VoteReject",
                "*:VoteRemove",
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
    bounty_bond: "100000000000000000000000",
    bounty_forgiveness_period: "604800000000000",
};

/** The treasury holds 0.1 NEAR, less than the 1 NEAR the request sends. */
const TREASURY_ASSETS = [
    {
        id: "near",
        contractId: null,
        residency: "Near",
        network: "near",
        chainName: "Near Protocol",
        symbol: "NEAR",
        balance: { Standard: { total: TENTH_NEAR, locked: "0" } },
        decimals: 24,
        price: "1.05",
        name: "Near",
        icon: "https://s2.coinmarketcap.com/static/img/coins/128x128/6535.png",
        chainIcons: {
            icon: "https://near.com/static/icons/network/near.svg",
        },
    },
];

/**
 * The signed-in user's own pending, not-yet-voted NEAR transfer, in the
 * backend's snake_case shape. Submitted an hour ago so it is well inside the
 * policy's 7-day proposal period.
 */
function buildPendingTransfer() {
    const submittedMs = BigInt(Date.now() - 60 * 60 * 1000);
    return {
        id: PROPOSAL_ID,
        proposer: ACCOUNT_ID,
        description: "Payment to bob",
        kind: {
            Transfer: {
                token_id: "",
                receiver_id: "bob.near",
                amount: ONE_NEAR,
                msg: null,
            },
        },
        status: "InProgress",
        vote_counts: {},
        votes: {},
        submission_time: (submittedMs * 1_000_000n).toString(),
        last_actions_log: null,
    };
}

function fulfillJson(route: Route, body: unknown) {
    return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

async function setupMocks(page: Page) {
    const proposal = buildPendingTransfer();
    await seedMockWalletAccount(page, ACCOUNT_ID, "init");

    await page.route("**/*", async (route) => {
        if (await maybeFulfillMockWalletRequest(route)) return;

        const url = route.request().url();

        if (url.includes("/auth/me")) {
            return fulfillJson(route, {
                accountId: ACCOUNT_ID,
                termsAccepted: true,
            });
        }
        if (url.includes("/treasury/creation-status")) {
            return fulfillJson(route, { creationAvailable: true });
        }
        if (url.includes("/user/treasuries")) {
            return fulfillJson(route, [
                {
                    daoId: TREASURY_ID,
                    config: {
                        name: "Requests E2E Test Treasury",
                        purpose: "Testing",
                        metadata: {},
                    },
                    isMember: true,
                    isSaved: true,
                    isHidden: false,
                },
            ]);
        }
        if (url.includes("/treasury/policy")) {
            return fulfillJson(route, TREASURY_POLICY);
        }
        if (url.includes("/user/assets")) {
            return fulfillJson(route, TREASURY_ASSETS);
        }
        if (url.includes("/monitored-accounts")) {
            return fulfillJson(route, {
                accountId: TREASURY_ID,
                enabled: true,
                planType: "free",
            });
        }
        // Single request: GET /api/proposal/{dao}/{id}
        if (url.includes(`/api/proposal/${TREASURY_ID}/${PROPOSAL_ID}`)) {
            return fulfillJson(route, proposal);
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}/proposers`)) {
            return fulfillJson(route, { proposers: [ACCOUNT_ID], total: 1 });
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}/approvers`)) {
            return fulfillJson(route, { approvers: [], total: 0 });
        }
        // Requests list: GET /api/proposals/{dao}?...
        if (url.includes(`/api/proposals/${TREASURY_ID}`)) {
            return fulfillJson(route, {
                page: 0,
                page_size: 15,
                total: 1,
                proposals: [proposal],
            });
        }

        return route.continue();
    });
}

test.use({ locale: "en-US" });

for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
]) {
    test.describe(`Request details page (${viewport.name})`, () => {
        test.use({
            viewport: { width: viewport.width, height: viewport.height },
        });

        /**
         * Scenario: SC-001: Delete sits next to Copy link in the header
         * Requirement: REQ-1 / issue #1719
         * Priority: P2
         */
        test("Delete and Copy link header actions are grouped on the right", async ({
            page,
        }) => {
            await setupMocks(page);

            await test.step("open the user's own pending request", async () => {
                const proposalResp = page.waitForResponse((r) =>
                    r
                        .url()
                        .includes(`/api/proposal/${TREASURY_ID}/${PROPOSAL_ID}`),
                );
                await page.goto(`/${TREASURY_ID}/requests/${PROPOSAL_ID}`);
                await proposalResp;
            });

            const deleteButton = page.getByRole("button", {
                name: "Delete request",
            });
            const copyButton = page.getByRole("button", { name: "Copy link" });
            await expect(deleteButton).toBeVisible({ timeout: 15000 });
            await expect(copyButton).toBeVisible();

            const deleteBox = await deleteButton.boundingBox();
            const copyBox = await copyButton.boundingBox();
            expect(deleteBox).not.toBeNull();
            expect(copyBox).not.toBeNull();
            if (!deleteBox || !copyBox) return;

            // Same row, Delete directly left of Copy. The bug let the header's
            // justify-between spread them hundreds of px apart.
            expect(Math.abs(deleteBox.y - copyBox.y)).toBeLessThanOrEqual(2);
            const gap = copyBox.x - (deleteBox.x + deleteBox.width);
            expect(
                gap,
                `gap between Delete and Copy link was ${gap}px`,
            ).toBeGreaterThanOrEqual(0);
            expect(
                gap,
                `gap between Delete and Copy link was ${gap}px`,
            ).toBeLessThanOrEqual(16);

            // The group hugs the right edge of the viewport.
            const rightInset = viewport.width - (copyBox.x + copyBox.width);
            expect(
                rightInset,
                `Copy link should hug the right edge, inset was ${rightInset}px`,
            ).toBeLessThanOrEqual(64);
        });

        /**
         * Scenario: SC-002: insufficient-balance CTA reads "Receive"
         * Requirement: REQ-2 / issue #1719
         * Priority: P2
         */
        test("insufficient-balance action is labelled Receive, not Deposit", async ({
            page,
        }) => {
            await setupMocks(page);
            await page.goto(`/${TREASURY_ID}/requests/${PROPOSAL_ID}`);

            const main = page.locator("main");
            await expect(
                main.getByRole("button", { name: "Receive", exact: true }),
            ).toBeVisible({ timeout: 15000 });
            // The shortfall CTA replaces Approve, and the old label is gone.
            await expect(
                main.getByRole("button", { name: "Deposit", exact: true }),
            ).toHaveCount(0);
            await expect(
                main.getByRole("button", { name: "Approve", exact: true }),
            ).toHaveCount(0);
        });
    });
}

/**
 * Scenario: SC-003: the Requests list side sheet uses the same CTA label
 * Requirement: REQ-2 / issue #1719
 * Priority: P3
 */
test("Requests side sheet shows Receive for an underfunded request", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMocks(page);
    await page.goto(`/${TREASURY_ID}/requests`);

    // Row 0 is the table header; row 1 is the mocked request.
    const requestRow = page.getByRole("row").nth(1);
    await expect(requestRow).toBeVisible({ timeout: 15000 });
    await requestRow.click();

    const sheet = page.getByRole("dialog");
    await expect(
        sheet.getByRole("button", { name: "Receive", exact: true }),
    ).toBeVisible();
    await expect(
        sheet.getByRole("button", { name: "Deposit", exact: true }),
    ).toHaveCount(0);
});

/**
 * Scenario: SC-004: the Dashboard pending-requests widget uses the same label
 * Requirement: REQ-2 / issue #1719
 * Priority: P3
 */
test("Dashboard pending request shows Receive for an underfunded request", async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupMocks(page);
    await page.goto(`/${TREASURY_ID}/dashboard`);

    // Scope to the widget's card for this request: the Dashboard has its own
    // unrelated "Receive" action. The card is a link without an accessible
    // name of its own, so the href is the stable handle.
    const card = page
        .locator("main")
        .locator(`a[href="/${TREASURY_ID}/requests/${PROPOSAL_ID}"]`);
    // From `sm` up the card reveals its actions on hover only.
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.hover();
    await expect(
        card.getByRole("button", { name: "Receive", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
        card.getByRole("button", { name: "Deposit", exact: true }),
    ).toHaveCount(0);
});

import { expect, type Page, type Route, test } from "@playwright/test";
import {
    maybeFulfillMockWalletRequest,
    seedMockWalletAccount,
} from "./helpers/mock-wallet";

/**
 * Coverage for issue #1610: on a phone, pulling a bottom sheet down by its
 * title bar dismisses it, the way native sheets do.
 *
 * Server-side calls (getTreasuryConfig in layout.tsx) hit the sandbox backend,
 * so TREASURY_ID must be one of the treasuries seeded by global-setup.ts.
 */
const TREASURY_ID = "webassemblymusic-treasury.sputnik-dao.near";
const ACCOUNT_ID = "test.near";

const TREASURY_POLICY = {
    roles: [
        {
            name: "council",
            kind: { Group: [ACCOUNT_ID] },
            permissions: ["*:AddProposal", "*:VoteApprove", "*:VoteReject"],
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

const PROPOSAL = {
    id: 1,
    proposer: ACCOUNT_ID,
    description: "Payment to bob",
    kind: {
        Transfer: {
            token_id: "",
            receiver_id: "bob.near",
            amount: "1000000000000000000000000",
            msg: null,
        },
    },
    status: "InProgress",
    vote_counts: {},
    votes: {},
    submission_time: (
        BigInt(Date.now() - 60 * 60 * 1000) * 1_000_000n
    ).toString(),
    last_actions_log: null,
};

function fulfillJson(route: Route, body: unknown) {
    return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

async function setupMocks(page: Page) {
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
        if (url.includes("/user/treasuries")) {
            return fulfillJson(route, [
                {
                    daoId: TREASURY_ID,
                    config: { name: "Pull To Close", metadata: {} },
                    isMember: true,
                    isSaved: true,
                    isHidden: false,
                },
            ]);
        }
        if (url.includes("/treasury/policy")) {
            return fulfillJson(route, TREASURY_POLICY);
        }
        if (url.includes(`/api/proposal/${TREASURY_ID}/${PROPOSAL.id}`)) {
            return fulfillJson(route, PROPOSAL);
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}/proposers`)) {
            return fulfillJson(route, { proposers: [ACCOUNT_ID], total: 1 });
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}/approvers`)) {
            return fulfillJson(route, { approvers: [], total: 0 });
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}`)) {
            return fulfillJson(route, {
                page: 0,
                page_size: 15,
                total: 1,
                proposals: [PROPOSAL],
            });
        }

        return route.continue();
    });
}

/** Opens the request's Details sheet and returns its title bar's centre. */
async function openDetailsSheet(page: Page) {
    await page.goto(`/${TREASURY_ID}/requests`);
    await page
        .locator("main")
        .getByRole("button", { name: "View request" })
        .click({ timeout: 15000 });

    const sheet = page.getByRole("dialog");
    const title = sheet.getByRole("heading", { name: "Details" });
    await expect(title).toBeVisible();
    // Let the slide-in finish so the measured position is where it rests.
    await sheet.evaluate((el) =>
        Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    const box = await title.boundingBox();
    if (!box) throw new Error("Details title has no box");
    return { sheet, x: box.x + 10, y: box.y + box.height / 2 };
}

/** Pulls from (x, y) down by `distance`, holds still, then lets go. */
async function pullAndHold(page: Page, x: number, y: number, distance: number) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + distance, { steps: 10 });
    // Long enough that the release reads as a stop, not a flick.
    await page.waitForTimeout(300);
    await page.mouse.up();
}

test.use({ locale: "en-US", viewport: { width: 440, height: 956 } });

test.describe("Pull-to-close on a mobile sheet", () => {
    test.beforeEach(async ({ page }) => {
        await setupMocks(page);
    });

    /**
     * Scenario: SC-001: a long pull on the title bar dismisses the sheet
     * Requirement: issue #1610
     * Priority: P2
     */
    test("pulling the title bar past a quarter of the sheet closes it", async ({
        page,
    }) => {
        const { sheet, x, y } = await openDetailsSheet(page);
        const sheetBox = await sheet.boundingBox();
        if (!sheetBox) throw new Error("sheet has no box");

        await pullAndHold(page, x, y, sheetBox.height * 0.4);

        await expect(sheet).toBeHidden();
    });

    /**
     * Scenario: SC-002: a short pull springs the sheet back
     * Requirement: issue #1610
     * Priority: P2
     */
    test("a short pull lets the sheet spring back open", async ({ page }) => {
        const { sheet, x, y } = await openDetailsSheet(page);
        const restingTop = (await sheet.boundingBox())?.y;

        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + 100, { steps: 10 });
        // Mid-pull the sheet follows the pointer.
        await expect
            .poll(async () => (await sheet.boundingBox())?.y)
            .toBeCloseTo((restingTop ?? 0) + 100, 0);
        await page.waitForTimeout(300);
        await page.mouse.up();

        await expect(sheet).toBeVisible();
        await expect
            .poll(async () => (await sheet.boundingBox())?.y)
            .toBeCloseTo(restingTop ?? 0, 0);
    });

    /**
     * Scenario: SC-003: a quick flick dismisses even a short pull
     * Requirement: issue #1610
     * Priority: P3
     */
    test("a quick short flick closes the sheet", async ({ page }) => {
        const { sheet, x, y } = await openDetailsSheet(page);

        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + 100, { steps: 3 });
        await page.mouse.up();

        await expect(sheet).toBeHidden();
    });
});

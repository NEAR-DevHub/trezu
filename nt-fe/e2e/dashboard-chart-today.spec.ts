import { expect, type Page, test } from "@playwright/test";
import ROMAKQA_ASSETS from "./fixtures/romakqa-assets.json";
import {
    maybeFulfillMockWalletRequest,
    seedMockWalletAccount,
} from "./helpers/mock-wallet";

/**
 * Regression for GitHub issue #1659: the backend grid ends with a bucket at
 * the exact request end time and, east of UTC, today's midnight bucket also
 * formats as today's date, so the dashboard showed "Sep 17, Sep 17, Now"
 * with three different values. Today's buckets must collapse into the single
 * live "Now" point, for the all-tokens and the selected-token chart alike.
 *
 * @see https://github.com/NEAR-DevHub/trezu/issues/1659
 */

const TREASURY_ID = "romakqatesting.sputnik-dao.near";
const ACCOUNT_ID = "test.near";

// 23:49 in Kyiv on Sep 17: today's midnight-UTC bucket still formats as
// Sep 17 locally, the case the issue was reported from.
const FIXED_NOW = new Date("2026-09-17T20:49:00Z");
const TODAY_LABEL = "Sep 17";
const PAST_WEEK_LABELS = [
    "Sep 11",
    "Sep 12",
    "Sep 13",
    "Sep 14",
    "Sep 15",
    "Sep 16",
];

test.use({ locale: "en-US", timezoneId: "Europe/Kyiv" });

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

const SUBSCRIPTION = {
    accountId: TREASURY_ID,
    planType: "free",
    planConfig: {
        planType: "free",
        name: "Free",
        description: "Free plan",
        limits: {
            monthlyVolumeLimitCents: null,
            overageRateBps: 0,
            exchangeFeeBps: 0,
            monthlyExportCredits: null,
            trialExportCredits: 100,
            monthlyBatchPaymentCredits: null,
            trialBatchPaymentCredits: 50,
            gasCoveredTransactions: null,
            historyLookupMonths: 3,
        },
        pricing: { monthlyPriceCents: null, yearlyPriceCents: null },
    },
    exportCredits: 100,
    batchPaymentCredits: 50,
    gasCoveredTransactions: 100,
    creditsResetAt: "2026-10-01T00:00:00Z",
    monthlyUsedVolumeCents: 0,
};

/** What the backend returns for a 1W daily request ending at FIXED_NOW. */
function pastWeekBuckets(): Date[] {
    const midnights = Array.from(
        { length: 7 },
        (_, i) => new Date(Date.UTC(2026, 8, 11 + i)),
    );
    return [...midnights, FIXED_NOW];
}

function series(buckets: Date[], balance: string, priceUsd: number) {
    return buckets.map((bucket) => ({
        timestamp: bucket.toISOString(),
        balance,
        priceUsd,
        valueUsd: Number(balance) * priceUsd,
    }));
}

function chartResponse(buckets: Date[]) {
    return {
        near: series(buckets, "1.5", 1.02),
        "wrap.near": series(buckets, "1.68", 1.02),
        "usdt.tether-token.near": series(buckets, "0.11", 1),
        chartMeta: { status: "ok" },
    };
}

/** Mocks the whole dashboard shell so the spec needs no backend. */
async function setupMocks(page: Page, chart: object) {
    await seedMockWalletAccount(page, ACCOUNT_ID, "init");

    const responses: Array<[string[], unknown]> = [
        [["/auth/me"], { accountId: ACCOUNT_ID, termsAccepted: true }],
        [["/treasury/creation-status"], { creationAvailable: true }],
        [
            ["/user/treasuries"],
            [
                {
                    daoId: TREASURY_ID,
                    config: {
                        name: "Romakqa Testing Treasury",
                        purpose: "Testing",
                        metadata: {},
                    },
                    isMember: true,
                    isSaved: true,
                    isHidden: false,
                },
            ],
        ],
        [["/treasury/policy"], TREASURY_POLICY],
        [["/api/subscription/"], SUBSCRIPTION],
        [["/user/assets"], ROMAKQA_ASSETS],
        [["/proposals/"], { page: 0, page_size: 15, total: 0, proposals: [] }],
        [
            ["/api/monitored-accounts"],
            { accountId: TREASURY_ID, enabled: true, planType: "pro" },
        ],
        [["/balance-history/chart"], chart],
        [["/recent-activity"], { data: [], total: 0 }],
        [["/user/profile"], { name: "Test User" }],
        [["/address-book"], []],
    ];

    await page.route("**/*", async (route) => {
        if (await maybeFulfillMockWalletRequest(route)) {
            return;
        }
        const url = route.request().url();
        const match = responses.find(([needles]) =>
            needles.some((needle) => url.includes(needle)),
        );
        if (!match) {
            return route.continue();
        }
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(match[1]),
        });
    });
}

async function openDashboardAt(page: Page, chart: object) {
    await page.clock.setFixedTime(FIXED_NOW);
    await setupMocks(page, chart);
    await page.goto(`/${TREASURY_ID}`);
    await page
        .locator("[data-slot='chart']")
        .first()
        .locator("svg")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
}

async function getXAxisLabels(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const ticks = document.querySelectorAll(
            ".recharts-xAxis .recharts-cartesian-axis-tick text",
        );
        return Array.from(ticks).map((tick) => tick.textContent || "");
    });
}

/** One path command per point: M for the first, then C (monotone curve). */
async function getDataPointCount(page: Page): Promise<number> {
    return page.evaluate(() => {
        const d = document
            .querySelector(
                ".recharts-area-area path, .recharts-area .recharts-area-curve",
            )
            ?.getAttribute("d");
        return d ? (d.match(/[MCL]/g) || []).length : 0;
    });
}

async function expectLabels(page: Page, expected: string[]) {
    await expect
        .poll(() => getXAxisLabels(page), { timeout: 15_000 })
        .toEqual(expected);
}

test.describe("Dashboard chart collapses today into Now (issue #1659)", () => {
    test("all-tokens chart shows past days followed by exactly one Now", async ({
        page,
    }) => {
        await openDashboardAt(page, chartResponse(pastWeekBuckets()));

        await expectLabels(page, [...PAST_WEEK_LABELS, "Now"]);
        const labels = await getXAxisLabels(page);
        expect(labels.filter((l) => l === "Now")).toHaveLength(1);
        expect(labels).not.toContain(TODAY_LABEL);
        expect(await getDataPointCount(page)).toBe(PAST_WEEK_LABELS.length + 1);
    });

    test("selected-token chart shows past days followed by exactly one Now", async ({
        page,
    }) => {
        await openDashboardAt(page, chartResponse(pastWeekBuckets()));

        // The fixture's wNEAR assets are displayed as NEAR; the menu item's
        // accessible name is the icon alt plus the symbol.
        await page.getByTestId("chart-token-trigger").click();
        await page.getByRole("menuitem", { name: "NEAR NEAR" }).click();
        await expect(page.getByTestId("chart-token-trigger")).toContainText(
            "NEAR",
        );

        await expectLabels(page, [...PAST_WEEK_LABELS, "Now"]);
        const labels = await getXAxisLabels(page);
        expect(labels.filter((l) => l === "Now")).toHaveLength(1);
        expect(labels).not.toContain(TODAY_LABEL);
        expect(await getDataPointCount(page)).toBe(PAST_WEEK_LABELS.length + 1);
    });

    test("treasury with today-only history still charts a Now point", async ({
        page,
    }) => {
        // A treasury created today gets only the trailing end-time bucket.
        await openDashboardAt(page, chartResponse([FIXED_NOW]));

        // Recharts draws no path segment for a lone point, so the tick label
        // and the absent empty state are the evidence that it charted. Other
        // dashboard widgets share empty-state copy, so scope to the chart.
        await expectLabels(page, ["Now"]);
        await expect(
            page.getByTestId("balance-chart").getByText("Loading your data"),
        ).toHaveCount(0);
    });
});

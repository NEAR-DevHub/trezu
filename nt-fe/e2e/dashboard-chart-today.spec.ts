import type { Page, Route } from "@playwright/test";
import ROMAKQA_ASSETS from "./fixtures/romakqa-assets.json";
import { expect, test } from "./fixtures/test-with-pages";
import { installTreasuryApiMocks } from "./mocks/treasury-api-mocks";

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

async function setupMocks(page: Page, chart: object) {
    await installTreasuryApiMocks(page, {
        accountId: "test.near",
        treasuryId: TREASURY_ID,
        treasuryName: "Romakqa Testing Treasury",
        assets: ROMAKQA_ASSETS,
        includeDashboardExtras: true,
    });
    // Registered after the shared installer so it takes precedence over its
    // empty chart response.
    await page.route("**/api/balance-history/chart*", (route: Route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(chart),
        }),
    );
}

async function openDashboardAt(
    page: Page,
    dashboardPage: { gotoPlain(id: string): Promise<void> },
    chart: object,
) {
    await page.clock.setFixedTime(FIXED_NOW);
    await setupMocks(page, chart);
    await dashboardPage.gotoPlain(TREASURY_ID);
}

async function expectLabels(
    dashboardPage: {
        chart: { getXAxisLabels(): Promise<{ text: string }[]> };
    },
    expected: string[],
) {
    await expect
        .poll(
            async () =>
                (await dashboardPage.chart.getXAxisLabels()).map((l) => l.text),
            { timeout: 15_000 },
        )
        .toEqual(expected);
}

test.describe("Dashboard chart collapses today into Now (issue #1659)", () => {
    test("all-tokens chart shows past days followed by exactly one Now", async ({
        page,
        dashboardPage,
    }) => {
        await openDashboardAt(
            page,
            dashboardPage,
            chartResponse(pastWeekBuckets()),
        );
        await dashboardPage.chart.waitForRendered();

        await expectLabels(dashboardPage, [...PAST_WEEK_LABELS, "Now"]);
        const labels = (await dashboardPage.chart.getXAxisLabels()).map(
            (l) => l.text,
        );
        expect(labels.filter((l) => l === "Now")).toHaveLength(1);
        expect(labels).not.toContain(TODAY_LABEL);
        expect(await dashboardPage.chart.getDataPointCount()).toBe(
            PAST_WEEK_LABELS.length + 1,
        );
    });

    test("selected-token chart shows past days followed by exactly one Now", async ({
        page,
        dashboardPage,
    }) => {
        await openDashboardAt(
            page,
            dashboardPage,
            chartResponse(pastWeekBuckets()),
        );
        await dashboardPage.chart.waitForRendered();

        // The fixture's wNEAR assets are displayed as NEAR; the menu item's
        // accessible name is the icon alt plus the symbol.
        await page.getByTestId("chart-token-trigger").click();
        await page.getByRole("menuitem", { name: "NEAR NEAR" }).click();
        await expect(page.getByTestId("chart-token-trigger")).toContainText(
            "NEAR",
        );

        await expectLabels(dashboardPage, [...PAST_WEEK_LABELS, "Now"]);
        const labels = (await dashboardPage.chart.getXAxisLabels()).map(
            (l) => l.text,
        );
        expect(labels.filter((l) => l === "Now")).toHaveLength(1);
        expect(labels).not.toContain(TODAY_LABEL);
        expect(await dashboardPage.chart.getDataPointCount()).toBe(
            PAST_WEEK_LABELS.length + 1,
        );
    });

    test("treasury with today-only history still charts a Now point", async ({
        page,
        dashboardPage,
    }) => {
        // A treasury created today gets only the trailing end-time bucket.
        await openDashboardAt(page, dashboardPage, chartResponse([FIXED_NOW]));
        await dashboardPage.chart.waitForRendered();

        // Recharts draws no path segment for a lone point, so the tick label
        // and the absent empty state are the evidence that it charted.
        await expectLabels(dashboardPage, ["Now"]);
        await expect(page.getByText("Nothing to show yet")).toHaveCount(0);
    });
});

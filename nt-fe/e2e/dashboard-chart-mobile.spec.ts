import type { Page, Route } from "@playwright/test";
import { ChartComponent } from "./components/chart.component";
import FINAL_ASSETS from "./fixtures/assets.json";
import { expect, test } from "./fixtures/test-with-pages";

const TREASURY_ID = "webassemblymusic-treasury.sputnik-dao.near";

// Use mobile viewport to reproduce the overlap issue
test.use({
    locale: "en-US",
    viewport: { width: 375, height: 667 },
});

const MONITORED_ACCOUNTS_RESPONSE = {
    accountId: TREASURY_ID,
    enabled: true,
    lastSyncedAt: "2026-02-18T10:00:00Z",
    createdAt: "2026-01-27T16:47:58.759890Z",
    updatedAt: "2026-02-18T10:00:00Z",
    exportCredits: 5,
    batchPaymentCredits: 10,
    planType: "plus",
    creditsResetAt: "2026-03-01T00:00:00Z",
    dirtyAt: "2026-02-18T10:00:00Z",
    isNewRegistration: false,
};

/**
 * Generate 90 daily chart data points for a 3-month period.
 * This simulates what the backend returns for a 3M daily interval.
 */
function generate3MonthChartData(): Array<{
    timestamp: string;
    balance: string;
    valueUsd: number;
}> {
    const points = [];
    const endDate = new Date("2026-02-18T00:00:00Z");

    for (let i = 89; i >= 0; i--) {
        const date = new Date(endDate.getTime() - i * 24 * 60 * 60 * 1000);
        // Simulate a gradual balance increase with some noise
        const baseValue = 1000 + (90 - i) * 5 + Math.sin(i) * 50;
        points.push({
            timestamp: date.toISOString(),
            balance: baseValue.toFixed(2),
            valueUsd: baseValue,
        });
    }

    return points;
}

async function setupMocks(page: Page) {
    await page.route("**/api/monitored-accounts", async (route: Route) => {
        const method = route.request().method();
        if (method === "POST") {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(MONITORED_ACCOUNTS_RESPONSE),
            });
        } else if (method === "OPTIONS") {
            await route.fulfill({ status: 200 });
        } else {
            await route.continue();
        }
    });

    await page.route("**/api/user/assets*", async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(FINAL_ASSETS),
        });
    });

    await page.route("**/api/balance-history/chart*", async (route: Route) => {
        const url = new URL(route.request().url());
        const tokenIds = url.searchParams.get("tokenIds");
        const ids = tokenIds ? tokenIds.split(",") : ["all"];

        const response: Record<string, any[]> = {};
        const chartData = generate3MonthChartData();
        for (const id of ids) {
            response[id] = chartData;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(response),
        });
    });

    await page.route("**/api/recent-activity*", async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: [], total: 0 }),
        });
    });
}

// ---------- Test ----------

test("dashboard chart x-axis labels should not overlap on mobile with 3M period", async ({
    page,
    dashboardPage,
}) => {
    test.setTimeout(60_000);

    await setupMocks(page);
    await dashboardPage.gotoPlain(TREASURY_ID);

    // Wait for the chart to render with default period (1W)
    await dashboardPage.chart.waitForRendered();

    // On mobile, the time period selector is a <select> dropdown (md:hidden variant)
    await dashboardPage.chart.selectMobilePeriod("3M");

    // Wait for chart to re-render with 3M data
    await dashboardPage.chart.waitForRendered(10_000);
    // Give recharts time to fully render the axis labels
    await page.waitForTimeout(1000);

    // Collect bounding boxes of all x-axis tick labels
    const tickBoundingBoxes = await dashboardPage.chart.getXAxisLabels();

    // Verify we actually have tick labels rendered
    expect(tickBoundingBoxes.length).toBeGreaterThan(0);
    console.log(
        `Found ${tickBoundingBoxes.length} x-axis tick labels:`,
        tickBoundingBoxes.map((t) => t.text),
    );

    // Check for overlapping labels: each label's left edge should be
    // to the right of (or equal to) the previous label's right edge
    const overlaps = ChartComponent.findOverlaps(tickBoundingBoxes);

    if (overlaps.length > 0) {
        console.log("Overlapping labels detected:", overlaps);
    }

    // Take a screenshot for visual verification
    await page.screenshot({
        path: "test-results/dashboard-chart-mobile-3m.png",
        fullPage: false,
    });

    // Assert no labels overlap
    expect(
        overlaps,
        `X-axis labels overlap on mobile (375px) with 3M period: ${JSON.stringify(overlaps)}`,
    ).toHaveLength(0);

    // Assert mobile uses month-only format (e.g. "Nov", not "11/21/2025")
    for (const tick of tickBoundingBoxes) {
        expect(tick.text).toMatch(/^[A-Z][a-z]{2}$|^Now$/);
    }
});

test("dashboard chart x-axis labels should not overlap on desktop with 3M period", async ({
    page,
    dashboardPage,
}) => {
    test.setTimeout(60_000);

    // Override to desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });

    await setupMocks(page);
    await dashboardPage.gotoPlain(TREASURY_ID);

    // Wait for the chart to render
    await dashboardPage.chart.waitForRendered();

    // On desktop, the time period selector is a dropdown (hidden on mobile):
    // open the trigger, then pick "3M" from the portaled menu.
    await dashboardPage.chart.selectDesktopPeriod("3M");

    // Wait for chart to re-render with 3M data
    await dashboardPage.chart.waitForRendered(10_000);
    await page.waitForTimeout(1000);

    // Collect bounding boxes of all x-axis tick labels
    const tickBoundingBoxes = await dashboardPage.chart.getXAxisLabels();

    expect(tickBoundingBoxes.length).toBeGreaterThan(0);
    console.log(
        `Found ${tickBoundingBoxes.length} x-axis tick labels:`,
        tickBoundingBoxes.map((t) => t.text),
    );

    await page.screenshot({
        path: "test-results/dashboard-chart-desktop-3m.png",
        fullPage: false,
    });

    const overlaps = ChartComponent.findOverlaps(tickBoundingBoxes);

    if (overlaps.length > 0) {
        console.log("Overlapping labels detected:", overlaps);
    }

    expect(
        overlaps,
        `X-axis labels overlap on desktop (1280px) with 3M period: ${JSON.stringify(overlaps)}`,
    ).toHaveLength(0);

    // Assert desktop uses month-only format (e.g. "Nov") for 3M period
    for (const tick of tickBoundingBoxes) {
        expect(tick.text).toMatch(/^[A-Z][a-z]{2}$|^Now$/);
    }
});

import { test, expect, Page, Route } from "@playwright/test";
import FINAL_ASSETS from "./fixtures/assets.json";

const TREASURY_ID = "webassemblymusic-treasury.sputnik-dao.near";
const DASHBOARD_URL = `/${TREASURY_ID}`;
const BACKEND_URL =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_BASE ||
    "http://localhost:8080";

test.use({ locale: "en-US" });

test.beforeAll(async () => {
    const res = await fetch(`${BACKEND_URL}/api/treasury/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: "WebAssembly Music Treasury",
            accountId: TREASURY_ID,
            paymentThreshold: 1,
            governors: ["test.near"],
            financiers: ["test.near"],
            requestors: ["test.near"],
        }),
    });
    if (res.ok) {
        console.log(`Created DAO ${TREASURY_ID} in sandbox`);
    } else {
        console.log(
            `DAO creation returned ${res.status} (may already exist)`,
        );
    }
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
 * Set up mocks that simulate real-world conditions:
 * - Assets endpoint returns slightly different balances on each refetch
 *   (simulating price/balance fluctuations every 5s)
 * - This causes parent re-renders that change totalBalanceUSD and tokens,
 *   which was the root cause of the tooltip disappearing.
 */
async function setupMocks(page: Page) {
    let chartFetchCount = 0;
    let assetsFetchCount = 0;

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

    // Return slightly different NEAR balance on each fetch to simulate
    // real-world balance fluctuations from useAssets refetchInterval.
    await page.route("**/api/user/assets*", async (route: Route) => {
        assetsFetchCount++;
        const assets = JSON.parse(JSON.stringify(FINAL_ASSETS));
        // Find the standard NEAR token and tweak its balance
        const nearToken = assets.find(
            (a: any) => a.id === "near" && a.residency === "Near",
        );
        if (nearToken?.balance?.Standard) {
            const base = BigInt(nearToken.balance.Standard.total);
            // Add a small increment on each fetch (0.001 NEAR per fetch)
            const increment =
                BigInt(assetsFetchCount) * BigInt("1000000000000000000000");
            nearToken.balance.Standard.total = (base + increment).toString();
        }
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(assets),
        });
    });

    await page.route("**/api/balance-history/chart*", async (route: Route) => {
        chartFetchCount++;
        const response: Record<string, any[]> = {
            all: [
                {
                    timestamp: "2026-02-11T00:00:00Z",
                    balance: "1000",
                    valueUsd: 5000,
                },
                {
                    timestamp: "2026-02-12T00:00:00Z",
                    balance: "1010",
                    valueUsd: 5100,
                },
                {
                    timestamp: "2026-02-13T00:00:00Z",
                    balance: "1020",
                    valueUsd: 5200,
                },
                {
                    timestamp: "2026-02-14T00:00:00Z",
                    balance: "1030",
                    valueUsd: 5300,
                },
                {
                    timestamp: "2026-02-15T00:00:00Z",
                    balance: "1040",
                    valueUsd: 5400,
                },
                {
                    timestamp: "2026-02-16T00:00:00Z",
                    balance: "1050",
                    valueUsd: 5500,
                },
                {
                    timestamp: "2026-02-17T00:00:00Z",
                    balance: "1060",
                    valueUsd: 5600,
                },
            ],
        };
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

    return {
        getChartFetchCount: () => chartFetchCount,
        getAssetsFetchCount: () => assetsFetchCount,
    };
}

test("chart tooltip remains visible while hovering during refetch interval", async ({
    page,
}) => {
    test.setTimeout(60_000);

    const { getChartFetchCount, getAssetsFetchCount } =
        await setupMocks(page);

    await page.goto(DASHBOARD_URL);

    const chartContainer = page.locator("[data-slot='chart']").first();

    // Wait for chart SVG to render
    await chartContainer
        .locator("svg")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });

    // Let initial refetches happen before we start hovering
    await page.waitForTimeout(2_000);
    const fetchCountBeforeHover = getChartFetchCount();
    const assetsFetchBeforeHover = getAssetsFetchCount();

    // Hover over the chart to trigger tooltip
    const box = await chartContainer.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(
        box!.x + box!.width * 0.5,
        box!.y + box!.height * 0.5,
    );

    // Wait for tooltip to appear
    const tooltip = chartContainer.locator(".recharts-tooltip-wrapper");
    await expect(tooltip).toBeVisible({ timeout: 5_000 });

    // Wait longer than the 5-second refetch interval while still hovering.
    // During this time, useAssets refetches with changing data, which causes
    // parent re-renders with new totalBalanceUSD — the original cause of
    // tooltip disappearing.
    await page.waitForTimeout(8_000);

    // Verify that assets DID refetch during hover (confirming the test
    // exercises the real-world scenario of parent re-renders).
    const assetsFetchAfterHover = getAssetsFetchCount();
    expect(assetsFetchAfterHover).toBeGreaterThan(assetsFetchBeforeHover);

    // Tooltip should still be visible — this is the core assertion.
    await expect(tooltip).toBeVisible();

    // Verify that no additional chart fetches occurred while hovering
    const fetchCountAfterHover = getChartFetchCount();
    expect(fetchCountAfterHover).toBe(fetchCountBeforeHover);

    // Move mouse away from chart
    await page.mouse.move(0, 0);

    // After un-hovering, refetch should resume — wait for at least one more fetch
    await expect
        .poll(() => getChartFetchCount(), { timeout: 10_000 })
        .toBeGreaterThan(fetchCountAfterHover);
});

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
 *   (simulating price/balance fluctuations)
 * - This causes parent re-renders that change totalBalanceUSD and tokens,
 *   which was the root cause of the tooltip disappearing (fixed via
 *   frozenChartData/frozenChartParams while hovering).
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
    // real-world balance fluctuations.
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

/**
 * Trigger a manual refetch of the given query key via the exposed
 * window.__queryClient (available in non-production builds).
 * Returns a promise that resolves once the response arrives.
 */
async function invalidateAndWait(
    page: Page,
    queryKey: string[],
    urlPattern: string,
) {
    const responsePromise = page.waitForResponse(
        (r) => r.url().includes(urlPattern) && r.status() === 200,
        { timeout: 10_000 },
    );
    await page.evaluate((key) => {
        const qc = (window as any).__queryClient;
        if (!qc) throw new Error("window.__queryClient is not defined — ensure QueryProvider exposes it in non-production builds");
        qc.invalidateQueries({ queryKey: key });
    }, queryKey);
    await responsePromise;
}

test("chart tooltip remains visible while hovering during asset refetches", async ({
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

    // Let initial fetches settle
    await page.waitForTimeout(500);
    const fetchCountBeforeHover = getChartFetchCount();
    const assetsCountBeforeHover = getAssetsFetchCount();

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

    // Simulate 3 asset refetches while still hovering (parent re-renders with
    // different balances — the original cause of tooltip disappearing)
    for (let i = 0; i < 3; i++) {
        await invalidateAndWait(page, ["treasuryAssets"], "/api/user/assets");
    }

    // Verify assets DID refetch (confirming the test exercises parent re-renders)
    expect(getAssetsFetchCount()).toBeGreaterThan(assetsCountBeforeHover);

    // CORE ASSERTION: tooltip should still be visible after parent re-renders
    await expect(tooltip).toBeVisible();

    // Verify chart did NOT refetch while we only invalidated assets
    expect(getChartFetchCount()).toBe(fetchCountBeforeHover);

    // Move mouse away from chart
    await page.mouse.move(0, 0);

    // After un-hovering, verify that invalidating the chart query works normally
    const chartResponsePromise = page.waitForResponse(
        (r) =>
            r.url().includes("/api/balance-history/chart") &&
            r.status() === 200,
        { timeout: 10_000 },
    );
    await page.evaluate(() => {
        (window as any).__queryClient?.invalidateQueries({
            queryKey: ["balanceChart"],
        });
    });
    await chartResponsePromise;
    expect(getChartFetchCount()).toBeGreaterThan(fetchCountBeforeHover);
});

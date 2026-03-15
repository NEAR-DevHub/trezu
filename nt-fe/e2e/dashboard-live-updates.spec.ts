import { test, expect, Page, Route, Locator } from "@playwright/test";
import FINAL_ASSETS from "./fixtures/assets.json";
import RECENT_ACTIVITY_FIXTURE from "./fixtures/recent-activity.json";

const TREASURY_ID = "webassemblymusic-treasury.sputnik-dao.near";
const DASHBOARD_URL = `/${TREASURY_ID}`;
const BACKEND_URL =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_BASE ||
    "http://localhost:8080";

// Ensure consistent locale for number formatting in chart tooltips
test.use({ locale: "en-US" });

// Create the DAO in the sandbox via the sputnik-dao.near factory,
// so server-side getTreasuryConfig() can read its on-chain config.
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

// ---------- Helpers (visible in video recordings) ----------

/** Display an informational text overlay at the top-center of the page. */
async function showOverlay(page: Page, text: string) {
    await page.evaluate((t) => {
        let el = document.getElementById("test-overlay");
        if (!el) {
            el = document.createElement("div");
            el.id = "test-overlay";
            el.style.cssText = [
                "position:fixed",
                "top:16px",
                "left:50%",
                "transform:translateX(-50%)",
                "background:rgba(0,0,0,0.85)",
                "color:#fff",
                "padding:12px 24px",
                "border-radius:8px",
                "z-index:10000",
                "font-size:14px",
                "font-family:system-ui,sans-serif",
                "max-width:80%",
                "text-align:center",
                "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
                "pointer-events:none",
                "white-space:pre-line",
            ].join(";");
            document.body.appendChild(el);
        }
        el.textContent = t;
    }, text);
}

/** Scroll to a locator and briefly highlight it with a green outline. */
async function scrollAndHighlight(locator: Locator, durationMs = 2000) {
    await locator.scrollIntoViewIfNeeded();
    const el = locator.first();
    await el.evaluate(
        (node, ms) => {
            node.style.outline = "3px solid #22c55e";
            node.style.outlineOffset = "2px";
            node.style.transition = "outline 0.3s";
            setTimeout(() => {
                node.style.outline = "";
                node.style.outlineOffset = "";
            }, ms);
        },
        durationMs,
    );
}

// ---------- Today's deposits (chronological order) ----------
//
// The 7 user-initiated deposits from 2026-02-18.
// Staking rewards are excluded — they are grouped separately in the UI.

const DEPOSIT_IDS_CHRONOLOGICAL = [
    50967, // +0.2 NEAR     (06:36)
    51480, // +3 NEAR       (10:28)
    51552, // +2 NEAR       (10:32)
    51617, // +0.15 NPRO    (10:35)
    51887, // +0.1 NPRO     (10:51)
    52009, // +0.998684 USDC (10:57)
    52265, // +0.005 ETH    (11:12)
];

const DEPOSIT_ACTIVITY_ITEMS = DEPOSIT_IDS_CHRONOLOGICAL.map(
    (id) => RECENT_ACTIVITY_FIXTURE.data.find((d) => d.id === id)!,
);

// Overlay text (intentionally avoids the "+X.XX" format to prevent
// substring-matching the overlay instead of the actual UI element)
// and the expected text rendered by formatActivityAmount in the UI.
// Expected aggregated token balances after each deposit.
// Computed from the fixture data via formatBalance(total, decimals, 5)
// with Big.js ROUND_UP (mode 3), across all residencies for the same symbol.
//
// NEAR = Staked(1032.99281) + Near(standard) + Intents(0.8)
// USDC = eth-Intents(125.01183) + near-Intents(119) + sol-Intents(22.54365)
//        + base-Intents(9.99998) + near-Ft(0.99869)
const DEPOSIT_META = [
    {
        overlay: "Backend detects 0.2 NEAR deposit from petersalomonsen.near (06:36 UTC)",
        assertText: "+0.2 NEAR",
        tokenSymbol: "NEAR",
        expectedChartBalance: "1,065.33117 NEAR",
        expectedTableBalance: "1065.33117 NEAR",
    },
    {
        overlay: "Backend detects 3 NEAR deposit from petersalomonsen.near (10:28 UTC)",
        assertText: "+3 NEAR",
        tokenSymbol: "NEAR",
        expectedChartBalance: "1,068.33117 NEAR",
        expectedTableBalance: "1068.33117 NEAR",
    },
    {
        overlay: "Backend detects 2 NEAR deposit from petersalomonsen.near (10:32 UTC)",
        assertText: "+2 NEAR",
        tokenSymbol: "NEAR",
        expectedChartBalance: "1,070.33117 NEAR",
        expectedTableBalance: "1070.33117 NEAR",
    },
    {
        overlay: "Backend detects 0.15 NPRO deposit from petersalomonsen.near (10:35 UTC)",
        assertText: "+0.15 NPRO",
        tokenSymbol: "NPRO",
        expectedChartBalance: "0.15 NPRO",
        expectedTableBalance: "0.15 NPRO",
    },
    {
        overlay: "Backend detects 0.1 NPRO deposit from petersalomonsen.near (10:51 UTC)",
        assertText: "+0.1 NPRO",
        tokenSymbol: "NPRO",
        expectedChartBalance: "0.25 NPRO",
        expectedTableBalance: "0.25 NPRO",
    },
    {
        overlay: "Backend detects 0.998684 USDC deposit via intents.near (10:57 UTC)",
        assertText: "+0.998684 USDC",
        tokenSymbol: "USDC",
        expectedChartBalance: "277.55415 USDC",
        expectedTableBalance: "277.55415 USDC",
    },
    {
        // Note: The ETH deposit took longer to appear in the real test because of
        // Ethereum network confirmation time, not because of any backend issue.
        overlay:
            "Backend detects 0.005 ETH deposit via cross-chain intents (11:12 UTC)\n" +
            "(ETH deposits take longer due to Ethereum network confirmation time)",
        assertText: "+0.005 ETH",
        tokenSymbol: "ETH",
        expectedChartBalance: "0.04002 ETH",
        expectedTableBalance: "0.04002 ETH",
    },
];

// Index of the first NPRO deposit — triggers "Hide assets < $1" auto-check.
const FIRST_NPRO_DEPOSIT_INDEX = 3;

// Baseline activity: items from before today + staking rewards from today.
// These are visible on page load before any deposits are replayed.
const BASELINE_ACTIVITY_ITEMS = RECENT_ACTIVITY_FIXTURE.data.filter(
    (d) =>
        !d.blockTime.startsWith("2026-02-18") ||
        d.counterparty === "astro-stakers.poolv1.near",
);

// ---------- Asset computation ----------

const DEPOSIT_ASSET_EFFECTS: Array<{
    assetId: string;
    assetResidency: string;
    rawAmount: bigint;
}> = [
    { assetId: "near", assetResidency: "Near", rawAmount: BigInt("200000000000000000000000") },
    { assetId: "near", assetResidency: "Near", rawAmount: BigInt("3000000000000000000000000") },
    { assetId: "near", assetResidency: "Near", rawAmount: BigInt("2000000000000000000000000") },
    { assetId: "npro.nearmobile.near", assetResidency: "Ft", rawAmount: BigInt("150000000000000000000000") },
    { assetId: "npro.nearmobile.near", assetResidency: "Ft", rawAmount: BigInt("100000000000000000000000") },
    {
        assetId: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
        assetResidency: "Ft",
        rawAmount: BigInt("998684"),
    },
    { assetId: "nep141:eth.omft.near", assetResidency: "Intents", rawAmount: BigInt("5000000000000000") },
];

/**
 * Compute the assets API response at a given deposit stage.
 * Stage 0 = before any deposits today, stage N = after deposits 0..N-1.
 */
function computeAssetsAtStage(stage: number): any[] {
    const assets = JSON.parse(JSON.stringify(FINAL_ASSETS));

    for (let i = DEPOSIT_ASSET_EFFECTS.length - 1; i >= stage; i--) {
        const { assetId, assetResidency, rawAmount } = DEPOSIT_ASSET_EFFECTS[i];
        const idx = assets.findIndex(
            (a: any) => a.id === assetId && a.residency === assetResidency,
        );
        if (idx === -1) continue;
        const asset = assets[idx];
        if (!asset.balance?.Standard) continue;

        const current = BigInt(asset.balance.Standard.total);
        const newBal = current - rawAmount;
        if (newBal <= BigInt(0)) {
            assets.splice(idx, 1);
        } else {
            asset.balance.Standard.total = newBal.toString();
        }
    }

    return assets;
}

// ---------- Mock setup ----------

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

async function setupMocks(page: Page) {
    let depositStage = 0;

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
            body: JSON.stringify(computeAssetsAtStage(depositStage)),
        });
    });

    // Mock balance-history chart so the chart always renders with a "Now" point
    await page.route("**/api/balance-history/chart*", async (route: Route) => {
        const url = new URL(route.request().url());
        const tokenIds = url.searchParams.get("tokenIds");
        const ids = tokenIds ? tokenIds.split(",") : ["all"];
        const response: Record<string, any[]> = {};
        for (const id of ids) {
            response[id] = [
                { timestamp: "2026-02-17T00:00:00Z", balance: "0", valueUsd: 0 },
            ];
        }
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(response),
        });
    });

    await page.route("**/api/recent-activity*", async (route: Route) => {
        const revealed = DEPOSIT_ACTIVITY_ITEMS.slice(0, depositStage);
        const all = [...revealed, ...BASELINE_ACTIVITY_ITEMS].sort(
            (a, b) =>
                new Date(b.blockTime).getTime() -
                new Date(a.blockTime).getTime(),
        );
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: all, total: all.length }),
        });
    });

    return {
        revealNextDeposit: () => {
            if (depositStage < DEPOSIT_META.length) {
                depositStage++;
            }
        },
    };
}

// ---------- Helpers ----------

/**
 * Trigger a refetch of assets + recent-activity by invalidating the TanStack
 * Query cache via window.__queryClient (exposed in non-production builds).
 * Waits for both responses to arrive before resolving.
 */
async function refreshDashboardData(page: Page) {
    const assetsResponse = page.waitForResponse(
        (r) => r.url().includes("/api/user/assets") && r.status() === 200,
        { timeout: 10_000 },
    );
    const activityResponse = page.waitForResponse(
        (r) =>
            r.url().includes("/api/recent-activity") && r.status() === 200,
        { timeout: 10_000 },
    );
    await page.evaluate(() => {
        const qc = (window as any).__queryClient;
        if (qc) {
            qc.invalidateQueries({ queryKey: ["treasuryAssets"] });
            qc.invalidateQueries({ queryKey: ["recentActivity"] });
        }
    });
    await Promise.all([assetsResponse, activityResponse]);
}

// ---------- Test ----------

test("dashboard live updates — deposits appear one by one, checkbox persists", async ({
    page,
}) => {
    test.setTimeout(240_000);

    const { revealNextDeposit } = await setupMocks(page);

    await page.goto(DASHBOARD_URL);

    // Key UI landmarks
    const totalBalanceAmount = page.locator("p.text-3xl.font-bold");
    const chartContainer = page.locator("[data-slot='chart']").first();
    const assetsCheckbox = page
        .getByText("Hide assets")
        .locator("..")
        .getByRole("checkbox");

    // ---- Part 1: Show baseline state ----

    await showOverlay(
        page,
        "Dashboard loaded — showing baseline state before today's deposits",
    );
    await expect(totalBalanceAmount).toBeVisible({ timeout: 15_000 });
    await scrollAndHighlight(totalBalanceAmount, 1500);
    await page.waitForTimeout(500);

    const baselineItem = page.getByText("+1 NEAR").first();
    await scrollAndHighlight(baselineItem, 1500);
    await page.waitForTimeout(1_000);

    // ---- Part 2: Deposits appear one by one ----

    let checkboxUnchecked = false;
    let currentChartToken = "all";

    for (let i = 0; i < DEPOSIT_META.length; i++) {
        const meta = DEPOSIT_META[i];
        revealNextDeposit();
        await showOverlay(page, meta.overlay);

        // Trigger a manual refetch so the UI picks up the new mock data.
        // (The app uses staleTime-based caching without a refetchInterval, so
        // data only refreshes when explicitly invalidated or on remount.)
        await refreshDashboardData(page);

        // Wait for the deposit to appear in recent activity
        const depositEl = page.getByText(meta.assertText).first();
        await expect(depositEl).toBeVisible({ timeout: 30_000 });

        // 1. Highlight total balance amount
        await scrollAndHighlight(totalBalanceAmount, 1500);
        await page.waitForTimeout(500);

        // 2. Select the deposited token in the chart dropdown
        if (currentChartToken !== meta.tokenSymbol) {
            // Pick the first enabled combobox (the disabled one is an unrelated step button)
            const tokenDropdown = page
                .locator('button[role="combobox"]:not([disabled])')
                .first();
            await tokenDropdown.click();
            await page
                .getByRole("option")
                .filter({ hasText: meta.tokenSymbol })
                .click();
            currentChartToken = meta.tokenSymbol;
        }

        // Wait for chart to render, then hover at the right edge to show "Now" tooltip
        await chartContainer
            .locator("svg")
            .first()
            .waitFor({ state: "visible", timeout: 10_000 });
        const box = await chartContainer.boundingBox();
        if (box) {
            await page.mouse.move(
                box.x + box.width * 0.92,
                box.y + box.height * 0.5,
            );
            const tooltipBalance = chartContainer.getByText(
                meta.expectedChartBalance,
            );
            await expect(tooltipBalance).toBeVisible({ timeout: 5_000 });
            await page.waitForTimeout(500);
        }

        // 3. After the first NPRO deposit, the "Hide assets < $1" checkbox auto-checks
        // (NPRO is $0.05). Uncheck it so NPRO stays visible for the rest of the test.
        if (i === FIRST_NPRO_DEPOSIT_INDEX && !checkboxUnchecked) {
            await expect(assetsCheckbox).toBeChecked({ timeout: 5_000 });
            await showOverlay(
                page,
                "NPRO appeared — 'Hide assets < $1' auto-checked. Unchecking it.",
            );
            await scrollAndHighlight(assetsCheckbox, 1500);
            await assetsCheckbox.click();
            await expect(assetsCheckbox).not.toBeChecked();
            checkboxUnchecked = true;
            await page.waitForTimeout(500);
        }

        // Once unchecked, verify it stays unchecked on every subsequent refetch
        if (checkboxUnchecked) {
            await expect(assetsCheckbox).not.toBeChecked();
        }

        // 4. Assert and highlight token balance in assets table
        const tableBalance = page
            .locator("table")
            .getByText(meta.expectedTableBalance)
            .first();
        await scrollAndHighlight(tableBalance, 1500);
        await page.waitForTimeout(500);

        // 5. Highlight deposit in recent activity
        await scrollAndHighlight(depositEl, 1500);
        await page.waitForTimeout(500);
    }

    // ---- Part 3: Final verification ----

    await showOverlay(
        page,
        "All 7 deposits detected — checkbox stayed unchecked across all refetches",
    );
    await scrollAndHighlight(assetsCheckbox, 2000);
    await expect(assetsCheckbox).not.toBeChecked();

    // NPRO should still be visible in assets table
    const nproCell = page.getByText("NPRO", { exact: true }).first();
    await expect(nproCell).toBeVisible();
    await scrollAndHighlight(nproCell, 2000);
    await page.waitForTimeout(2_000);
});

import { test, expect, Page, Route } from "@playwright/test";
import FINAL_ASSETS from "./fixtures/assets.json";
import RECENT_ACTIVITY_FIXTURE from "./fixtures/recent-activity.json";

const TREASURY_ID = "webassemblymusic-treasury.sputnik-dao.near";
const DASHBOARD_URL = `/${TREASURY_ID}`;

// ---------- Overlay helper (visible in video recordings) ----------

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
const DEPOSIT_META = [
    {
        overlay: "Backend detects 0.2 NEAR deposit from petersalomonsen.near (06:36 UTC)",
        assertText: "+0.2 NEAR",
    },
    {
        overlay: "Backend detects 3 NEAR deposit from petersalomonsen.near (10:28 UTC)",
        assertText: "+3 NEAR",
    },
    {
        overlay: "Backend detects 2 NEAR deposit from petersalomonsen.near (10:32 UTC)",
        assertText: "+2 NEAR",
    },
    {
        overlay: "Backend detects 0.15 NPRO deposit from petersalomonsen.near (10:35 UTC)",
        assertText: "+0.15 NPRO",
    },
    {
        overlay: "Backend detects 0.1 NPRO deposit from petersalomonsen.near (10:51 UTC)",
        assertText: "+0.1 NPRO",
    },
    {
        overlay: "Backend detects 0.998684 USDC deposit via intents.near (10:57 UTC)",
        assertText: "+0.998684 USDC",
    },
    {
        // Note: The ETH deposit took longer to appear in the real test because of
        // Ethereum network confirmation time, not because of any backend issue.
        overlay:
            "Backend detects 0.005 ETH deposit via cross-chain intents (11:12 UTC)\n" +
            "(ETH deposits take longer due to Ethereum network confirmation time)",
        assertText: "+0.005 ETH",
    },
];

// Baseline activity: items from before today + staking rewards from today.
// These are visible on page load before any deposits are replayed.
const BASELINE_ACTIVITY_ITEMS = RECENT_ACTIVITY_FIXTURE.data.filter(
    (d) =>
        !d.blockTime.startsWith("2026-02-18") ||
        d.counterparty === "astro-stakers.poolv1.near",
);

// ---------- Asset computation ----------

// Maps each deposit to the asset entry it modifies (by id + residency)
// and its raw balance delta (in the smallest unit, e.g. yoctoNEAR).
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
 * Works by starting from the final fixture and subtracting deposits that
 * haven't occurred yet. Assets whose balance reaches 0 are removed.
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

const BALANCE_CHART = {
    labels: ["2026-02-11", "2026-02-12", "2026-02-18"],
    datasets: [{ data: [34.0, 34.5, 36.5] }],
};

/**
 * Sets up API route mocks with a mutable deposit stage.
 * The stage controls how many of today's deposits are visible.
 */
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

    await page.route("**/api/balance-history/chart*", async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(BALANCE_CHART),
        });
    });

    await page.route("**/api/treasury-policy*", async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                roles: [],
                defaultVotePolicy: {},
                proposalBond: "100000000000000000000000",
                proposalPeriod: "604800000000000",
            }),
        });
    });

    await page.route("**/api/balance-changes*", async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "[]",
        });
    });

    // Catch-all for unhandled API endpoints
    await page.route("**/api/**", async (route: Route) => {
        const url = route.request().url();
        if (
            url.includes("/api/user/assets") ||
            url.includes("/api/recent-activity") ||
            url.includes("/api/balance-history/chart") ||
            url.includes("/api/monitored-accounts") ||
            url.includes("/api/treasury-policy") ||
            url.includes("/api/balance-changes")
        ) {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "{}",
        });
    });

    return {
        /** Advance to the next deposit stage (reveals one more deposit). */
        revealNextDeposit: () => {
            if (depositStage < DEPOSIT_META.length) {
                depositStage++;
            }
        },
        /** Reveal all deposits at once. */
        revealAllDeposits: () => {
            depositStage = DEPOSIT_META.length;
        },
    };
}

// ---------- Tests ----------

test.describe("Dashboard live updates", () => {
    test("deposits from today appear one by one without page refresh", async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const { revealNextDeposit } = await setupMocks(page);

        await page.goto(DASHBOARD_URL);

        // Wait for initial data to render
        await showOverlay(
            page,
            "Dashboard loaded — showing baseline activity before today's deposits",
        );
        await expect(page.getByText("+1 NEAR")).toBeVisible({
            timeout: 15_000,
        });
        await page.waitForTimeout(2_000);

        // Reveal each deposit one by one and assert it appears in the UI.
        // The frontend polls recent-activity every 5 seconds, so each deposit
        // should appear within one polling cycle (~5s), well under the 30s timeout.
        for (let i = 0; i < DEPOSIT_META.length; i++) {
            const meta = DEPOSIT_META[i];
            revealNextDeposit();
            await showOverlay(page, meta.overlay);

            await expect(
                page.getByText(meta.assertText).first(),
            ).toBeVisible({ timeout: 30_000 });

            // Pause so the viewer can see each deposit appear in the recording
            await page.waitForTimeout(1_500);
        }

        await showOverlay(
            page,
            "All 7 deposits detected — UI updated in real-time without page refresh",
        );
        await page.waitForTimeout(3_000);
    });

    test("hide assets < $1 checkbox stays unchecked after refetch", async ({
        page,
    }) => {
        test.setTimeout(60_000);

        const { revealAllDeposits } = await setupMocks(page);
        revealAllDeposits();

        await page.goto(DASHBOARD_URL);

        // Wait for assets section to render
        await showOverlay(
            page,
            "Assets loaded — 'Hide assets < $1' is auto-checked, hiding NPRO ($0.05)",
        );
        await expect(page.getByText("Assets")).toBeVisible({
            timeout: 15_000,
        });

        const checkbox = page.getByRole("checkbox");

        // Checkbox should auto-check on initial load because NPRO < $1
        await expect(checkbox).toBeChecked({ timeout: 5_000 });

        // NPRO should NOT be visible in the assets table
        await expect(
            page.locator("table").getByText("NPRO"),
        ).not.toBeVisible();
        await page.waitForTimeout(2_000);

        // Uncheck the checkbox
        await showOverlay(
            page,
            "Unchecking 'Hide assets < $1' — NPRO should become visible",
        );
        await checkbox.click();
        await expect(checkbox).not.toBeChecked();

        // NPRO should now be visible
        await expect(
            page.locator("table").getByText("NPRO"),
        ).toBeVisible({ timeout: 5_000 });
        await page.waitForTimeout(2_000);

        // Wait for multiple refetch cycles (assets refetch every 5s)
        await showOverlay(
            page,
            "Waiting 15s for multiple refetch cycles — checkbox must stay unchecked",
        );
        await page.waitForTimeout(15_000);

        // Checkbox should still be unchecked (not reset by refetch)
        await expect(checkbox).not.toBeChecked();

        // NPRO should still be visible
        await expect(
            page.locator("table").getByText("NPRO"),
        ).toBeVisible();

        await showOverlay(
            page,
            "Checkbox stayed unchecked after multiple refetches — fix verified",
        );
        await page.waitForTimeout(2_000);
    });
});

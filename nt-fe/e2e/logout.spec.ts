import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test-with-pages";
import { MOCK_MANIFEST_ID } from "./helpers/mock-wallet";
import { installTreasuryApiMocks } from "./mocks/treasury-api-mocks";

const TREASURY_ID = "romakqatesting.sputnik-dao.near";
const ACCOUNT_ID = "test.near";

test.use({ locale: "en-US" });
test.describe.configure({ timeout: 120_000 });

/**
 * Signed-in session whose backend follows the real cookie lifecycle:
 * `/auth/me` answers 401 once `/auth/logout` has succeeded. The wallet is
 * seeded only on the first load of the tab — `seedMockWalletAccount` re-seeds
 * on every navigation, which would hide a reload that restores the session.
 */
async function signedInSession(page: Page, logoutStatus = 200) {
    const backend = { logoutCalls: 0, loggedOut: false };

    // No accountId: the installer must not seed the wallet on every load.
    await installTreasuryApiMocks(page, {
        treasuryId: TREASURY_ID,
        includeDashboardExtras: true,
    });
    // Registered after the shared installer so these routes take precedence.
    await page.route(
        (url) => url.pathname.endsWith("/auth/me"),
        (route) =>
            backend.loggedOut
                ? route.fulfill({
                      status: 401,
                      contentType: "application/json",
                      body: JSON.stringify({ error: "Not authenticated" }),
                  })
                : route.fulfill({
                      status: 200,
                      contentType: "application/json",
                      body: JSON.stringify({
                          accountId: ACCOUNT_ID,
                          termsAccepted: true,
                      }),
                  }),
    );
    await page.route(
        (url) => url.pathname.endsWith("/auth/logout"),
        (route) => {
            if (route.request().method() !== "POST") return route.fallback();
            backend.logoutCalls += 1;
            backend.loggedOut = logoutStatus < 400;
            return route.fulfill({
                status: logoutStatus,
                contentType: "application/json",
                body: JSON.stringify(
                    logoutStatus < 400 ? { ok: true } : { error: "boom" },
                ),
            });
        },
    );
    await page.addInitScript(
        ({ walletId, acct }) => {
            // Init scripts also run in the wallet executor's sandboxed iframe.
            if (window.top !== window) return;
            try {
                if (sessionStorage.getItem("e2e:wallet-seeded")) return;
                sessionStorage.setItem("e2e:wallet-seeded", "1");
                localStorage.setItem("selected-wallet", walletId);
                localStorage.setItem(`${walletId}:signedAccountId`, acct);
            } catch {}
        },
        { walletId: MOCK_MANIFEST_ID, acct: ACCOUNT_ID },
    );

    return backend;
}

function connectWalletButton(page: Page) {
    return page
        .getByRole("button", { name: /connect wallet/i })
        .filter({ visible: true });
}

function storedWalletSelection(page: Page) {
    return page.evaluate(() => ({
        selectedWallet: localStorage.getItem("selected-wallet"),
        targetWallet: localStorage.getItem("trezu:target-wallet"),
    }));
}

test.describe("Log out", () => {
    for (const viewport of [
        { name: "desktop", width: 1280, height: 800 },
        { name: "mobile", width: 375, height: 667 },
    ]) {
        /**
         * Scenario: SC-1/SC-2: Log Out ends the session and a reload doesn't restore it
         * Requirement: MANUAL_REGRESSION_CHECKLIST AUTH-06
         * Priority: P1
         */
        test(`log out signs the user out and a reload keeps them signed out on ${viewport.name}`, async ({
            page,
            dashboardPage,
        }) => {
            await page.setViewportSize(viewport);
            const backend = await signedInSession(page);

            await test.step("open the dashboard signed in", async () => {
                await dashboardPage.goto(TREASURY_ID);
                await expect(
                    dashboardPage.accountMenu.trigger(ACCOUNT_ID),
                ).toBeVisible({ timeout: 30_000 });
            });

            await test.step("log out", async () => {
                await dashboardPage.accountMenu.logOut(ACCOUNT_ID);
            });

            await test.step("header is signed out", async () => {
                await expect(connectWalletButton(page)).toBeVisible({
                    timeout: 30_000,
                });
                await expect(
                    dashboardPage.accountMenu.trigger(ACCOUNT_ID),
                ).toBeHidden();
                expect(backend.logoutCalls).toBe(1);
                await expect
                    .poll(() => storedWalletSelection(page))
                    .toEqual({ selectedWallet: null, targetWallet: null });
            });

            await test.step("reload stays signed out", async () => {
                await page.reload({ waitUntil: "domcontentloaded" });
                await expect(connectWalletButton(page)).toBeVisible({
                    timeout: 30_000,
                });
                await expect(
                    dashboardPage.accountMenu.trigger(ACCOUNT_ID),
                ).toBeHidden();
                expect(await storedWalletSelection(page)).toEqual({
                    selectedWallet: null,
                    targetWallet: null,
                });
            });
        });
    }

    /**
     * Scenario: SC-3: a failing backend logout still signs the user out locally
     * Requirement: MANUAL_REGRESSION_CHECKLIST AUTH-06
     * Priority: P2
     */
    test("log out still signs the user out when the backend logout fails", async ({
        page,
        dashboardPage,
    }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const backend = await signedInSession(page, 500);

        await dashboardPage.goto(TREASURY_ID);
        await expect(dashboardPage.accountMenu.trigger(ACCOUNT_ID)).toBeVisible(
            { timeout: 30_000 },
        );

        await dashboardPage.accountMenu.logOut(ACCOUNT_ID);

        await expect(connectWalletButton(page)).toBeVisible({
            timeout: 30_000,
        });
        await expect(
            dashboardPage.accountMenu.trigger(ACCOUNT_ID),
        ).toBeHidden();
        expect(backend.logoutCalls).toBe(1);
        await expect
            .poll(() => storedWalletSelection(page))
            .toEqual({ selectedWallet: null, targetWallet: null });
    });
});

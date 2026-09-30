import { expect, test } from "./fixtures/test-with-pages";
import { routeMeteorStandIn, METEOR_WALLET_ID } from "./helpers/mock-wallet";
import { installTreasuryApiMocks } from "./mocks/treasury-api-mocks";

const TREASURY_ID = "romakqatesting.sputnik-dao.near";
const ACCOUNT_ID = "test.near";

test.use({ locale: "en-US" });
test.describe.configure({ timeout: 120_000 });

test.describe("Sign out", () => {
    // The ticket reproduces on phones; mobile width also switches the header
    // to its avatar-only account trigger and icon-only Connect Wallet button.
    for (const viewport of [
        { name: "desktop", width: 1280, height: 800 },
        { name: "mobile", width: 375, height: 667 },
    ]) {
        /**
         * Scenario: log out with Meteor Wallet never calls Meteor's signOut
         * Requirement: issue #1441 (Meteor "Execute Action" iframe after Sign Out)
         * Priority: P2
         */
        test(`log out with Meteor Wallet does not trigger the wallet sign-out prompt on ${viewport.name}`, async ({
            page,
            dashboardPage,
        }) => {
            await page.setViewportSize(viewport);
            await installTreasuryApiMocks(page, {
                accountId: ACCOUNT_ID,
                treasuryId: TREASURY_ID,
                includeDashboardExtras: true,
            });
            // Registered after the shared installer so these routes take precedence.
            await page.route("**/auth/logout*", (route) =>
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ ok: true }),
                }),
            );
            const meteor = await routeMeteorStandIn(page, ACCOUNT_ID);

            await test.step("open the dashboard signed in with Meteor", async () => {
                await dashboardPage.goto(TREASURY_ID);
                await expect(
                    dashboardPage.accountMenu.trigger(ACCOUNT_ID),
                ).toBeVisible({ timeout: 30_000 });
            });

            await test.step("log out", async () => {
                await dashboardPage.accountMenu.logOut(ACCOUNT_ID);
            });

            await expect(
                page
                    .getByRole("button", { name: /connect wallet/i })
                    .filter({ visible: true }),
            ).toBeVisible({ timeout: 30_000 });
            // The wallet selection is cleared last (after signOut on the old
            // path), so once it is gone any signOut call would have been made.
            await expect
                .poll(() =>
                    page.evaluate(() => localStorage.getItem("selected-wallet")),
                )
                .toBeNull();
            expect(meteor.signOutCalls).toBe(0);
            const meteorKeys = await page.evaluate(
                (prefix) =>
                    Object.keys(localStorage).filter((key) =>
                        key.startsWith(prefix),
                    ),
                `${METEOR_WALLET_ID}:`,
            );
            expect(meteorKeys).toEqual([]);
        });
    }
});

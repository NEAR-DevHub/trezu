import { expect, test } from "./fixtures/test-with-pages";
import { buildTreasurySummary } from "./fixtures/treasury-mock-data";
import { installTreasuryApiMocks } from "./mocks/treasury-api-mocks";

test.use({
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
});

test("Create route shows create treasury form when signed out", async ({
    page,
    startPage,
}) => {
    await installTreasuryApiMocks(page, {});

    await startPage.gotoCreate();

    await expect(startPage.createTreasuryHeading()).toBeVisible();
    await expect(startPage.continueToWalletButton()).toBeVisible();
});

test("Signed in + no treasuries => stays on create treasury form", async ({
    page,
    startPage,
}) => {
    await installTreasuryApiMocks(page, {
        accountId: "test.near",
        treasuries: [],
    });

    await startPage.gotoAndWaitForBootstrap();

    await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
    await expect(startPage.createTreasuryButton()).toBeVisible();
});

test("Signed in + has treasury => redirects to /{daoId}", async ({
    page,
    startPage,
}) => {
    const daoId = "webassemblymusic-treasury.sputnik-dao.near";
    await installTreasuryApiMocks(page, {
        accountId: "test.near",
        treasuries: [buildTreasurySummary(daoId, "My Treasury")],
    });

    await startPage.gotoAndWaitForBootstrap();

    await expect(page).toHaveURL(
        new RegExp(`/${daoId.replaceAll(".", "\\.")}$`),
        {
            timeout: 15000,
        },
    );
});

test("Signed in + no treasuries + creation disabled => waitlist is shown", async ({
    page,
    startPage,
}) => {
    await installTreasuryApiMocks(page, {
        accountId: "test.near",
        treasuries: [],
    });
    await startPage.mockTreasuryCreationDisabled();

    await startPage.gotoAndWaitForBootstrap();

    // Signed-in users with no treasuries are redirected `/` → `/create`.
    // Selecting a type on `/` is lost when that remounts the form.
    await expect(page).toHaveURL(/\/create/, { timeout: 15000 });

    await startPage.submitCreateTreasuryForm("testing-by-playwright");

    await expect(page).toHaveURL(/create/);
    await expect(startPage.giveUsTimeHeading()).toBeVisible();
    await expect(startPage.notifyMeButton()).toBeVisible();
});

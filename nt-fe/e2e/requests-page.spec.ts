import { expect, test } from "./fixtures/test-with-pages";
import { buildExecutedProposalsResponse } from "./fixtures/treasury-mock-data";
import { installTreasuryApiMocks } from "./mocks/treasury-api-mocks";

const TREASURY_ID = "requests-e2e-test.sputnik-dao.near";
const ACCOUNT_ID = "test.near";

test.use({ locale: "en-US" });

test.describe("Requests page – new treasury with onboarding", () => {
    test("CTA buttons (Send / Exchange) do not overlap on requests page", async ({
        page,
        requestsPage,
    }) => {
        await installTreasuryApiMocks(page, {
            accountId: ACCOUNT_ID,
            treasuryId: TREASURY_ID,
            treasuryName: "Requests E2E Test Treasury",
        });

        await requestsPage.goto(TREASURY_ID);

        const sendButton = requestsPage.sendButton();
        const exchangeButton = requestsPage.exchangeButton();
        await expect(sendButton).toBeVisible({ timeout: 15000 });
        await expect(exchangeButton).toBeVisible({ timeout: 15000 });

        await requestsPage.screenshot("requests-page-cta-buttons");

        const { boxA: sendBox, boxB: exchangeBox } =
            await requestsPage.expectNoOverlap(
                sendButton,
                exchangeButton,
                "Send/Exchange CTAs",
            );

        if (sendBox && exchangeBox) {
            const ctaContainer = requestsPage.ctaContainer();
            if (await ctaContainer.isVisible()) {
                await ctaContainer.screenshot({
                    path: "test-results/requests-page-cta-buttons-zoomed.png",
                });
            }

            // Verify there's a visible gap between them (at least 4px)
            const gap = exchangeBox.x - (sendBox.x + sendBox.width);
            expect(
                gap,
                `Gap between Send and Exchange buttons should be >= 4px, got ${gap}px`,
            ).toBeGreaterThanOrEqual(4);

            // Buttons with short labels should not stretch excessively wide
            const maxButtonWidth = 200;
            expect(
                sendBox.width,
                `Send button width (${sendBox.width}px) should be <= ${maxButtonWidth}px`,
            ).toBeLessThanOrEqual(maxButtonWidth);
            expect(
                exchangeBox.width,
                `Exchange button width (${exchangeBox.width}px) should be <= ${maxButtonWidth}px`,
            ).toBeLessThanOrEqual(maxButtonWidth);
        }
    });

    test("Requests page shows empty state with proper heading for new treasury", async ({
        page,
        requestsPage,
    }) => {
        await installTreasuryApiMocks(page, {
            accountId: ACCOUNT_ID,
            treasuryId: TREASURY_ID,
            treasuryName: "Requests E2E Test Treasury",
        });

        await requestsPage.goto(TREASURY_ID);

        await expect(requestsPage.emptyStateHeading()).toBeVisible({
            timeout: 15000,
        });
        await expect(requestsPage.emptyStateDescription()).toBeVisible();

        await requestsPage.screenshot("requests-page-empty-state");
    });

    test("CTA buttons are not overlapped by onboarding progress on dashboard", async ({
        page,
        requestsPage,
    }) => {
        await installTreasuryApiMocks(page, {
            accountId: ACCOUNT_ID,
            treasuryId: TREASURY_ID,
            treasuryName: "Requests E2E Test Treasury",
        });

        // Onboarding widget lives on the dashboard, not /requests.
        await requestsPage.gotoDashboard(TREASURY_ID);

        // Onboarding progress should be visible (step 3 is active since we have assets but no proposals)
        await expect(requestsPage.onboardingHeading()).toBeVisible({
            timeout: 15000,
        });

        await requestsPage.screenshot("dashboard-onboarding-cta");

        // The "Send" button in onboarding step 3 (not the dashboard #dashboard-step2 one)
        await expect(requestsPage.onboardingStepSendButton()).toBeVisible();
    });

    test("Requests page shows 'All caught up' with CTA buttons when all requests are executed", async ({
        page,
        requestsPage,
    }) => {
        // Pending (InProgress) query returns empty; every other status query returns the executed proposal.
        await installTreasuryApiMocks(page, {
            accountId: ACCOUNT_ID,
            treasuryId: TREASURY_ID,
            treasuryName: "Requests E2E Test Treasury",
            proposalsByStatus: (statuses) =>
                statuses?.includes("InProgress")
                    ? { page: 0, page_size: 15, total: 0, proposals: [] }
                    : buildExecutedProposalsResponse(TREASURY_ID, ACCOUNT_ID),
        });

        await requestsPage.goto(TREASURY_ID);

        // Should show "All caught up!" empty state (not the "Create your first request" state)
        await expect(requestsPage.allCaughtUpHeading()).toBeVisible({
            timeout: 15000,
        });
        await expect(requestsPage.allCaughtUpDescription()).toBeVisible();

        // Should NOT show the "Create your first request" empty state
        await expect(requestsPage.emptyStateHeading()).not.toBeVisible();

        const sendButton = requestsPage.sendButton();
        const exchangeButton = requestsPage.exchangeButton();
        await expect(sendButton).toBeVisible();
        await expect(exchangeButton).toBeVisible();

        const { boxA: sendBox, boxB: exchangeBox } =
            await requestsPage.expectNoOverlap(
                sendButton,
                exchangeButton,
                "Send/Exchange CTAs (all executed)",
            );

        if (sendBox && exchangeBox) {
            const maxButtonWidth = 200;
            expect(
                sendBox.width,
                `Send button width (${sendBox.width}px) should be <= ${maxButtonWidth}px`,
            ).toBeLessThanOrEqual(maxButtonWidth);
            expect(
                exchangeBox.width,
                `Exchange button width (${exchangeBox.width}px) should be <= ${maxButtonWidth}px`,
            ).toBeLessThanOrEqual(maxButtonWidth);
        }

        await requestsPage.screenshot("requests-page-all-executed");
    });
});

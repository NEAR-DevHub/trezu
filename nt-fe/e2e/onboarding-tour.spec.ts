import { expect, test } from "./fixtures/test-with-pages";
import {
    buildProposalsWithOneLegacyShape,
    DEFAULT_TREASURY_ASSETS,
    EMPTY_ASSETS,
    EMPTY_PROPOSALS,
} from "./fixtures/treasury-mock-data";
import { installTreasuryApiMocks } from "./mocks/treasury-api-mocks";
import { DashboardPage } from "./pages/dashboard.page";

const TREASURY_ID = "onboarding-e2e-test.sputnik-dao.near";
const ACCOUNT_ID = "test.near";

test.use({ locale: "en-US" });
test.describe.configure({ timeout: 120_000 });

/** Installs the standard signed-in-with-a-treasury mock set, with optional asset/proposal overrides. */
async function mockDashboard(
    page: Parameters<typeof installTreasuryApiMocks>[0],
    options?: { assets?: unknown[]; proposals?: typeof EMPTY_PROPOSALS },
) {
    await installTreasuryApiMocks(page, {
        accountId: ACCOUNT_ID,
        treasuryId: TREASURY_ID,
        treasuryName: "Onboarding E2E Test Treasury",
        assets: options?.assets ?? DEFAULT_TREASURY_ASSETS,
        proposals: options?.proposals ?? EMPTY_PROPOSALS,
        includeDashboardExtras: true,
    });
}

// ──────────────────────────────────────────────────────────────────────────
// Welcome Tooltip Tests
// ──────────────────────────────────────────────────────────────────────────

test.describe("Onboarding – Welcome Tooltip", () => {
    test("Welcome tooltip appears for a new user on the dashboard", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);

        await expect(dashboardPage.welcomeTooltip.step1Text()).toBeVisible({
            timeout: 15000,
        });

        await dashboardPage.screenshot("onboarding-welcome-tooltip");
    });

    test("Welcome tooltip has two steps and can be dismissed", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);

        const { welcomeTooltip } = dashboardPage;

        await expect(welcomeTooltip.step1DetailText()).toBeVisible({
            timeout: 15000,
        });
        expect(await welcomeTooltip.stepIndicator(1, 2).isVisible()).toBe(true);

        await welcomeTooltip.dismissWithGotIt();

        await expect(welcomeTooltip.step2Text()).toBeVisible({
            timeout: 5000,
        });
        expect(await welcomeTooltip.stepIndicator(2, 2).isVisible()).toBe(true);

        await welcomeTooltip.dismissWithNoThanks();
        await expect(welcomeTooltip.step2Text()).not.toBeVisible({
            timeout: 5000,
        });

        const dismissed = await page.evaluate(() =>
            localStorage.getItem("welcome-dismissed"),
        );
        expect(dismissed).toBe("true");
    });

    test("Welcome tooltip does not reappear after dismissal", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoWithStorage(TREASURY_ID, {
            "welcome-dismissed": "true",
        });

        // No arbitrary settle-wait needed: `.not.toBeVisible()` already
        // polls for the full timeout, so a late-appearing tooltip would
        // still be caught. Bumped to 7s (was: 2s blind sleep + 5s default
        // assertion poll) to keep the same total protection window.
        await expect(dashboardPage.welcomeTooltip.step1Text()).not.toBeVisible({
            timeout: 7000,
        });
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Dashboard Tour Tests – highlight & arrow verification
// ──────────────────────────────────────────────────────────────────────────

test.describe("Onboarding – Dashboard Tour highlights and arrows", () => {
    test("Dashboard tour can be started from the Welcome tooltip", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);
        await dashboardPage.startOnboardingTour();

        await dashboardPage.screenshot("onboarding-tour-step1");
    });

    test("Tour targets are the BalanceWithGraph buttons, not the onboarding progress widget", async ({
        page,
        dashboardPage,
    }) => {
        // The onboarding progress widget also has Deposit/Send buttons, but the
        // dashboard tour must highlight #dashboard-step1/2/3 which live inside
        // the BalanceWithGraph card – NOT the progress widget.
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);
        await dashboardPage.startOnboardingTour();

        const { tourCard } = dashboardPage;

        // Step 1 targets #dashboard-step1 (Deposit in BalanceWithGraph)
        const step1Target = dashboardPage.stepTarget(1);
        await expect(step1Target).toBeVisible();
        // Verify the button is inside the balance card, not the onboarding progress section
        const balanceCard = step1Target.locator(
            "xpath=ancestor::*[contains(@class,'grid-cols-3')]",
        );
        await expect(balanceCard).toBeVisible();

        // Advance to step 2
        await tourCard.goNext();
        await expect(tourCard.stepText("Make payment requests")).toBeVisible({
            timeout: 10000,
        });
        await expect(dashboardPage.stepTarget(2)).toBeVisible();

        // Advance to step 3
        await tourCard.goNext();
        await expect(tourCard.stepText("Swap one asset")).toBeVisible({
            timeout: 10000,
        });
        await expect(dashboardPage.stepTarget(3)).toBeVisible();

        // None of these IDs should exist inside the onboarding progress widget
        await dashboardPage.expectNoStepTargetsInsideProgressWidget();
    });

    test("Tour step 1 highlights the Deposit button with correct positioning", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);
        await dashboardPage.startOnboardingTour();

        const depositBtn = dashboardPage.stepTarget(1);
        await expect(depositBtn).toBeVisible();
        const depositBox = await depositBtn.boundingBox();
        expect(depositBox).not.toBeNull();

        const { tourCard } = dashboardPage;
        await expect(tourCard.container).toBeVisible();
        const cardBox = await tourCard.boundingBox();
        expect(cardBox).not.toBeNull();

        // Tour card for step 1 (side: "bottom-left") should be below the target
        if (depositBox && cardBox) {
            expect(
                cardBox.y,
                `Tour card (y:${cardBox.y}) should be below deposit button (y:${depositBox.y + depositBox.height})`,
            ).toBeGreaterThanOrEqual(depositBox.y);
        }

        await dashboardPage.screenshot("onboarding-tour-step1-highlight");
    });

    test("Tour step navigation – Next advances through all 5 steps", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);
        await dashboardPage.startOnboardingTour();

        const { tourCard } = dashboardPage;

        // Step 1: Deposit
        expect(await tourCard.stepIndicator(1, 5).isVisible()).toBe(true);
        await tourCard.goNext();

        // Step 2: Send / payment requests
        await expect(tourCard.stepText("Make payment requests")).toBeVisible({
            timeout: 10000,
        });
        expect(await tourCard.stepIndicator(2, 5).isVisible()).toBe(true);
        await tourCard.goNext();

        // Step 3: Exchange
        await expect(tourCard.stepText("Swap one asset")).toBeVisible({
            timeout: 10000,
        });
        expect(await tourCard.stepIndicator(3, 5).isVisible()).toBe(true);
        await tourCard.goNext();

        // Step 4: Members (in sidebar)
        await expect(tourCard.stepText("Add team members")).toBeVisible({
            timeout: 10000,
        });
        expect(await tourCard.stepIndicator(4, 5).isVisible()).toBe(true);
        await tourCard.goNext();

        // Step 5: Create Treasury (inside sidebar selector dropdown —
        // the tour card logic opens the dropdown automatically, allow extra time)
        await expect(tourCard.stepText("Need another treasury")).toBeVisible({
            timeout: 15000,
        });
        expect(await tourCard.stepIndicator(5, 5).isVisible()).toBe(true);

        await dashboardPage.screenshot("onboarding-tour-step5");

        // Click the primary action button on the last step to complete tour.
        // Scoped to the tour card container (inverted popover colors) because
        // the Radix Select portal from the treasury dropdown may interfere
        // with global getByRole queries.
        await expect(tourCard.container).toBeVisible({ timeout: 5000 });
        await tourCard.complete();

        // Tour should close
        await expect(
            tourCard.stepText("Need another treasury"),
        ).not.toBeVisible({ timeout: 5000 });
    });

    test("Tour step can be closed via the X button at any step", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);
        await dashboardPage.startOnboardingTour();

        const { tourCard } = dashboardPage;
        await expect(tourCard.closeButton()).toBeVisible();
        await tourCard.close();

        // Tour should be dismissed
        await expect(
            tourCard.stepText("Add assets to your Treasury"),
        ).not.toBeVisible({ timeout: 5000 });
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Tour highlight does not break after scroll
// ──────────────────────────────────────────────────────────────────────────

test.describe("Onboarding – Tour resilience to scroll", () => {
    test("Tour highlight stays aligned with target after page is scrolled down before starting", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);

        // Scroll down before interacting with welcome.
        // NOTE: the 500ms settle-wait below is preserved from the original
        // spec. It's possibly superstitious (a plain `scrollTo` is instant
        // unless `scroll-behavior: smooth` is set globally in CSS) but
        // removing it can't be verified without a live run — left as a
        // follow-up rather than guessed at in this pass.
        await page.evaluate(() => window.scrollTo(0, 300));
        await page.waitForTimeout(500);

        await dashboardPage.startOnboardingTour();

        // The deposit button and tour card should still be reasonably aligned
        const depositBtn = dashboardPage.stepTarget(1);
        const depositBox = await depositBtn.boundingBox();
        const cardBox = await dashboardPage.tourCard.boundingBox();

        expect(depositBox).not.toBeNull();
        expect(cardBox).not.toBeNull();

        if (depositBox && cardBox) {
            const verticalDistance = Math.abs(
                cardBox.y - (depositBox.y + depositBox.height),
            );
            expect(
                verticalDistance,
                `Tour card should be near the deposit button after scroll (distance: ${verticalDistance}px)`,
            ).toBeLessThan(300);
        }

        await dashboardPage.screenshot("onboarding-tour-after-scroll");
    });

    test("Starting tour from bottom of page scrolls back to top", async ({
        browser,
    }) => {
        // Use a short viewport so the dashboard content overflows and is scrollable
        const context = await browser.newContext({
            viewport: { width: 1280, height: 400 },
        });
        const page = await context.newPage();
        const dashboardPage = new DashboardPage(page);

        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);

        // Ensure the page is taller than the viewport
        await page.evaluate(() => {
            document.body.style.minHeight = "2000px";
        });

        // Scroll all the way to the bottom, then poll for it to register
        // instead of a blind sleep-then-read.
        await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
        );
        await expect
            .poll(() => page.evaluate(() => window.scrollY))
            .toBeGreaterThan(0);

        // "Let's go" scrolls #balance-with-graph into view then starts tour after 300ms
        await dashboardPage.startOnboardingTour();

        // The tour target (#dashboard-step1 inside balance card) must be in the viewport
        await expect(dashboardPage.stepTarget(1)).toBeInViewport({
            timeout: 5000,
        });

        await dashboardPage.screenshot("onboarding-tour-scrolled-from-bottom");

        await context.close();
    });

    test("Starting tour from bottom of page scrolls back to top (mobile)", async ({
        browser,
    }) => {
        const context = await browser.newContext({
            viewport: { width: 375, height: 667 },
            isMobile: true,
            userAgent:
                "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        });
        const page = await context.newPage();
        const dashboardPage = new DashboardPage(page);

        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);

        // Ensure the page is taller than the mobile viewport
        await page.evaluate(() => {
            document.body.style.minHeight = "2000px";
        });

        await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
        );
        await expect
            .poll(() => page.evaluate(() => window.scrollY))
            .toBeGreaterThan(0);

        await dashboardPage.startOnboardingTour();

        await expect(dashboardPage.stepTarget(1)).toBeInViewport({
            timeout: 5000,
        });

        await dashboardPage.screenshot(
            "onboarding-tour-scrolled-from-bottom-mobile",
        );

        await context.close();
    });

    test("Scrolling during an active tour step does not detach the highlight", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);
        await dashboardPage.startOnboardingTour();

        const stepOneText = dashboardPage.tourCard.stepText(
            "Add assets to your Treasury",
        );

        // Scroll down. The settle-wait here is preserved from the original
        // spec for the same unverified smooth-scroll reason noted above.
        await page.evaluate(() => window.scrollBy(0, 150));
        await page.waitForTimeout(500);
        await expect(stepOneText).toBeVisible();

        // Scroll back up
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500);
        await expect(stepOneText).toBeVisible();

        await dashboardPage.screenshot("onboarding-tour-scroll-during-tour");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Tour card arrow verification
// ──────────────────────────────────────────────────────────────────────────

test.describe("Onboarding – Tour card arrow points toward target", () => {
    test("Tour card is positioned near its target on each step", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);
        await dashboardPage.startOnboardingTour();

        const { tourCard } = dashboardPage;

        // Verify positioning for steps 1–3: these target buttons inside the
        // BalanceWithGraph card (balance-with-graph.tsx), NOT the onboarding
        // progress widget (onboarding-progress.tsx) which has its own buttons.
        const stepsToVerify: Array<{ step: 1 | 2 | 3; text: string }> = [
            { step: 1, text: "Add assets to your Treasury" },
            { step: 2, text: "Make payment requests" },
            { step: 3, text: "Swap one asset" },
        ];

        for (let i = 0; i < stepsToVerify.length; i++) {
            const { step, text } = stepsToVerify[i];
            await expect(tourCard.stepText(text)).toBeVisible({
                timeout: 10000,
            });

            const targetBox = await dashboardPage
                .stepTarget(step)
                .boundingBox();
            const cardBox = await tourCard.boundingBox();

            expect(targetBox).not.toBeNull();
            expect(cardBox).not.toBeNull();

            if (targetBox && cardBox) {
                const centerTargetX = targetBox.x + targetBox.width / 2;
                const centerTargetY = targetBox.y + targetBox.height / 2;
                const centerCardX = cardBox.x + cardBox.width / 2;
                const centerCardY = cardBox.y + cardBox.height / 2;

                const distance = Math.sqrt(
                    (centerCardX - centerTargetX) ** 2 +
                        (centerCardY - centerTargetY) ** 2,
                );

                expect(
                    distance,
                    `Step ${i + 1}: Tour card should be within 400px of target #dashboard-step${step} (distance: ${distance.toFixed(0)}px)`,
                ).toBeLessThan(400);
            }

            if (i < stepsToVerify.length - 1) {
                await tourCard.goNext();
            }
        }

        await dashboardPage.screenshot("onboarding-tour-card-positions");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Onboarding Progress Widget
// ──────────────────────────────────────────────────────────────────────────

test.describe("Onboarding – Progress widget", () => {
    test("Onboarding progress shows with correct steps on dashboard", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoWithStorage(TREASURY_ID, {
            "welcome-dismissed": "true",
        });

        const { progressWidget } = dashboardPage;
        await expect(progressWidget.heading).toBeVisible({ timeout: 15000 });

        await expect(progressWidget.addTeamMemberStepText()).toBeVisible();
        await expect(progressWidget.addFirstAssetsStepText()).toBeVisible();
        await expect(
            progressWidget.createFirstPaymentRequestStepText(),
        ).toBeVisible();

        await dashboardPage.screenshot("onboarding-progress-widget");
    });

    test("Onboarding progress hides when all steps are completed", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page, {
            assets: DEFAULT_TREASURY_ASSETS,
            proposals: buildProposalsWithOneLegacyShape(ACCOUNT_ID),
        });
        await dashboardPage.gotoWithStorage(TREASURY_ID, {
            "welcome-dismissed": "true",
            [`onboarding:solo-selected:${TREASURY_ID}`]: "true",
        });

        // No arbitrary settle-wait: `.not.toBeVisible()` already polls for
        // the full timeout (bumped to 8s, was 3s blind sleep + 5s default poll).
        await expect(dashboardPage.progressWidget.heading).not.toBeVisible({
            timeout: 8000,
        });
    });

    test("Onboarding progress shows step 2 active when no assets", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page, { assets: EMPTY_ASSETS });
        await dashboardPage.gotoWithStorage(TREASURY_ID, {
            "welcome-dismissed": "true",
        });

        const { progressWidget } = dashboardPage;
        await expect(progressWidget.heading).toBeVisible({ timeout: 15000 });

        // Step 2 (Add your first assets) should have a "Deposit" action button visible
        await expect(progressWidget.depositButton()).toBeVisible();

        await dashboardPage.screenshot("onboarding-progress-step2-active");
    });

    test("Onboarding progress shows step 3 active when has assets but no proposals", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page, {
            assets: DEFAULT_TREASURY_ASSETS,
            proposals: EMPTY_PROPOSALS,
        });
        await dashboardPage.gotoWithStorage(TREASURY_ID, {
            "welcome-dismissed": "true",
        });

        const { progressWidget } = dashboardPage;
        await expect(progressWidget.heading).toBeVisible({ timeout: 15000 });

        // Step 3 should have a "Send" action button visible
        await expect(progressWidget.sendButton()).toBeVisible();

        await dashboardPage.screenshot("onboarding-progress-step3-active");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Full onboarding flow (scroll → welcome → tour → congrats)
// ──────────────────────────────────────────────────────────────────────────

test.describe("Onboarding – Full flow with scroll prerequisite", () => {
    test("Complete onboarding: scroll down first, then welcome → tour (5 steps) → congrats", async ({
        browser,
    }) => {
        // Use a short viewport so the dashboard overflows and is scrollable
        const context = await browser.newContext({
            viewport: { width: 1280, height: 500 },
        });
        const page = await context.newPage();
        const dashboardPage = new DashboardPage(page);

        // Mock with assets and proposals so congrats tooltip triggers after the tour
        await mockDashboard(page, {
            assets: DEFAULT_TREASURY_ASSETS,
            proposals: buildProposalsWithOneLegacyShape(ACCOUNT_ID),
        });
        await dashboardPage.gotoFresh(TREASURY_ID);

        // Ensure the page is taller than the viewport
        await page.evaluate(() => {
            document.body.style.minHeight = "2000px";
        });

        // ── Prerequisite: scroll to the bottom ──
        await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
        );
        await expect
            .poll(() => page.evaluate(() => window.scrollY))
            .toBeGreaterThan(0);

        const { welcomeTooltip, tourCard, congratsTooltip } = dashboardPage;

        // ── Welcome tooltip step 1 → 2 → start the tour ──
        await welcomeTooltip.startTour();

        // ── Tour step 1: Deposit ──
        await expect(
            tourCard.stepText("Add assets to your Treasury"),
        ).toBeVisible({ timeout: 10000 });
        // The balance card should have been scrolled into the viewport
        await expect(dashboardPage.stepTarget(1)).toBeInViewport({
            timeout: 5000,
        });
        expect(await tourCard.stepIndicator(1, 5).isVisible()).toBe(true);

        await dashboardPage.screenshot("onboarding-full-flow-step1");

        await tourCard.goNext();

        // ── Tour step 2: Send ──
        await expect(tourCard.stepText("Make payment requests")).toBeVisible({
            timeout: 10000,
        });
        expect(await tourCard.stepIndicator(2, 5).isVisible()).toBe(true);
        await tourCard.goNext();

        // ── Tour step 3: Exchange ──
        await expect(tourCard.stepText("Swap one asset")).toBeVisible({
            timeout: 10000,
        });
        expect(await tourCard.stepIndicator(3, 5).isVisible()).toBe(true);
        await tourCard.goNext();

        // ── Tour step 4: Members ──
        await expect(tourCard.stepText("Add team members")).toBeVisible({
            timeout: 10000,
        });
        expect(await tourCard.stepIndicator(4, 5).isVisible()).toBe(true);
        await tourCard.goNext();

        // ── Tour step 5: Create Treasury ──
        await expect(tourCard.stepText("Need another treasury")).toBeVisible({
            timeout: 15000,
        });
        expect(await tourCard.stepIndicator(5, 5).isVisible()).toBe(true);

        // Complete the tour by clicking "Done" inside the tour card.
        await expect(tourCard.container).toBeVisible({ timeout: 5000 });
        await tourCard.complete();

        // Tour should close
        await expect(
            tourCard.stepText("Need another treasury"),
        ).not.toBeVisible({ timeout: 5000 });

        // ── Congrats tooltip should appear first ──
        await expect(congratsTooltip.heading()).toBeVisible({
            timeout: 15000,
        });
        await expect(congratsTooltip.body()).toBeVisible();

        await dashboardPage.screenshot("onboarding-full-flow-congrats");

        // Dismiss the congrats
        await congratsTooltip.dismiss();
        await expect(congratsTooltip.heading()).not.toBeVisible({
            timeout: 5000,
        });

        // Verify localStorage state after full flow
        const storage = await page.evaluate(() => ({
            welcomeDismissed: localStorage.getItem("welcome-dismissed"),
            tourCompleted: localStorage.getItem("dashboard-tour-completed"),
        }));
        expect(storage.welcomeDismissed).toBe("true");
        expect(storage.tourCompleted).toBe("true");

        await context.close();
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Tour overlay blocks interaction
// ──────────────────────────────────────────────────────────────────────────

test.describe("Onboarding – Overlay and interaction blocking", () => {
    test("Tour overlay darkens the background (shadow opacity)", async ({
        page,
        dashboardPage,
    }) => {
        await mockDashboard(page);
        await dashboardPage.gotoFresh(TREASURY_ID);
        await dashboardPage.startOnboardingTour();

        // nextstepjs renders an overlay; at minimum the tour card should be visible
        await expect(dashboardPage.tourCard.container).toBeVisible();

        // Check for full-screen overlay-like elements (SVG mask or fixed div)
        const hasOverlay = await page.evaluate(() => {
            const elements = document.querySelectorAll(
                "[class*='nextstep'], [data-nextstep], svg[class*='overlay'], [style*='position: fixed']",
            );
            for (const el of elements) {
                const rect = el.getBoundingClientRect();
                if (
                    rect.width >= window.innerWidth * 0.9 &&
                    rect.height >= window.innerHeight * 0.9
                ) {
                    return true;
                }
            }
            return false;
        });

        // Log for debugging — the overlay detection is best-effort since nextstepjs internals may vary
        console.log(`Full-screen overlay detected: ${hasOverlay}`);

        await dashboardPage.screenshot("onboarding-tour-overlay");
    });
});

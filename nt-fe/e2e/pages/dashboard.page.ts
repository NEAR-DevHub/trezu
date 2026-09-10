import { expect, type Page } from "@playwright/test";
import { CongratsTooltipComponent } from "../components/congrats-tooltip.component";
import { OnboardingProgressComponent } from "../components/onboarding-progress.component";
import { TourCardComponent } from "../components/tour-card.component";
import { WelcomeTooltipComponent } from "../components/welcome-tooltip.component";
import { waitForResponseIncludes } from "../helpers/wait-for-response";
import { BasePage } from "./base.page";

const ONBOARDING_STORAGE_KEYS = [
    "welcome-dismissed",
    "dashboard-tour-completed",
    "info-box-tour-dismissed",
    "payments-bulk-tour-shown",
    "payments-pending-tour-shown",
    "exchange-settings-tour-shown",
    "members-pending-tour-shown",
    "guest-save-tour-shown",
    "new-feature-tour-shown",
];

export class DashboardPage extends BasePage {
    readonly welcomeTooltip: WelcomeTooltipComponent;
    readonly tourCard: TourCardComponent;
    readonly congratsTooltip: CongratsTooltipComponent;
    readonly progressWidget: OnboardingProgressComponent;

    constructor(page: Page) {
        super(page);
        this.welcomeTooltip = new WelcomeTooltipComponent(page);
        this.tourCard = new TourCardComponent(page);
        this.congratsTooltip = new CongratsTooltipComponent(page);
        this.progressWidget = new OnboardingProgressComponent(page);
    }

    /** `#dashboard-step1/2/3` — the BalanceWithGraph buttons the tour actually targets (not the progress widget's look-alikes). */
    stepTarget(step: 1 | 2 | 3) {
        return this.page.locator(`#dashboard-step${step}`);
    }

    /**
     * One level up from the progress-widget heading — used only to assert
     * dashboard-step target ids are absent from the widget (kept at this
     * shallower scope to match the original spec's exact locator).
     */
    private progressWidgetShallowScope() {
        return this.page.getByText(/set up your treasury/i).locator("..");
    }

    async expectNoStepTargetsInsideProgressWidget(): Promise<void> {
        const scope = this.progressWidgetShallowScope();
        for (const step of [1, 2, 3] as const) {
            expect(await scope.locator(`#dashboard-step${step}`).count()).toBe(
                0,
            );
        }
    }

    /** Navigate to the treasury dashboard, waiting for the bootstrap auth/assets calls. */
    async goto(treasuryId: string): Promise<void> {
        const authResp = waitForResponseIncludes(this.page, "/auth/me", {
            timeout: 60_000,
            optional: true,
        });
        const assetsResp = waitForResponseIncludes(this.page, "/user/assets", {
            timeout: 60_000,
            optional: true,
        });

        await this.page.goto(`/${treasuryId}`, {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
        });
        await expect(this.main.first()).toBeVisible({ timeout: 30_000 });

        await authResp;
        await assetsResp;
    }

    /** Navigate with all onboarding localStorage flags cleared before hydration, so every tooltip/tour is eligible to show. */
    async gotoFresh(treasuryId: string): Promise<void> {
        await this.page.addInitScript((keys) => {
            for (const key of keys) {
                localStorage.removeItem(key);
            }
        }, ONBOARDING_STORAGE_KEYS);

        await this.goto(treasuryId);
    }

    /** Navigate with the given localStorage entries pre-seeded before hydration. */
    async gotoWithStorage(
        treasuryId: string,
        storageEntries: Record<string, string>,
    ): Promise<void> {
        await this.page.addInitScript((entries) => {
            for (const [key, value] of Object.entries(entries)) {
                localStorage.setItem(key, value);
            }
        }, storageEntries);

        await this.goto(treasuryId);
    }

    /** Dismisses the welcome tooltip and waits for tour step 1 to render. */
    async startOnboardingTour(): Promise<void> {
        await this.welcomeTooltip.startTour();
        await expect(
            this.tourCard.stepText("Add assets to your Treasury"),
        ).toBeVisible({ timeout: 10000 });
    }
}

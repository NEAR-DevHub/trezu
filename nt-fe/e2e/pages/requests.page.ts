import { expect, type Locator } from "@playwright/test";
import { waitForResponseIncludes } from "../helpers/wait-for-response";
import { BasePage } from "./base.page";

export class RequestsPage extends BasePage {
    async goto(treasuryId: string): Promise<void> {
        const authResp = waitForResponseIncludes(this.page, "/auth/me");
        const proposalsResp = waitForResponseIncludes(this.page, "/proposals/");
        await this.page.goto(`/${treasuryId}/requests`);
        await authResp;
        await proposalsResp;
    }

    /** The dashboard also renders Send/Exchange CTAs (inside the onboarding progress widget) — used by the CTA-overlap-with-onboarding test. */
    async gotoDashboard(treasuryId: string): Promise<void> {
        const authResp = waitForResponseIncludes(this.page, "/auth/me");
        const assetsResp = waitForResponseIncludes(this.page, "/user/assets");
        await this.page.goto(`/${treasuryId}`);
        await authResp;
        await assetsResp;
    }

    sendButton() {
        return this.main.getByRole("button", { name: /send/i });
    }

    exchangeButton() {
        return this.main.getByRole("button", { name: /exchange/i });
    }

    /** Wraps the Send/Exchange CTAs — used for a zoomed-in overlap-debugging screenshot. */
    ctaContainer() {
        return this.page.locator(".flex.gap-4.w-\\[300px\\]");
    }

    /** The onboarding-progress-widget's own Send button, distinct from BalanceWithGraph's `#dashboard-step2` one. */
    onboardingStepSendButton() {
        return this.main.locator("button:not(#dashboard-step2)", {
            hasText: /send/i,
        });
    }

    onboardingHeading() {
        return this.main.getByText(/set up your treasury/i);
    }

    emptyStateHeading() {
        return this.page.getByText("Create your first request");
    }

    emptyStateDescription() {
        return this.page.getByText(/requests for payments, exchanges/i);
    }

    allCaughtUpHeading() {
        return this.main.getByText("All caught up!");
    }

    allCaughtUpDescription() {
        return this.main.getByText(/there are no pending requests/i);
    }

    /**
     * Asserts two locators' bounding boxes don't overlap and returns both
     * boxes so callers can layer on their own width/gap assertions.
     */
    async expectNoOverlap(
        a: Locator,
        b: Locator,
        context: string,
    ): Promise<{
        boxA: Awaited<ReturnType<Locator["boundingBox"]>>;
        boxB: Awaited<ReturnType<Locator["boundingBox"]>>;
    }> {
        const boxA = await a.boundingBox();
        const boxB = await b.boundingBox();
        expect(
            boxA,
            `${context}: first element has no bounding box`,
        ).not.toBeNull();
        expect(
            boxB,
            `${context}: second element has no bounding box`,
        ).not.toBeNull();

        if (boxA && boxB) {
            const horizontalOverlap =
                boxA.x < boxB.x + boxB.width && boxA.x + boxA.width > boxB.x;
            const verticalOverlap =
                boxA.y < boxB.y + boxB.height && boxA.y + boxA.height > boxB.y;

            expect(
                horizontalOverlap && verticalOverlap,
                `${context}: elements overlap (a=${JSON.stringify(boxA)}, b=${JSON.stringify(boxB)})`,
            ).toBe(false);
        }

        return { boxA, boxB };
    }
}

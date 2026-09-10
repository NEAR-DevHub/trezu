import { defineConfig, devices } from "@playwright/test";
import {
    COOKIE_CONSENT_COOKIE,
    ESSENTIAL_ONLY_CONSENT,
    serializeConsentCookie,
} from "./lib/cookie-consent";

/**
 * Playwright configuration for Treasury26 Frontend E2E Tests
 *
 * Uses the published sandbox Docker image as the backend.
 * Run with: npx playwright test
 */
export default defineConfig({
    testDir: "./e2e",
    globalSetup: "./e2e/global-setup.ts",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: "html",

    use: {
        baseURL: "http://localhost:3000",
        // Pre-answer the cookie banner so it never overlaps test targets; tests
        // that exercise the banner itself clear this cookie first.
        storageState: {
            cookies: [
                {
                    name: COOKIE_CONSENT_COOKIE,
                    value: serializeConsentCookie(ESSENTIAL_ONLY_CONSENT),
                    domain: "localhost",
                    path: "/",
                    expires: -1,
                    httpOnly: false,
                    secure: false,
                    sameSite: "Lax",
                },
            ],
            origins: [],
        },
        // Record every test (pass or fail) so the published HTML report is a
        // full visual walkthrough of the behaviour the PR produces, not just a
        // failure debugging aid. The report embeds these videos so reviewers
        // can watch them inline. See .github/workflows/e2e-report.yml.
        video: {
            mode: "on",
            size: { width: 1280, height: 800 },
        },
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],

    /* Run local dev server before starting the tests */
    webServer: {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
        env: {
            NEXT_PUBLIC_BACKEND_API_BASE:
                process.env.BACKEND_URL || "http://localhost:8080",
        },
    },
});

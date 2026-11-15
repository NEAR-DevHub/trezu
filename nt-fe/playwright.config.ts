import { defineConfig, devices } from "@playwright/test";

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

    /*
     * Run the app before starting the tests. CI (E2E_NEXT_START=1) serves a
     * production build made beforehand with `bun run build`: the dev server
     * compiles every route on first visit, which dominated CI test time.
     * Locally the dev server is used, so no build step is needed.
     */
    webServer: {
        command: process.env.E2E_NEXT_START ? "npm run start" : "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
        env: {
            NEXT_PUBLIC_BACKEND_API_BASE:
                process.env.BACKEND_URL || "http://localhost:8080",
        },
    },
});

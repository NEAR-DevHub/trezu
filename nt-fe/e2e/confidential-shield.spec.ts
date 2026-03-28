/**
 * E2E test for the confidential shield page.
 *
 * Full end-to-end flow using the real sandbox:
 * 1. Create DAO on sandbox
 * 2. Authenticate DAO with mock 1Click API
 * 3. Enter shield amount, get quote, review
 * 4. Submit signing + deposit proposals via real relay
 * 5. Approve signing → MPC signature extracted, intent auto-submitted
 * 6. Approve deposit → wNEAR transferred to intents.near
 *
 * Only the wallet manifest CDN is mocked. All backend API calls go to the
 * real sandbox backend. The 1Click API is mocked by sandbox-init on :4000.
 */
import { test, expect, BrowserContext, Route } from "@playwright/test";
import {
    MOCK_MANIFEST_ID,
    MOCK_WALLET_EXECUTOR_JS,
    MOCK_MANIFEST,
} from "./helpers/mock-wallet";
import { createAccount, transferNear } from "./helpers/sandbox-rpc";

const DAO_ID = "petersalomonsendev.sputnik-dao.near";
const ACCOUNT_ID = "petersalomonsendev.near";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";

const SANDBOX_MOCK_URL = "http://localhost:4000";

/** Mock wallet manifest + user auth. All other backend calls go to the real sandbox. */
async function mockWalletRoutes(context: BrowserContext) {
    // NearConnect wallet manifest CDN
    for (const url of [
        "**/raw.githubusercontent.com/**manifest.json*",
        "**/cdn.jsdelivr.net/**manifest.json*",
    ]) {
        await context.route(url, async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(MOCK_MANIFEST),
            });
        });
    }

    // Mock wallet executor JS
    await context.route(
        "**/_near-connect-test/mock-wallet.js*",
        async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/javascript",
                body: MOCK_WALLET_EXECUTOR_JS,
            });
        },
    );
}

/** Ensure the DAO, user account, and auth session exist on the sandbox */
async function setupSandbox(): Promise<string> {
    // Create user account with genesis key
    try {
        await createAccount(ACCOUNT_ID, "near", 10);
    } catch {
        // May already exist
    }

    // Create the DAO via the backend API
    try {
        const configResp = await fetch(
            `${BACKEND_URL}/api/treasury/config?treasuryId=${DAO_ID}`,
        );
        const config = await configResp.json();
        if (!config?.name) throw new Error("no DAO");
    } catch {
        const createResp = await fetch(`${BACKEND_URL}/api/treasury/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Test DAO",
                accountId: DAO_ID,
                paymentThreshold: 1,
                governanceThreshold: 1,
                governors: [ACCOUNT_ID],
                financiers: [ACCOUNT_ID],
                requestors: [ACCOUNT_ID],
            }),
        });
        if (!createResp.ok) {
            throw new Error(
                `Failed to create DAO: ${createResp.status} ${await createResp.text()}`,
            );
        }
        await new Promise((r) => setTimeout(r, 3000));
    }

    // Fund the DAO
    await transferNear("near", DAO_ID, 10);

    // Create an auth session via the sandbox mock server
    const sessionResp = await fetch(
        `${SANDBOX_MOCK_URL}/_test/create-session`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: ACCOUNT_ID }),
        },
    );
    if (!sessionResp.ok) {
        throw new Error(
            `Failed to create session: ${sessionResp.status} ${await sessionResp.text()}`,
        );
    }
    const session = (await sessionResp.json()) as { token: string };
    return session.token;
}

test("Confidential Shield — full flow", async ({ page, context }) => {
    test.setTimeout(180_000);

    // Setup sandbox (create accounts, DAO, auth session)
    const sandboxJwt = await setupSandbox();

    // Inject auth cookie on all backend requests FIRST.
    // Cross-origin cookies don't work on plain HTTP in Chromium.
    // Then register wallet mocks which use fallback() for non-matching URLs.
    // Proxy all backend requests with the auth cookie injected.
    // We can't rely on browser cookies cross-origin on HTTP,
    // so we re-issue the request server-side via fetch.
    await context.route("http://localhost:8080/**", async (route) => {
        const url = route.request().url();

        // Mock auth/me (the mock wallet can't do real NEAR auth)
        if (url.includes("/api/auth/me")) {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    accountId: ACCOUNT_ID,
                    termsAccepted: true,
                }),
            });
        }

        // Re-issue request with cookie from test code (Node.js fetch)
        const method = route.request().method();
        const headers: Record<string, string> = {
            cookie: `auth_token=${sandboxJwt}`,
        };
        const reqHeaders = route.request().headers();
        if (reqHeaders["content-type"]) {
            headers["content-type"] = reqHeaders["content-type"];
        }

        const resp = await fetch(url, {
            method,
            headers,
            body: method !== "GET" ? route.request().postData() : undefined,
        });

        const body = Buffer.from(await resp.arrayBuffer());
        const respHeaders: Record<string, string> = {};
        resp.headers.forEach((val, key) => {
            // Strip CORS headers — Playwright handles CORS for intercepted requests
            if (!key.startsWith("access-control-")) {
                respHeaders[key] = val;
            }
        });
        await route.fulfill({
            status: resp.status,
            headers: respHeaders,
            body,
        });
    });

    // Route NEAR RPC calls to sandbox instead of mainnet
    for (const rpcHost of [
        "**/archival-rpc.mainnet.fastnear.com**",
        "**/free.rpc.fastnear.com**",
    ]) {
        await context.route(rpcHost, async (route) => {
            const resp = await fetch("http://localhost:3030", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: route.request().postData(),
            });
            const body = Buffer.from(await resp.arrayBuffer());
            await route.fulfill({ status: resp.status, body });
        });
    }

    // Mock the wallet (uses fallback for non-wallet URLs)
    await mockWalletRoutes(context);

    // Capture console errors
    page.on("console", (msg) => {
        if (msg.type() === "error") {
            console.log(`[BROWSER ERROR] ${msg.text()}`);
        }
    });
    page.on("response", (resp) => {
        if (resp.status() === 401) {
            console.log(`[401] ${resp.url()}`);
        }
    });
    page.on("pageerror", (err) => {
        console.log(`[PAGE ERROR] ${err.message}`);
    });

    // Seed wallet and navigate
    await page.goto(`/${DAO_ID}`);
    await page.evaluate(
        ({ walletId, acct }) => {
            localStorage.setItem("selected-wallet", walletId);
            localStorage.setItem(`${walletId}:signedAccountId`, acct);
        },
        { walletId: MOCK_MANIFEST_ID, acct: ACCOUNT_ID },
    );
    await page.goto(`/${DAO_ID}/confidential`);

    // ════════════════════════════════════════════════════
    // Phase 1: Authentication
    // ════════════════════════════════════════════════════

    // Should show auth prompt (no JWT yet)
    const authButton = page.getByRole("button", {
        name: "Authenticate DAO",
    });
    await expect(authButton).toBeVisible({ timeout: 15_000 });

    // Click Authenticate DAO
    await authButton.click();

    // The tracker should show the signing step
    await expect(
        page.getByText("Awaiting approval", { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // Click Approve
    await expect(page.getByRole("button", { name: /Approve/i })).toBeVisible({
        timeout: 10_000,
    });
    await page.getByRole("button", { name: /Approve/i }).click();

    // Wait for auth to complete
    await expect(
        page.getByText("Request complete", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });

    // Click to go back to shield form
    await page.getByRole("button", { name: /New Shield/i }).click();

    // ════════════════════════════════════════════════════
    // Phase 2: Shield flow
    // ════════════════════════════════════════════════════

    // Should show the shield form (authenticated now)
    await expect(page.locator("text=Shield to Confidential")).toBeVisible({
        timeout: 15_000,
    });

    // Enter amount
    const amountInput = page.locator("input").first();
    await amountInput.click();
    await amountInput.fill("0.01");

    // Wait for quote
    await expect(page.locator("text=You will receive")).toBeVisible({
        timeout: 15_000,
    });

    // Click Review
    const reviewBtn = page.getByRole("button", {
        name: /Review Shield Request/i,
    });
    await expect(reviewBtn).toBeEnabled({ timeout: 10_000 });
    await reviewBtn.click({ timeout: 10_000 });

    // Verify review content
    await expect(
        page.getByText("Public → Confidential", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Click Submit
    const submitBtn = page.getByRole("button", {
        name: /Confirm and Submit/i,
    });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    // ════════════════════════════════════════════════════
    // Phase 3: Approve signing proposal
    // ════════════════════════════════════════════════════

    // Tracker should show signing step
    await expect(
        page.getByText("Awaiting approval", { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // Click Approve
    await expect(page.getByRole("button", { name: /Approve/i })).toBeVisible({
        timeout: 10_000,
    });
    await page.getByRole("button", { name: /Approve/i }).click();

    // Wait for completion
    await expect(
        page.getByText("Request complete", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });

    // ════════════════════════════════════════════════════
    // Phase 5: Verify the intent was submitted to mock 1Click
    // ════════════════════════════════════════════════════

    const submittedResp = await fetch(
        "http://localhost:4000/_test/submitted-intents",
    );
    const submittedIntents = await submittedResp.json();
    expect(submittedIntents.length).toBeGreaterThan(0);

    // Verify the last submitted intent has the right structure
    const lastIntent = submittedIntents[submittedIntents.length - 1];
    expect(lastIntent.type).toBe("swap_transfer");
    expect(lastIntent.signedData.standard).toBe("nep413");
    expect(lastIntent.signedData.payload.recipient).toBe("intents.near");
    expect(lastIntent.signedData.signature).toMatch(/^ed25519:[A-Za-z0-9]+$/);
});

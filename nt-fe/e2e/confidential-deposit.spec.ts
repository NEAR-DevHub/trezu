/**
 * E2E test for confidential treasury deposits.
 *
 * Verifies that confidential treasuries use the same deposit UI
 * (dashboard deposit modal) as public treasuries:
 * 1. Create a regular DAO on sandbox (avoids complex confidential setup)
 * 2. Override isConfidential flag in API responses via route interception
 * 3. Navigate to the dashboard (not /confidential page)
 * 4. Open the deposit modal
 * 5. Verify deposit address is fetched via intents API
 *    (not the direct treasury account ID)
 *
 * Bridge RPC (bridge-tokens, deposit-address) is mocked at the Playwright
 * route level since the sandbox doesn't include a bridge RPC mock.
 * The isConfidential flag is injected via API response overrides so we
 * don't need the backend's complex MPC-based confidential DAO creation.
 */
import { test, expect, BrowserContext, Route } from "@playwright/test";
import {
    MOCK_MANIFEST_ID,
    MOCK_WALLET_EXECUTOR_JS,
    MOCK_MANIFEST,
} from "./helpers/mock-wallet";
import { createAccount, transferNear } from "./helpers/sandbox-rpc";

const DAO_ID = "confdeposit.sputnik-dao.near";
const ACCOUNT_ID = "confdeposit.near";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";
const SANDBOX_MOCK_URL = "http://localhost:4000";

/**
 * Mock deposit address returned by the intents API.
 * Deliberately different from DAO_ID so we can assert the address
 * came from intents and not the direct treasury account.
 */
const MOCK_DEPOSIT_ADDRESS =
    "d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e";

const MOCK_BRIDGE_TOKENS = {
    assets: [
        {
            id: "near",
            assetName: "NEAR",
            name: "Near",
            icon: "https://s2.coinmarketcap.com/static/img/coins/128x128/6535.png",
            networks: [
                {
                    id: "near:mainnet:native",
                    name: "Near Protocol",
                    symbol: "NEAR",
                    chainIcons: {
                        dark: "https://near-intents.org/static/icons/network/near.svg",
                        light: "https://near-intents.org/static/icons/network/near_dark.svg",
                    },
                    chainId: "near:mainnet",
                    decimals: 24,
                    minDepositAmount: "100000000000000000000000",
                },
            ],
        },
        {
            id: "usdc",
            assetName: "USDC",
            name: "USD Coin",
            icon: "https://s2.coinmarketcap.com/static/img/coins/128x128/3408.png",
            networks: [
                {
                    id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
                    name: "Near Protocol",
                    symbol: "USDC",
                    chainIcons: {
                        dark: "https://near-intents.org/static/icons/network/near.svg",
                        light: "https://near-intents.org/static/icons/network/near_dark.svg",
                    },
                    chainId: "near:mainnet",
                    decimals: 6,
                },
                {
                    id: "eth:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                    name: "Ethereum",
                    symbol: "USDC",
                    chainIcons: {
                        dark: "https://near-intents.org/static/icons/network/eth.svg",
                        light: "https://near-intents.org/static/icons/network/eth_dark.svg",
                    },
                    chainId: "eth:1",
                    decimals: 6,
                    minDepositAmount: "3000000",
                },
            ],
        },
    ],
};

/** Mock wallet manifest CDN + executor JS. */
async function mockWalletRoutes(context: BrowserContext) {
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

/** Ensure the DAO, user account, and auth session exist on the sandbox. */
async function setupSandbox(): Promise<string> {
    try {
        await createAccount(ACCOUNT_ID, "near", 10);
    } catch {
        // May already exist
    }

    // Create a regular DAO (isConfidential is injected via route interception
    // to avoid the complex MPC-based confidential setup on sandbox)
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
                name: "Confidential Deposit Test",
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

/**
 * Proxy a backend request with JWT auth, optionally transforming the
 * JSON response body before fulfilling. When `transform` is provided
 * the response is parsed as JSON, passed through the callback, and
 * the modified result is returned to the browser.
 */
async function proxyWithJwt(
    route: Route,
    jwt: string,
    transform?: (data: any) => any,
) {
    const url = route.request().url();
    const method = route.request().method();
    const headers: Record<string, string> = {
        cookie: `auth_token=${jwt}`,
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

    if (transform && resp.ok) {
        const data = await resp.json();
        const transformed = transform(data);
        return route.fulfill({
            status: resp.status,
            contentType: "application/json",
            body: JSON.stringify(transformed),
        });
    }

    const body = Buffer.from(await resp.arrayBuffer());
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((val, key) => {
        if (!key.startsWith("access-control-")) {
            respHeaders[key] = val;
        }
    });
    return route.fulfill({
        status: resp.status,
        headers: respHeaders,
        body,
    });
}

test("Confidential deposit — dashboard deposit modal flow", async ({
    page,
    context,
}) => {
    test.setTimeout(180_000);

    const sandboxJwt = await setupSandbox();

    // Track whether deposit-address was requested (confidential treasuries
    // must always go through the intents API, even for NEAR-on-NEAR)
    let depositAddressRequested = false;

    // Intercept backend requests: inject JWT, mock bridge endpoints,
    // and override isConfidential in treasury-related responses
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

        // Mock bridge-tokens (Bridge RPC not available in sandbox)
        if (url.includes("/api/intents/bridge-tokens")) {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(MOCK_BRIDGE_TOKENS),
            });
        }

        // Mock deposit-address (Bridge RPC not available in sandbox)
        if (url.includes("/api/intents/deposit-address")) {
            depositAddressRequested = true;
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    address: MOCK_DEPOSIT_ADDRESS,
                    memo: null,
                    minAmount: "100000000000000000000000",
                }),
            });
        }

        // Override isConfidential in user/treasuries response
        if (url.includes("/api/user/treasuries")) {
            return proxyWithJwt(route, sandboxJwt, (data) => {
                if (Array.isArray(data)) {
                    for (const t of data) {
                        t.isConfidential = true;
                        if (t.config) t.config.isConfidential = true;
                    }
                }
                return data;
            });
        }

        // Override isConfidential in treasury/config response
        if (url.includes("/api/treasury/config")) {
            return proxyWithJwt(route, sandboxJwt, (data) => {
                data.isConfidential = true;
                return data;
            });
        }

        // Proxy all other requests to the real sandbox backend with JWT
        return proxyWithJwt(route, sandboxJwt);
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

    await mockWalletRoutes(context);

    // Capture console errors for debugging
    page.on("console", (msg) => {
        if (msg.type() === "error") {
            console.log(`[BROWSER ERROR] ${msg.text()}`);
        }
    });
    page.on("pageerror", (err) => {
        console.log(`[PAGE ERROR] ${err.message}`);
    });

    // Seed wallet and navigate to dashboard
    await page.goto(`/${DAO_ID}`);
    await page.evaluate(
        ({ walletId, acct }) => {
            localStorage.setItem("selected-wallet", walletId);
            localStorage.setItem(`${walletId}:signedAccountId`, acct);
        },
        { walletId: MOCK_MANIFEST_ID, acct: ACCOUNT_ID },
    );
    await page.goto(`/${DAO_ID}`);

    // ════════════════════════════════════════════════════
    // Phase 1: Verify dashboard renders for confidential treasury
    // ════════════════════════════════════════════════════

    const depositButton = page.locator("#dashboard-step1");
    await expect(depositButton).toBeVisible({ timeout: 15_000 });
    await expect(depositButton).toContainText("Deposit");

    // ════════════════════════════════════════════════════
    // Phase 2: Open deposit modal and complete deposit flow
    // ════════════════════════════════════════════════════

    await depositButton.click();

    // Deposit modal should open with the standard heading
    await expect(page.getByRole("heading", { name: "Deposit" })).toBeVisible({
        timeout: 10_000,
    });

    // Should show asset/network selection prompt
    await expect(
        page.getByText("Select asset and network to see deposit address"),
    ).toBeVisible();

    // NEAR asset should be auto-selected (first in bridge tokens list)
    await expect(page.getByText("Near").first()).toBeVisible({
        timeout: 10_000,
    });

    // NEAR has only one network → should auto-select, triggering address fetch
    // Wait for deposit address section to appear
    await expect(page.getByText("Deposit Address")).toBeVisible({
        timeout: 15_000,
    });

    // The address should be the mocked intents address, NOT the treasury ID
    const addressElement = page.locator("code").first();
    await expect(addressElement).toBeVisible({ timeout: 10_000 });
    const addressText = await addressElement.textContent();
    expect(addressText).toContain(MOCK_DEPOSIT_ADDRESS.slice(0, 6));
    expect(addressText).not.toContain(DAO_ID);

    // Confidential treasury must have called deposit-address API
    // (public treasuries on NEAR would skip this and use the direct treasury ID)
    expect(depositAddressRequested).toBe(true);

    // QR code should be rendered
    await expect(page.locator("svg").first()).toBeVisible();

    // Verify info message about depositing from the correct network
    await expect(page.getByText(/Only deposit/)).toBeVisible();

    // ════════════════════════════════════════════════════
    // Phase 3: Verify "Other" asset is not available
    // (confidential treasuries restrict to bridge assets only)
    // ════════════════════════════════════════════════════

    // Open the asset selector
    const assetButton = page
        .locator("button")
        .filter({ hasText: "Near" })
        .first();
    await assetButton.click();

    // The asset selection modal should open
    await expect(
        page.getByRole("heading", { name: "Select Asset" }),
    ).toBeVisible({ timeout: 10_000 });

    // "Other" option should NOT be present for confidential treasuries
    await expect(page.getByText("Other", { exact: true })).not.toBeVisible();

    // Bridge assets should be listed
    await expect(page.getByText("USD Coin")).toBeVisible();
});

import { test, expect, type Page } from "@playwright/test";

async function setupStartPageMocks(
    page: Page,
    {
        accountId,
        creationAvailable,
        treasuries,
    }: {
        accountId?: string;
        creationAvailable: boolean;
        treasuries?: unknown[];
    },
) {
    await page.route("**/*", (route) => {
        const url = route.request().url();

        if (url.includes("/api/auth/me") || url.includes("/auth/me")) {
            return route.fulfill({
                status: accountId ? 200 : 401,
                contentType: "application/json",
                body: accountId
                    ? JSON.stringify({ accountId, termsAccepted: true })
                    : JSON.stringify({ error: "Not authenticated" }),
            });
        }

        if (
            url.includes("/api/treasury/creation-status") ||
            url.includes("/treasury/creation-status")
        ) {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ creationAvailable }),
            });
        }

        if (url.includes("/api/user/treasuries") || url.includes("/user/treasuries")) {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(treasuries ?? []),
            });
        }

        return route.continue();
    });
}

test("Start page shows Connect Wallet when signed out", async ({ page }) => {
    await setupStartPageMocks(page, { creationAvailable: true });

    await page.goto("/");

    await expect(
        page.getByRole("button", { name: /connect wallet/i }),
    ).toBeVisible();
});

test("Signed in + no treasuries => redirects to /app/new", async ({ page }) => {
    await setupStartPageMocks(page, {
        accountId: "test.near",
        creationAvailable: true,
        treasuries: [],
    });

    await page.goto("/");
    await page.waitForResponse((response) =>
        response.url().includes("/auth/me"),
    );
    await page.waitForResponse((response) =>
        response.url().includes("/user/treasuries"),
    );

    await expect(page).toHaveURL(/\/app\/new$/, { timeout: 15000 });
});

test("Signed in + has treasury => redirects to /{daoId}", async ({ page }) => {
    const daoId = "webassemblymusic-treasury.sputnik-dao.near";
    await setupStartPageMocks(page, {
        accountId: "test.near",
        creationAvailable: true,
        treasuries: [
            {
                daoId,
                config: { name: "My Treasury" },
                isMember: true,
                isSaved: true,
                isHidden: false,
            },
        ],
    });

    await page.goto("/");
    await page.waitForResponse((response) =>
        response.url().includes("/auth/me"),
    );
    await page.waitForResponse((response) =>
        response.url().includes("/user/treasuries"),
    );

    await expect(page).toHaveURL(
        new RegExp(`/${daoId.replaceAll(".", "\\.")}$`),
        { timeout: 15000 },
    );
});

test("Signed in + no treasuries + creation disabled => waitlist is shown", async ({
    page,
}) => {
    await setupStartPageMocks(page, {
        accountId: "test.near",
        creationAvailable: false,
        treasuries: [],
    });

    await page.goto("/");
    await page.waitForResponse((response) =>
        response.url().includes("/auth/me"),
    );
    await page.waitForResponse((response) =>
        response.url().includes("/user/treasuries"),
    );

    await expect(page).toHaveURL(/\/$/);
    await expect(
        page.getByRole("heading", { name: /join the trezu waitlist/i }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: /join the waitlist/i }),
    ).toBeVisible();
});
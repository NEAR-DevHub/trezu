/**
 * Composable route-mock installer for treasury pages: each spec passes only
 * the response bodies it cares about and the rest fall back to defaults from
 * fixtures/treasury-mock-data.ts. Only requests-my-vote-filter.spec.ts uses
 * it today.
 */
import type { Page } from "@playwright/test";
import {
    buildFreeSubscription,
    buildTreasuryPolicy,
    buildTreasurySummary,
    DEFAULT_TREASURY_ASSETS,
    EMPTY_PROPOSALS,
    type ProposalsResponse,
    type TreasurySummary,
} from "../fixtures/treasury-mock-data";
import {
    maybeFulfillMockWalletRequest,
    seedMockWalletAccount,
} from "../helpers/mock-wallet";

export interface TreasuryApiMockOptions {
    /** Omit to simulate a signed-out visitor (auth/me -> 401, wallet not seeded). */
    accountId?: string;
    /** Needed for the default treasury summary + monitored-accounts response. */
    treasuryId?: string;
    treasuryName?: string;
    /** Explicit list (including `[]`) overrides the single default treasury summary built from treasuryId/treasuryName. */
    treasuries?: TreasurySummary[];
    policy?: unknown;
    subscription?: unknown;
    assets?: unknown[];
    proposals?: ProposalsResponse;
}

function matchesAny(url: string, substrings: string[]): boolean {
    return substrings.some((s) => url.includes(s));
}

export async function installTreasuryApiMocks(
    page: Page,
    opts: TreasuryApiMockOptions,
): Promise<void> {
    if (opts.accountId) {
        await seedMockWalletAccount(page, opts.accountId, "init");
    }

    const treasuries =
        opts.treasuries ??
        (opts.treasuryId
            ? [
                  buildTreasurySummary(
                      opts.treasuryId,
                      opts.treasuryName ?? "Test Treasury",
                  ),
              ]
            : []);

    await page.route("**/*", async (route) => {
        if (await maybeFulfillMockWalletRequest(route)) {
            return;
        }

        const url = route.request().url();
        const json = (body: unknown, status = 200) =>
            route.fulfill({
                status,
                contentType: "application/json",
                body: JSON.stringify(body),
            });

        if (matchesAny(url, ["/api/auth/me", "/auth/me"])) {
            return opts.accountId
                ? json({ accountId: opts.accountId, termsAccepted: true })
                : json({ error: "Not authenticated" }, 401);
        }

        if (
            matchesAny(url, [
                "/api/treasury/creation-status",
                "/treasury/creation-status",
            ])
        ) {
            return json({ creationAvailable: true });
        }

        if (matchesAny(url, ["/api/user/treasuries", "/user/treasuries"])) {
            return json(treasuries);
        }

        if (matchesAny(url, ["/api/treasury/policy", "/treasury/policy"])) {
            return json(
                opts.policy ??
                    buildTreasuryPolicy(opts.accountId ?? "test.near"),
            );
        }

        if (url.includes("/api/subscription/")) {
            return json(
                opts.subscription ??
                    buildFreeSubscription(opts.treasuryId ?? ""),
            );
        }

        if (matchesAny(url, ["/api/user/assets", "/user/assets"])) {
            return json(opts.assets ?? DEFAULT_TREASURY_ASSETS);
        }

        if (matchesAny(url, ["/api/proposals/", "/proposals/"])) {
            return json(opts.proposals ?? EMPTY_PROPOSALS);
        }

        if (url.includes("/api/monitored-accounts")) {
            return json({
                accountId: opts.treasuryId,
                enabled: true,
                planType: "free",
            });
        }

        return route.continue();
    });
}

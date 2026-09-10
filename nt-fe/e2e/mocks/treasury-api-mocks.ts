/**
 * Composable route-mock installer shared by the requests-page, start-page,
 * and onboarding-tour specs. Replaces three near-identical hand-copied
 * `page.route("**\/*", ...)` blocks with one function; each spec only passes
 * the response bodies it cares about and lets the rest fall back to
 * sensible defaults.
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
    /** Branches the proposals response on the request's `statuses` query param (see requests-page's "all caught up" test). Overrides `proposals` when set. */
    proposalsByStatus?: (statuses: string | null) => ProposalsResponse;
    /**
     * balance-history/chart, user/profile and address-book mocks. Only
     * onboarding-tour's original spec mocked these (needed so
     * BalanceWithGraph doesn't hang on a full dashboard render);
     * requests-page/start-page never did. Defaults to false so this shared
     * installer reproduces each spec's original network behavior exactly —
     * flip it on only for specs that render the full dashboard shell.
     */
    includeDashboardExtras?: boolean;
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
            if (opts.proposalsByStatus) {
                const statuses = new URL(url).searchParams.get("statuses");
                return json(opts.proposalsByStatus(statuses));
            }
            return json(opts.proposals ?? EMPTY_PROPOSALS);
        }

        if (url.includes("/api/monitored-accounts")) {
            return json({
                accountId: opts.treasuryId,
                enabled: true,
                planType: "free",
            });
        }

        if (opts.includeDashboardExtras) {
            // Prevents BalanceWithGraph from getting stuck loading on a full dashboard render.
            if (url.includes("/balance-history/chart")) {
                return json({});
            }
            if (url.includes("/user/profile")) {
                return json({ name: "Test User" });
            }
            if (matchesAny(url, ["/api/address-book", "/address-book"])) {
                return json([]);
            }
        }

        return route.continue();
    });
}

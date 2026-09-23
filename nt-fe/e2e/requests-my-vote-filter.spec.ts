/**
 * Regression coverage for issue #1546: the Requests page "My Vote Status"
 * filter must apply every selected status (union / OR), independent of the
 * order the checkboxes were ticked in.
 *
 * Two layers, on purpose:
 * - "UI + request" tests run fully mocked. They check the pill and that each
 *   selected status reaches the proposals query, for both selection orders.
 *   They can't tell whether the backend actually ORs the statuses.
 * - "real backend" tests run against the sandbox: real proposals with real
 *   votes by test.near, filtered through the real `/api/proposals` endpoint.
 *   This is the end-to-end oracle for the ticket's Expected Result.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test-with-pages";
import { registerMockWalletRoutes } from "./helpers/mock-wallet";
import {
    addProposal,
    transferNear,
    voteOnProposal,
} from "./helpers/sandbox-rpc";
import { installTreasuryApiMocks } from "./mocks/treasury-api-mocks";
import type { RequestsPage } from "./pages/requests.page";

// Pre-seeded by global-setup.ts with test.near in every role.
const TREASURY_ID = "requests-e2e-test.sputnik-dao.near";
const ACCOUNT_ID = "test.near";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";
const SANDBOX_MOCK_URL = "http://localhost:4000";

const MY_VOTE = "My Vote Status";

test.use({ locale: "en-US" });

/** `?my_vote=` value exactly as the filter popover serializes it. */
function myVoteParam(selected: string[]): string {
    return JSON.stringify({ operation: "Is", selected });
}

/** Statuses requested for `accountId` in a `voter_votes` query value, however the pairs are grouped. */
function requestedStatuses(voterVotes: string, accountId: string): string[] {
    const statuses: string[] = [];
    let current: string | null = null;
    for (const part of voterVotes.split(",").map((p) => p.trim())) {
        const idx = part.indexOf(":");
        if (idx >= 0) {
            current = part.slice(0, idx);
            if (current === accountId) statuses.push(part.slice(idx + 1));
        } else if (current === accountId) {
            statuses.push(part);
        }
    }
    return statuses.sort();
}

async function selectMyVoteStatuses(
    requestsPage: RequestsPage,
    statuses: string[],
) {
    await requestsPage.filterToggle().click();
    await requestsPage.addFilterButton().click();
    await requestsPage.addFilterOption(MY_VOTE).click();
    for (const status of statuses) {
        await requestsPage.filterCheckbox(status).click();
    }
}

test.describe("Requests – My Vote Status filter (#1546) – UI + request", () => {
    for (const order of [
        ["No Voted", "Approved"],
        ["Approved", "No Voted"],
    ]) {
        /**
         * Scenario: SC-1 / SC-2: both selected statuses are shown and requested
         * Requirement: REQ-1 (all selected statuses applied), REQ-2 (order-independent) / issue #1546
         * Priority: P1
         */
        test(`selecting ${order.join(" → ")} requests both statuses`, async ({
            page,
            requestsPage,
        }) => {
            await installTreasuryApiMocks(page, {
                accountId: ACCOUNT_ID,
                treasuryId: TREASURY_ID,
                treasuryName: "Requests E2E Test Treasury",
            });
            // Registered after the installer, so it runs first; fallback()
            // hands the request on to the installer's mock response.
            const voterVotesSeen: string[] = [];
            await page.route("**/api/proposals/**", async (route) => {
                const vv = new URL(route.request().url()).searchParams.get(
                    "voter_votes",
                );
                if (vv) voterVotesSeen.push(vv);
                await route.fallback();
            });

            await requestsPage.gotoWithParams(TREASURY_ID, { tab: "All" });

            await test.step(`tick ${order.join(", then ")}`, async () => {
                await selectMyVoteStatuses(requestsPage, order);
            });

            // UI oracle: pill lists both, in selection order.
            await expect(requestsPage.filterPill(MY_VOTE)).toContainText(
                order.join(", "),
            );
            // URL oracle: the full selection is persisted in the filter param.
            await expect(page).toHaveURL(/my_vote=/);
            const urlMyVote = JSON.parse(
                new URL(page.url()).searchParams.get("my_vote") ?? "{}",
            ) as { selected?: string[] };
            expect([...(urlMyVote.selected ?? [])].sort()).toEqual(
                [...order].sort(),
            );

            // Data oracle: the latest query asks for BOTH statuses for this
            // account (the bug: only the first one survived).
            await expect
                .poll(() =>
                    requestedStatuses(voterVotesSeen.at(-1) ?? "", ACCOUNT_ID),
                )
                .toEqual(["Approved", "No Voted"]);
        });
    }
});

/**
 * Real-backend layer. Needs the Docker sandbox (see .agents/skills/sandbox):
 * NEAR RPC :3030, API :8080, test session service :4000.
 */
test.describe("Requests – My Vote Status filter (#1546) – real backend", () => {
    test.describe.configure({ mode: "serial", timeout: 180_000 });

    const ids = { approved: -1, rejected: -1, noVote: -1 };
    let sandboxJwt = "";

    test.beforeAll(async () => {
        const healthy = await fetch(`${BACKEND_URL}/api/health`)
            .then((r) => r.ok)
            .catch(() => false);
        // In CI the sandbox is always up; locally, skip instead of failing
        // on a missing Docker container.
        test.skip(
            !healthy && !process.env.CI,
            `Sandbox not reachable at ${BACKEND_URL}`,
        );

        // Approving a Transfer executes it, so the DAO needs a little NEAR.
        await transferNear("near", TREASURY_ID, 1);

        const runTag = `e2e-1546-${Date.now()}`;
        const makeTransfer = (label: string) =>
            addProposal(ACCOUNT_ID, TREASURY_ID, {
                description: `${runTag}-${label}`,
                kind: {
                    Transfer: {
                        token_id: "",
                        receiver_id: ACCOUNT_ID,
                        amount: "1000000000000000000000", // 0.001 NEAR
                    },
                },
            });

        ids.approved = await makeTransfer("approved");
        ids.rejected = await makeTransfer("rejected");
        ids.noVote = await makeTransfer("no-vote");
        await voteOnProposal(
            ACCOUNT_ID,
            TREASURY_ID,
            ids.approved,
            "VoteApprove",
        );
        await voteOnProposal(
            ACCOUNT_ID,
            TREASURY_ID,
            ids.rejected,
            "VoteReject",
        );

        // Precondition guard: the backend must already report each vote with
        // a single-status query, so a failure below is about combining
        // statuses, not about indexing lag.
        const idsFor = async (voterVotes: string) => {
            const url = new URL(`${BACKEND_URL}/api/proposals/${TREASURY_ID}`);
            url.searchParams.set("voter_votes", voterVotes);
            url.searchParams.set("page_size", "100");
            const body = (await (await fetch(url)).json()) as {
                proposals?: { id: number }[];
            };
            return (body.proposals ?? []).map((p) => p.id);
        };
        await expect
            .poll(() => idsFor(`${ACCOUNT_ID}:Approved`), { timeout: 60_000 })
            .toContain(ids.approved);
        await expect
            .poll(() => idsFor(`${ACCOUNT_ID}:Rejected`), { timeout: 60_000 })
            .toContain(ids.rejected);
        await expect
            .poll(() => idsFor(`${ACCOUNT_ID}:No Voted`), { timeout: 60_000 })
            .toContain(ids.noVote);

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
        sandboxJwt = ((await sessionResp.json()) as { token: string }).token;
    });

    /** Browser → real sandbox backend, signed in as test.near (same wiring as confidential-deposit.spec.ts). */
    async function wireToSandbox(page: Page) {
        const context = page.context();
        await context.route(`${BACKEND_URL}/**`, async (route) => {
            const url = route.request().url();
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
            const method = route.request().method();
            const headers: Record<string, string> = {
                cookie: `auth_token=${sandboxJwt}`,
            };
            const contentType = route.request().headers()["content-type"];
            if (contentType) headers["content-type"] = contentType;
            const resp = await fetch(url, {
                method,
                headers,
                body: method !== "GET" ? route.request().postData() : undefined,
            });
            const respHeaders: Record<string, string> = {};
            resp.headers.forEach((val, key) => {
                if (!key.startsWith("access-control-")) respHeaders[key] = val;
            });
            await route.fulfill({
                status: resp.status,
                headers: respHeaders,
                body: Buffer.from(await resp.arrayBuffer()),
            });
        });
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
                await route.fulfill({
                    status: resp.status,
                    body: Buffer.from(await resp.arrayBuffer()),
                });
            });
        }
        await registerMockWalletRoutes(context);
    }

    /**
     * Scenario: SC-3: control: a single status still filters correctly
     * Requirement: REQ-1 baseline / issue #1546
     * Priority: P1
     */
    test("single status Approved shows only the approved request", async ({
        page,
        requestsPage,
    }) => {
        await wireToSandbox(page);
        await requestsPage.gotoWithParams(TREASURY_ID, {
            tab: "All",
            my_vote: myVoteParam(["Approved"]),
        });

        await expect(requestsPage.proposalRow(ids.approved)).toBeVisible({
            timeout: 30_000,
        });
        await expect(requestsPage.proposalRow(ids.noVote)).toHaveCount(0);
        await expect(requestsPage.proposalRow(ids.rejected)).toHaveCount(0);
    });

    for (const order of [
        ["Approved", "No Voted"],
        ["No Voted", "Approved"],
    ]) {
        /**
         * Scenario: SC-4 / SC-5: two statuses return their union, in either order
         * Requirement: REQ-1 (union/OR), REQ-2 (order-independent) / issue #1546 Expected Result
         * Priority: P1
         */
        test(`${order.join(" + ")} shows approved and not-voted requests, not rejected`, async ({
            page,
            requestsPage,
        }) => {
            await wireToSandbox(page);
            await requestsPage.gotoWithParams(TREASURY_ID, {
                tab: "All",
                my_vote: myVoteParam(order),
            });

            await expect(requestsPage.filterPill(MY_VOTE)).toContainText(
                order.join(", "),
            );
            await expect(requestsPage.proposalRow(ids.approved)).toBeVisible({
                timeout: 30_000,
            });
            await expect(requestsPage.proposalRow(ids.noVote)).toBeVisible();
            // Negative oracle: the unselected status stays out.
            await expect(requestsPage.proposalRow(ids.rejected)).toHaveCount(0);
        });
    }
});

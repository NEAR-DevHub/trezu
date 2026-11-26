/**
 * Regression coverage for issue #1934: the vote lands on-chain but its relay
 * response never reaches the page (mobile network drop, timeout). The page
 * must re-read the request and show it approved, not an error with Approve
 * still offered for a second vote.
 *
 * The backend is route-mocked; the sandbox is still needed for the treasury
 * layout's SSR config fetch, so TREASURY_ID is a DAO seeded by global-setup.
 */
import type { Page, Route } from "@playwright/test";
import en from "../messages/en.json";
import { expect, test } from "./fixtures/test-with-pages";
import {
    maybeFulfillMockWalletRequest,
    seedMockWalletAccount,
} from "./helpers/mock-wallet";

const TREASURY_ID = "requests-e2e-test.sputnik-dao.near";
const ACCOUNT_ID = "test.near";
const PROPOSAL_ID = 7;

const ONE_NEAR = "1000000000000000000000000";
const TEN_NEAR = "10000000000000000000000000";

const POLICY = {
    roles: [
        {
            name: "council",
            kind: { Group: [ACCOUNT_ID] },
            permissions: [
                "*:AddProposal",
                "*:VoteApprove",
                "*:VoteReject",
                "*:VoteRemove",
            ],
            vote_policy: {},
        },
    ],
    default_vote_policy: {
        weight_kind: "RoleWeight",
        quorum: "0",
        threshold: [1, 2],
    },
    proposal_bond: "100000000000000000000000",
    proposal_period: "604800000000000",
    bounty_bond: "100000000000000000000000",
    bounty_forgiveness_period: "604800000000000",
};

const ASSETS = [
    {
        id: "near",
        contractId: "near",
        residency: "Near",
        network: "near",
        chainName: "NEAR Protocol",
        symbol: "NEAR",
        balance: { Standard: { total: TEN_NEAR, locked: "0" } },
        decimals: 24,
        price: "5",
        name: "NEAR",
        icon: "",
        chainIcons: { icon: "" },
    },
];

function pendingTransfer() {
    const submittedMs = BigInt(Date.now() - 60 * 60 * 1000);
    return {
        id: PROPOSAL_ID,
        proposer: ACCOUNT_ID,
        description: "Payment to bob",
        kind: {
            Transfer: {
                token_id: "",
                receiver_id: "bob.near",
                amount: ONE_NEAR,
                msg: null,
            },
        },
        status: "InProgress",
        vote_counts: {},
        votes: {} as Record<string, string>,
        submission_time: (submittedMs * 1_000_000n).toString(),
        last_actions_log: null,
    };
}

function json(route: Route, body: unknown) {
    return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

async function setupMocks(page: Page) {
    let proposal = pendingTransfer();
    let relayCalls = 0;
    // Holds the page's re-check of the request until the test lets it through.
    let releaseRecheck = () => {};
    const recheckHeld = new Promise<void>((resolve) => {
        releaseRecheck = resolve;
    });
    await seedMockWalletAccount(page, ACCOUNT_ID, "init");

    await page.route("**/*", async (route) => {
        if (await maybeFulfillMockWalletRequest(route)) return;
        const url = new URL(route.request().url());
        const path = url.pathname;

        // Sandbox RPC the mock wallet reads its nonce and block from.
        if (url.host === "localhost:3030") {
            return json(route, {
                result: { nonce: 1, sync_info: { latest_block_height: 1 } },
            });
        }
        if (path.endsWith("/relay/delegate-action")) {
            relayCalls++;
            // The vote executes the request on-chain, then the response is
            // lost on the way back to the page.
            proposal = {
                ...proposal,
                status: "Approved",
                votes: { [ACCOUNT_ID]: "Approve" },
            };
            return route.abort("internetdisconnected");
        }
        if (path.endsWith(`/proposal/${TREASURY_ID}/${PROPOSAL_ID}`)) {
            if (relayCalls > 0) await recheckHeld;
            return json(route, proposal);
        }
        if (path.endsWith(`/proposals/${TREASURY_ID}/proposers`)) {
            return json(route, { proposers: [ACCOUNT_ID], total: 1 });
        }
        if (path.endsWith(`/proposals/${TREASURY_ID}/approvers`)) {
            return json(route, { approvers: [], total: 0 });
        }
        if (path.endsWith(`/proposals/${TREASURY_ID}`)) {
            return json(route, {
                page: 0,
                page_size: 15,
                total: 1,
                proposals: [proposal],
            });
        }
        if (path.endsWith("/auth/me")) {
            return json(route, { accountId: ACCOUNT_ID, termsAccepted: true });
        }
        if (path.endsWith("/user/treasuries")) {
            return json(route, [
                {
                    daoId: TREASURY_ID,
                    config: { name: "Vote Lost Response E2E", metadata: {} },
                    isMember: true,
                    isSaved: true,
                    isHidden: false,
                },
            ]);
        }
        if (path.endsWith("/treasury/policy")) return json(route, POLICY);
        if (path.endsWith("/user/assets")) return json(route, ASSETS);
        if (path.includes("/warnings")) return json(route, { warnings: [] });
        if (path.endsWith("/monitored-accounts")) {
            return json(route, { accountId: TREASURY_ID, enabled: true });
        }
        return route.continue();
    });

    // The mock executor signs through the sandbox's :4000 helper, which is not
    // published from the container; the relay is mocked, so a stub suffices.
    await page.route("**/_test/sign-delegate-action", (route) =>
        json(route, { signedDelegateAction: { stub: true } }),
    );

    return { relayCalls: () => relayCalls, releaseRecheck };
}

test.use({ locale: "en-US", viewport: { width: 1440, height: 900 } });

test("a vote whose relay response is lost shows the request approved", async ({
    page,
}) => {
    test.setTimeout(90_000);
    const mocks = await setupMocks(page);
    const main = page.locator("main");
    const voteButton = (name: "Approve" | "Reject") =>
        main.getByRole("button", { name, exact: true });
    const dialog = page.getByRole("dialog");

    await test.step("approve the pending request", async () => {
        await page.goto(`/${TREASURY_ID}/requests/${PROPOSAL_ID}`);
        await voteButton("Approve").click({ timeout: 30_000 });
        const relayed = page.waitForRequest((r) =>
            r.url().endsWith("/relay/delegate-action"),
        );
        await dialog
            .getByRole("button", {
                name: en.proposals.voteModal.confirm,
                exact: true,
            })
            .click();
        await relayed;
    });

    await test.step("voting stays locked while the page re-checks the request", async () => {
        // A wallet popup closes the dialog long before the re-check is done.
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(voteButton("Approve")).toBeDisabled();
        await expect(voteButton("Reject")).toBeDisabled();
        mocks.releaseRecheck();
    });

    await test.step("the page shows the vote that landed, not an error", async () => {
        await expect(page.getByText(en.nearStore.voteSubmitted)).toBeVisible({
            timeout: 20_000,
        });
        await expect(main.getByText("1/1 approvals received")).toBeVisible();
        await expect(
            page.getByText(en.errors.codes.SERVICE_UNAVAILABLE.title),
        ).toHaveCount(0);
    });

    await test.step("no second vote was sent", async () => {
        await expect(voteButton("Approve")).toHaveCount(0);
        expect(mocks.relayCalls()).toBe(1);
    });
});

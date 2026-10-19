import { expect, type Page, type Route, test } from "@playwright/test";
import {
    maybeFulfillMockWalletRequest,
    seedMockWalletAccount,
} from "./helpers/mock-wallet";

/**
 * An approved swap request whose 1Click swap FAILED must be listed under the
 * Failed tab, not Executed, and its status pill must say Failed from the
 * backend's persisted `swap_status` alone — without a per-row swap-status
 * lookup.
 *
 * The backend buckets by the same value, so the list mock answers the
 * Failed tab with the request and the Executed tab without it.
 *
 * Server-side calls (getTreasuryConfig in layout.tsx) hit the sandbox backend,
 * so TREASURY_ID must be one of the treasuries seeded by global-setup.ts.
 */
const TREASURY_ID = "webassemblymusic-treasury.sputnik-dao.near";
const ACCOUNT_ID = "test.near";
const PROPOSAL_ID = 146;
const DEPOSIT_ADDRESS = "deposit.intents.near";

const ONE_NEAR = "1000000000000000000000000";

const TREASURY_POLICY = {
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

const TREASURY_ASSETS = [
    {
        id: "near",
        contractId: null,
        residency: "Near",
        network: "near",
        chainName: "Near Protocol",
        symbol: "NEAR",
        balance: { Standard: { total: ONE_NEAR, locked: "0" } },
        decimals: 24,
        price: "1.05",
        name: "Near",
        icon: "https://s2.coinmarketcap.com/static/img/coins/128x128/6535.png",
        chainIcons: {
            icon: "https://near.com/static/icons/network/near.svg",
        },
    },
];

/**
 * An approved NEAR -> SOL exchange routed through a 1Click deposit address,
 * in the backend's snake_case shape, with the persisted swap outcome the
 * backend attaches.
 */
function buildFailedSwapRequest() {
    const submittedMs = BigInt(Date.now() - 60 * 60 * 1000);
    return {
        id: PROPOSAL_ID,
        proposer: ACCOUNT_ID,
        description: [
            "* Proposal Action: asset-exchange",
            "* Token In Address: nep141:wrap.near",
            "* Token Out Address: nep141:sol.omft.near",
            `* Amount In: ${ONE_NEAR}`,
            "* Amount Out: 0.042842",
        ].join(" <br>"),
        kind: {
            FunctionCall: {
                receiver_id: "wrap.near",
                actions: [
                    {
                        method_name: "ft_transfer",
                        args: Buffer.from(
                            JSON.stringify({
                                receiver_id: DEPOSIT_ADDRESS,
                                amount: ONE_NEAR,
                            }),
                        ).toString("base64"),
                        deposit: "1",
                        gas: "30000000000000",
                    },
                ],
            },
        },
        status: "Approved",
        vote_counts: { council: [1, 0, 0] },
        votes: { [ACCOUNT_ID]: "Approve" },
        submission_time: (submittedMs * 1_000_000n).toString(),
        last_actions_log: null,
        swap_status: "FAILED",
    };
}

function fulfillJson(route: Route, body: unknown) {
    return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

function statusesOf(url: string): string | null {
    return new URL(url).searchParams.get("statuses");
}

async function setupMocks(page: Page) {
    const proposal = buildFailedSwapRequest();
    const swapStatusRequests: string[] = [];
    const listRequests: string[] = [];
    await seedMockWalletAccount(page, ACCOUNT_ID, "init");

    await page.route("**/*", async (route) => {
        if (await maybeFulfillMockWalletRequest(route)) return;

        const url = route.request().url();

        if (url.includes("/auth/me")) {
            return fulfillJson(route, {
                accountId: ACCOUNT_ID,
                termsAccepted: true,
            });
        }
        if (url.includes("/treasury/creation-status")) {
            return fulfillJson(route, { creationAvailable: true });
        }
        if (url.includes("/user/treasuries")) {
            return fulfillJson(route, [
                {
                    daoId: TREASURY_ID,
                    config: {
                        name: "Failed Swap Tab Treasury",
                        purpose: "Testing",
                        metadata: {},
                    },
                    isMember: true,
                    isSaved: true,
                    isHidden: false,
                },
            ]);
        }
        if (url.includes("/treasury/policy")) {
            return fulfillJson(route, TREASURY_POLICY);
        }
        if (url.includes("/user/assets")) {
            return fulfillJson(route, TREASURY_ASSETS);
        }
        if (url.includes("/monitored-accounts")) {
            return fulfillJson(route, {
                accountId: TREASURY_ID,
                enabled: true,
                planType: "free",
            });
        }
        // The status pill must not need this: the outcome is on the proposal.
        if (url.includes("/intents/swap-status")) {
            swapStatusRequests.push(url);
            return fulfillJson(route, {
                status: "FAILED",
                updatedAt: new Date().toISOString(),
            });
        }
        if (url.includes(`/api/proposal/${TREASURY_ID}/${PROPOSAL_ID}`)) {
            return fulfillJson(route, proposal);
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}/proposers`)) {
            return fulfillJson(route, { proposers: [ACCOUNT_ID], total: 1 });
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}/approvers`)) {
            return fulfillJson(route, {
                approvers: [ACCOUNT_ID],
                total: 1,
            });
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}`)) {
            listRequests.push(url);
            // Mirrors the backend: an approved request with a FAILED swap is
            // bucketed as Failed, so only the Failed tab (and All) list it.
            const statuses = statusesOf(url);
            const listed =
                statuses === null || statuses.split(",").includes("Failed");
            return fulfillJson(route, {
                page: 0,
                page_size: 15,
                total: listed ? 1 : 0,
                proposals: listed ? [proposal] : [],
            });
        }

        return route.continue();
    });

    return { swapStatusRequests, listRequests };
}

test.use({ locale: "en-US", viewport: { width: 1440, height: 900 } });

/**
 * Scenario: SC-001: Failed swap request is listed under Failed, not Executed
 * Priority: P2
 */
test("approved request with a FAILED swap sits in the Failed tab with a Failed pill", async ({
    page,
}) => {
    const { swapStatusRequests, listRequests } = await setupMocks(page);

    await page.goto(`/${TREASURY_ID}/requests`);

    await page.getByRole("tab", { name: "Failed" }).click();
    // Row 0 is the table header; row 1 is the mocked request.
    const failedRow = page.getByRole("row").nth(1);
    await expect(failedRow).toContainText(String(PROPOSAL_ID), {
        timeout: 15000,
    });
    await expect(failedRow.getByText("Failed", { exact: true })).toBeVisible();
    expect(listRequests.some((url) => statusesOf(url) === "Failed")).toBe(true);

    await page.getByRole("tab", { name: "Executed" }).click();
    await expect
        .poll(() => listRequests.some((url) => statusesOf(url) === "Approved"))
        .toBe(true);
    await expect(page.getByRole("row").nth(1)).toHaveCount(0);

    // The pill read the outcome from the proposal itself.
    expect(swapStatusRequests).toHaveLength(0);
});

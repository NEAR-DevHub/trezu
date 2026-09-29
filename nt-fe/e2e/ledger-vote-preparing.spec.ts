import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * Regression coverage for issue #1690 (fix: PR #1709): after confirming a vote
 * with Ledger, the "Confirm your vote" dialog must stay up, showing "Preparing
 * your vote" on a disabled button, until the Ledger popup is actually visible.
 * The bug closed the dialog as soon as near-connect appended its still-hidden
 * popup root, so nothing was on screen for seconds and people voted again.
 *
 * The real near-connect Ledger executor runs here; only the device is faked.
 * The executor is seeded as signed in over WebHID with no open transport, so
 * signing starts with a silent `navigator.usb.getDevices()` reconnect. That
 * call is stubbed to find no device after DEVICE_WAKE_MS, which reproduces the
 * "waking the device" gap; the executor then shows its "Reconnect Ledger"
 * screen, the first thing the popup ever displays. No signature is produced.
 *
 * Server-side calls (getTreasuryConfig in layout.tsx) hit the sandbox backend,
 * so TREASURY_ID must be one of the treasuries seeded by global-setup.ts.
 */
const TREASURY_ID = "webassemblymusic-treasury.sputnik-dao.near";
const ACCOUNT_ID = "test.near";
const PROPOSAL_ID = 7;
// Sandbox genesis key for test.near, same as ledger-login.spec.ts.
const LEDGER_PUBLIC_KEY = "ed25519:5BGSaf6YjVm7565VzWQHNxoyEjwr3jUpRJSGjREvU9dB";
const DEVICE_WAKE_MS = 4000;

const ONE_NEAR = "1000000000000000000000000";
const TEN_NEAR = "10000000000000000000000000";

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

/** Enough NEAR to cover the request, so Approve is offered (not Receive). */
const TREASURY_ASSETS = [
    {
        id: "near",
        contractId: null,
        residency: "Near",
        network: "near",
        chainName: "Near Protocol",
        symbol: "NEAR",
        balance: { Standard: { total: TEN_NEAR, locked: "0" } },
        decimals: 24,
        price: "1.05",
        name: "Near",
        icon: "https://s2.coinmarketcap.com/static/img/coins/128x128/6535.png",
        chainIcons: {
            icon: "https://near.com/static/icons/network/near.svg",
        },
    },
];

/** A pending, not-yet-voted NEAR transfer in the backend's snake_case shape. */
function buildPendingTransfer() {
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
        votes: {},
        submission_time: (submittedMs * 1_000_000n).toString(),
        last_actions_log: null,
    };
}

function fulfillJson(route: Route, body: unknown) {
    return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

/**
 * Signs test.near in with the real Ledger wallet: near-connect's selected
 * wallet, Trezu's forced direct-trigger target (so the connector is built
 * with Ledger included), and the executor's own storage, which near-connect
 * namespaces as `<walletId>:<key>` in the page's localStorage.
 */
async function seedLedgerSession(page: Page) {
    await page.addInitScript(
        ({ accountId, publicKey }) => {
            // Init scripts also run in the executor's sandboxed iframe, which
            // has no localStorage of its own to seed.
            try {
                localStorage.setItem("selected-wallet", "ledger");
                localStorage.setItem("trezu:target-wallet", "ledger");
                localStorage.setItem(
                    "ledger:ledger:accounts",
                    JSON.stringify([{ accountId, publicKey }]),
                );
                localStorage.setItem("ledger:ledger:transportMode", "WebHID");
            } catch {}
        },
        { accountId: ACCOUNT_ID, publicKey: LEDGER_PUBLIC_KEY },
    );
}

/**
 * Fakes a Ledger that takes DEVICE_WAKE_MS to answer the silent reconnect and
 * then turns out not to be there. Runs in every frame, including the
 * executor's iframe, where the lookup happens.
 */
async function stubSlowLedgerDevice(page: Page) {
    await page.addInitScript((wakeMs) => {
        Object.defineProperty(navigator, "usb", {
            configurable: true,
            value: {
                getDevices: () =>
                    new Promise((resolve) => setTimeout(() => resolve([]), wakeMs)),
                requestDevice: () =>
                    Promise.reject(
                        new DOMException("No device selected.", "NotFoundError"),
                    ),
                addEventListener: () => {},
                removeEventListener: () => {},
            },
        });
    }, DEVICE_WAKE_MS);
}

async function setupMocks(page: Page) {
    const proposal = buildPendingTransfer();
    await seedLedgerSession(page);
    await stubSlowLedgerDevice(page);

    await page.route("**/*", async (route) => {
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
                        name: "Requests E2E Test Treasury",
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
        if (url.includes(`/api/proposal/${TREASURY_ID}/${PROPOSAL_ID}`)) {
            return fulfillJson(route, proposal);
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}/proposers`)) {
            return fulfillJson(route, { proposers: [ACCOUNT_ID], total: 1 });
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}/approvers`)) {
            return fulfillJson(route, { approvers: [], total: 0 });
        }
        if (url.includes(`/api/proposals/${TREASURY_ID}`)) {
            return fulfillJson(route, {
                page: 0,
                page_size: 15,
                total: 1,
                proposals: [proposal],
            });
        }

        return route.continue();
    });
}

test.use({ locale: "en-US", viewport: { width: 1440, height: 900 } });

for (const vote of ["Approve", "Reject"] as const) {
    /**
     * Scenario: SC-001 / SC-002: vote dialog holds "Preparing your vote" until
     * the Ledger popup takes over
     * Requirement: REQ-1..REQ-4 / issue #1690
     * Priority: P1
     */
    test(`${vote}: vote dialog stays up with a disabled "Preparing your vote" until the Ledger popup shows`, async ({
        page,
    }) => {
        test.setTimeout(60_000);
        await setupMocks(page);

        const main = page.locator("main");
        const voteDialog = page.getByRole("dialog", {
            name: "Confirm your vote",
        });
        // Every popup root near-connect mounts, hidden or shown.
        const connectorPopups = page.locator(".hot-connector-popup");
        const shownPopups = connectorPopups.filter({ visible: true });
        const ledgerScreen = page
            .frameLocator(".hot-connector-popup iframe")
            .getByText("Reconnect Ledger");

        await test.step("open the pending request and choose the vote", async () => {
            const proposalResp = page.waitForResponse((r) =>
                r.url().includes(`/api/proposal/${TREASURY_ID}/${PROPOSAL_ID}`),
            );
            await page.goto(`/${TREASURY_ID}/requests/${PROPOSAL_ID}`);
            await proposalResp;
            await main
                .getByRole("button", { name: vote, exact: true })
                .click({ timeout: 15000 });
            await expect(voteDialog).toBeVisible();
        });

        const confirm = voteDialog.getByRole("button", {
            name: "Confirm",
            exact: true,
        });

        await test.step("confirm: the dialog shows it is preparing", async () => {
            await confirm.click();

            const preparing = voteDialog.getByRole("button", {
                name: "Preparing your vote",
            });
            await expect(preparing).toBeVisible();
            // A second press must not be possible while Ledger is loading.
            await expect(preparing).toBeDisabled();
        });

        await test.step("the hidden Ledger popup does not tear the dialog down", async () => {
            // near-connect has mounted the popup root but not shown it yet:
            // this is exactly when the bug closed the dialog.
            await expect(connectorPopups.last()).toBeAttached();
            await expect(shownPopups).toHaveCount(0);
            await expect(voteDialog).toBeVisible();
            await expect(
                voteDialog.getByRole("button", { name: "Preparing your vote" }),
            ).toBeDisabled();
        });

        await test.step("the Ledger popup takes over from the dialog", async () => {
            await expect(ledgerScreen).toBeVisible({
                timeout: DEVICE_WAKE_MS + 10_000,
            });
            await expect(voteDialog).toBeHidden();
            // One vote, one wallet popup: no second signing flow was started.
            await expect(shownPopups).toHaveCount(1);
        });
    });
}

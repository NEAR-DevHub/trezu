import fs from "node:fs";
import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

// The Passkey executor ships from the NEAR-DevHub/near-connect-passkey
// nep641 branch (served via raw.githubusercontent.com — see
// lib/passkey-wallet.ts). The spec route-mocks that URL with a locally-built
// artifact from a sibling checkout of the executor repo, and skips when it
// isn't present (e.g. CI without the sibling repo — Passkey stays behind the
// warnings kill switch until then).
const EXECUTOR_ARTIFACT = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "near-connect-passkey",
    "passkey-executor.js",
);

// Public part of the executor's embedded function-call key for
// passkeys-registry.near (REGISTRY_FC_PRIVATE_KEY in the vendored
// constants). Used to satisfy the registration transaction's key lookup.
const FC_PUBLIC_KEY = "ed25519:4rPkq4P1KwD4kVuUETqL5wLUEH3hEHqwiuSEKVC3fUwT";

const CHALLENGE_PAYLOAD = "Login to Trezu — test payload";

// near-api-ts validates RPC responses with zod, so every hash has to be real
// base58 that decodes to 32 bytes — `"A".repeat(44)` does not.
const BLOCK_HASH = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const RECEIPT_ID = "8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR";

const RPC_URL_PATTERN = /rpc\.(mainnet|testnet)?\.?(fastnear\.com|near\.org)/;

function callFunctionResult(id: unknown, value: unknown) {
    return {
        jsonrpc: "2.0",
        id,
        result: {
            block_hash: BLOCK_HASH,
            block_height: 100000000,
            logs: [],
            result: Array.from(new TextEncoder().encode(JSON.stringify(value))),
        },
    };
}

/** A successful `FinalExecutionOutcomeView`, shaped to pass zod validation. */
function successfulTransaction(id: unknown) {
    const outcomeMetadata = { version: 1, gas_profile: null };
    return {
        jsonrpc: "2.0",
        id,
        result: {
            final_execution_status: "FINAL",
            status: { SuccessValue: "" },
            transaction: {
                actions: [],
                hash: BLOCK_HASH,
                nonce: 2,
                public_key: FC_PUBLIC_KEY,
                receiver_id: "passkeys-registry.near",
                signature: `ed25519:${"1".repeat(64)}`,
                signer_id: "passkeys-registry.near",
                priority_fee: 0,
            },
            transaction_outcome: {
                block_hash: BLOCK_HASH,
                id: BLOCK_HASH,
                proof: [],
                outcome: {
                    executor_id: "passkeys-registry.near",
                    gas_burnt: 2428030560766,
                    logs: [],
                    metadata: outcomeMetadata,
                    receipt_ids: [RECEIPT_ID],
                    status: { SuccessReceiptId: RECEIPT_ID },
                    tokens_burnt: "242803056076600000000",
                },
            },
            receipts_outcome: [
                {
                    block_hash: BLOCK_HASH,
                    id: RECEIPT_ID,
                    proof: [],
                    outcome: {
                        executor_id: "passkeys-registry.near",
                        gas_burnt: 2428030560766,
                        logs: [],
                        metadata: outcomeMetadata,
                        receipt_ids: [],
                        status: { SuccessValue: "" },
                        tokens_burnt: "0",
                    },
                },
            ],
            receipts: [],
        },
    };
}

/**
 * Answers the passkey ceremonies without a real authenticator.
 *
 * WebAuthn runs in the TOP window (near-connect proxies
 * `navigator.credentials` out of the sandboxed iframe), so one page-level CDP
 * virtual authenticator covers both the `create()` at sign-up and the `get()`
 * that NEP-641 `resolveAuth` performs.
 */
async function installVirtualAuthenticator(
    page: Page,
    context: BrowserContext,
) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
        },
    });
}

/** Serves the executor locally so the test has no network dependency. */
async function mockExecutor(context: BrowserContext) {
    // Match with an optional cache-busting query string: near-connect fetches
    // the executor as `…/passkey-executor.js?nonce=<per-session>`.
    await context.route("**/passkey-executor.js*", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/javascript",
            body: fs.readFileSync(EXECUTOR_ARTIFACT, "utf8"),
        }),
    );
}

/**
 * NEAR RPC: registry lookups, wallet-contract config views, account state and
 * transaction submission, all succeeding.
 */
async function mockNearRpc(context: BrowserContext) {
    await context.route(RPC_URL_PATTERN, async (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}");
        const params = body.params ?? {};
        let result: unknown = { jsonrpc: "2.0", id: body.id, result: {} };

        if (
            body.method === "query" &&
            params.request_type === "call_function"
        ) {
            switch (params.method_name) {
                case "get": // passkeys-registry.near — no passkey known yet
                    result = callFunctionResult(body.id, []);
                    break;
                case "w_is_signature_allowed":
                    result = callFunctionResult(body.id, true);
                    break;
                case "w_subwallet_id":
                    result = callFunctionResult(body.id, 0);
                    break;
                case "w_timeout_secs":
                    result = callFunctionResult(body.id, 3600);
                    break;
                case "w_extensions":
                    result = callFunctionResult(body.id, []);
                    break;
                default:
                    result = callFunctionResult(body.id, null);
            }
        } else if (
            body.method === "query" &&
            params.request_type === "view_account"
        ) {
            // Wallet account already exists — the executor skips StateInit.
            result = {
                jsonrpc: "2.0",
                id: body.id,
                result: {
                    amount: "0",
                    locked: "0",
                    code_hash: "11111111111111111111111111111111",
                    storage_usage: 500,
                    storage_paid_at: 0,
                    block_height: 100000000,
                    block_hash: BLOCK_HASH,
                },
            };
        } else if (
            body.method === "query" &&
            params.request_type === "view_access_key"
        ) {
            result = {
                jsonrpc: "2.0",
                id: body.id,
                result: {
                    block_hash: BLOCK_HASH,
                    block_height: 100000000,
                    nonce: 1,
                    permission: {
                        FunctionCall: {
                            allowance: null,
                            receiver_id: "passkeys-registry.near",
                            method_names: ["register"],
                        },
                    },
                },
            };
        } else if (
            body.method === "query" &&
            params.request_type === "view_access_key_list"
        ) {
            // near-api-ts's memory signer enumerates the account's keys to
            // find the one it signs with.
            result = {
                jsonrpc: "2.0",
                id: body.id,
                result: {
                    block_hash: BLOCK_HASH,
                    block_height: 100000000,
                    keys: [
                        {
                            public_key: FC_PUBLIC_KEY,
                            access_key: {
                                nonce: 1,
                                permission: {
                                    FunctionCall: {
                                        allowance: null,
                                        receiver_id: "passkeys-registry.near",
                                        method_names: ["register"],
                                    },
                                },
                            },
                        },
                    ],
                },
            };
        } else if (body.method === "block") {
            result = {
                jsonrpc: "2.0",
                id: body.id,
                result: {
                    header: {
                        hash: BLOCK_HASH,
                        height: 100000000,
                        timestamp: Date.now() * 1e6,
                    },
                },
            };
        } else if (
            body.method === "send_tx" ||
            body.method === "broadcast_tx_commit" ||
            body.method === "tx" ||
            // send_tx with wait_until=NONE returns immediately; the signer
            // then polls the status separately.
            body.method === "EXPERIMENTAL_tx_status"
        ) {
            result = successfulTransaction(body.id);
        } else if (body.method === "EXPERIMENTAL_protocol_config") {
            // near-api-ts's getAccountInfo needs the storage price.
            result = {
                jsonrpc: "2.0",
                id: body.id,
                result: {
                    runtime_config: {
                        storage_amount_per_byte: "10000000000000000000",
                    },
                },
            };
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(result),
        });
    });
}

/** Opens the sign-in screen and starts the Passkey flow. */
async function startPasskeyFlow(page: Page) {
    await page.goto("/create");
    const passkeyOption = page
        .getByRole("button", { name: /Passkey for Touch ID/i })
        .first();
    await expect(passkeyOption).toBeVisible({ timeout: 15000 });
    await passkeyOption.click();
}

test("Passkey sign-up logs in via NEP-641 resolveAuth", async ({
    page,
    context,
}) => {
    test.skip(
        !fs.existsSync(EXECUTOR_ARTIFACT),
        "passkey-executor.js artifact not vendored yet",
    );
    test.setTimeout(120000);

    await installVirtualAuthenticator(page, context);
    await mockExecutor(context);
    await mockNearRpc(context);

    let loggedInAccountId: string | null = null;

    await context.route("**/api/auth/challenge", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                payload: CHALLENGE_PAYLOAD,
                chainId: "mainnet",
            }),
        }),
    );

    await context.route("**/api/auth/login", async (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}");
        // The executor must produce a NEP-641 authorization blob for a
        // deterministic 0s… wallet account: the signed `OffchainMessage`
        // envelope (bound to chain, signer, timestamp, payload) plus the
        // passkey proof, in the reference wallet's
        // `{ signature: { msg, proof } }` shape.
        expect(body.accountId).toMatch(/^0s[0-9a-f]{40}$/);
        const { signature } = JSON.parse(body.authorization);
        expect(signature.msg.chain_id).toBe("mainnet");
        expect(signature.msg.signer_id).toBe(body.accountId);
        expect(signature.msg.payload).toBe(CHALLENGE_PAYLOAD);
        expect(signature.proof).toBeTruthy();

        loggedInAccountId = body.accountId;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                accountId: body.accountId,
                termsAccepted: true,
            }),
        });
    });

    await context.route("**/api/auth/me", (route) =>
        loggedInAccountId
            ? route.fulfill({
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify({
                      accountId: loggedInAccountId,
                      termsAccepted: true,
                  }),
              })
            : route.fulfill({
                  status: 401,
                  contentType: "application/json",
                  body: JSON.stringify({ error: "Not authenticated" }),
              }),
    );

    await startPasskeyFlow(page);

    // The executor UI renders inside the sandboxed iframe: pick "Sign up" to
    // create the passkey, then confirm the resolveAuth ceremony. The virtual
    // authenticator answers both WebAuthn prompts automatically.
    const executor = page
        .frameLocator('iframe[sandbox*="allow-scripts"]')
        .first();

    const signUp = executor.getByRole("button", {
        name: "Sign up",
        exact: true,
    });
    await expect(signUp).toBeVisible({ timeout: 30000 });
    await signUp.click();

    const confirm = executor.getByRole("button", {
        name: "Sign in",
        exact: true,
    });
    await expect(confirm).toBeVisible({ timeout: 30000 });
    await confirm.click();

    await expect
        .poll(() => loggedInAccountId, { timeout: 30000 })
        .toMatch(/^0s[0-9a-f]{40}$/);
    await expect(page.getByText("Sign in or create a treasury")).toBeHidden({
        timeout: 30000,
    });
});

test("a failed connect attempt is surfaced on the sign-in screen", async ({
    page,
    context,
}) => {
    test.skip(
        !fs.existsSync(EXECUTOR_ARTIFACT),
        "passkey-executor.js artifact not vendored yet",
    );

    await installVirtualAuthenticator(page, context);
    await mockExecutor(context);
    await mockNearRpc(context);

    // Anything that breaks mid-connect leaves the user back on the sign-in
    // screen; without the alert that is indistinguishable from "nothing
    // happened". A failing challenge is the cheapest way to trigger it.
    await context.route("**/api/auth/challenge", (route) =>
        route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "relayer unavailable" }),
        }),
    );

    await startPasskeyFlow(page);

    await expect(page.getByText("We couldn't sign you in")).toBeVisible({
        timeout: 30000,
    });
});

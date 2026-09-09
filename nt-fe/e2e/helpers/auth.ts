/**
 * Programmatic login helper for E2E setup.
 *
 * `create-stream` now requires an authenticated member (session cookie). Every
 * sandbox account is controlled by the genesis key, so we authenticate as a DAO
 * member by producing a NEP-641 `AccessKeyAuthorization` — the `OffchainMessage`
 * envelope signed via NEP-413 with that full-access key, exactly as a wallet
 * would — and return the resulting `auth_token` cookie for reuse.
 */

import { createHash } from "node:crypto";
import { KeyPair } from "@near-js/crypto";
import { baseEncode } from "@near-js/utils";

// Same well-known near-sandbox genesis key used by sandbox-rpc.ts; it is the
// full-access key on test.near and every account created for the tests.
const GENESIS_PRIVATE_KEY =
    "ed25519:3tgdk2wPraJzT4nsTuf86UX41xgPNk3MHnq8epARMdBNs29AFEztAuaQ7iHddDfXG9F2RzV1XNQYgJyAyoW51UBB";
const GENESIS_KEY_PAIR = KeyPair.fromString(GENESIS_PRIVATE_KEY);

const NEP413_TAG = 2 ** 31 + 413; // 2147484061
// NEP-641 canonical hash domain separator.
const NEP641_DOMAIN_SEPARATOR = "NEAR_NEP641_OFFCHAIN_MESSAGE/V1";
// Clients SHOULD timestamp the envelope slightly before signing time to absorb
// clock skew and block-time lag.
const TIMESTAMP_SKEW_MS = 60_000;

function u32le(n: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0);
    return b;
}

function u64le(n: bigint): Buffer {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    return b;
}

function borshString(s: string): Buffer {
    const bytes = Buffer.from(s, "utf8");
    return Buffer.concat([u32le(bytes.length), bytes]);
}

/** NEP-641 `OffchainMessage` (top-level: empty `path`). */
interface OffchainMessage {
    chain_id: string;
    signer_id: string;
    path: string[];
    /** RFC-3339, whole seconds. */
    timestamp: string;
    payload: string;
}

/** `SHA3-256(b"NEAR_NEP641_OFFCHAIN_MESSAGE/V1" || borsh(msg))`. */
function offchainMessageHash(msg: OffchainMessage): Buffer {
    const timestampNanos = BigInt(Date.parse(msg.timestamp)) * 1_000_000n;
    const borsh = Buffer.concat([
        borshString(msg.chain_id),
        borshString(msg.signer_id),
        u32le(msg.path.length),
        ...msg.path.map(borshString),
        u64le(timestampNanos),
        borshString(msg.payload),
    ]);
    return createHash("sha3-256")
        .update(Buffer.from(NEP641_DOMAIN_SEPARATOR, "utf8"))
        .update(borsh)
        .digest();
}

/**
 * NEP-641 §"NEP-413 mapping": `message` = payload, `nonce` = canonical hash,
 * `recipient` = `"<chain_id>: <signer_id>[ -> <path>]... @ <timestamp>"`.
 * Returns the NEP-413 hash: `sha256(tag ++ borsh(payload))`.
 */
function nep413HashOf(msg: OffchainMessage): Buffer {
    const recipient = `${msg.chain_id}: ${[msg.signer_id, ...msg.path].join(" -> ")} @ ${msg.timestamp}`;
    const payload = Buffer.concat([
        u32le(NEP413_TAG),
        borshString(msg.payload),
        offchainMessageHash(msg), // nonce: 32 raw bytes
        borshString(recipient),
        Buffer.from([0]), // callback_url: None
    ]);
    return createHash("sha256").update(payload).digest();
}

/**
 * Build the NEP-641 `AccessKeyAuthorization` blob for `accountId` over
 * `payload`, signed with `keyPair` (must be a full-access key on the account).
 */
export function buildAccessKeyAuthorization(
    keyPair: KeyPair,
    chainId: string,
    accountId: string,
    payload: string,
    signedAt: Date = new Date(Date.now() - TIMESTAMP_SKEW_MS),
): string {
    const timestampMs = Math.floor(signedAt.getTime() / 1000) * 1000;
    const msg: OffchainMessage = {
        chain_id: chainId,
        signer_id: accountId,
        path: [],
        timestamp: new Date(timestampMs).toISOString().replace(".000Z", "Z"),
        payload,
    };
    const { signature } = keyPair.sign(nep413HashOf(msg));
    return JSON.stringify({
        msg: {
            chain_id: msg.chain_id,
            signer_id: msg.signer_id,
            timestamp: msg.timestamp,
            payload: msg.payload,
        },
        // `extra` is required by the resolver even without a callback URL.
        via: { schema: "nep413", extra: {} },
        access_key: keyPair.getPublicKey().toString(),
        signature: `ed25519:${baseEncode(signature)}`,
    });
}

/**
 * Log in as `accountId` and return the `Cookie` header value (`auth_token=...`)
 * to attach to authenticated requests.
 */
export async function loginAndGetCookie(
    backendUrl: string,
    accountId: string,
): Promise<string> {
    const challengeResp = await fetch(`${backendUrl}/api/auth/challenge`, {
        method: "POST",
    });
    if (!challengeResp.ok) {
        throw new Error(
            `Failed to get auth challenge: ${challengeResp.status} ${await challengeResp.text()}`,
        );
    }
    const { payload, chainId } = (await challengeResp.json()) as {
        payload: string;
        chainId: string;
    };

    const authorization = buildAccessKeyAuthorization(
        GENESIS_KEY_PAIR,
        chainId,
        accountId,
        payload,
    );

    const loginResp = await fetch(`${backendUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, authorization }),
    });
    if (!loginResp.ok) {
        throw new Error(
            `Login failed for ${accountId}: ${loginResp.status} ${await loginResp.text()}`,
        );
    }

    const headers = loginResp.headers as Headers & {
        getSetCookie?: () => string[];
    };
    const setCookies =
        typeof headers.getSetCookie === "function"
            ? headers.getSetCookie()
            : [headers.get("set-cookie") ?? ""];
    const authCookie = setCookies
        .map((c) => /(?:^|;\s*)(auth_token=[^;]+)/.exec(c)?.[1])
        .find(Boolean);
    if (!authCookie) {
        throw new Error(`Login for ${accountId} returned no auth_token cookie`);
    }
    return authCookie;
}

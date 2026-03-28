/**
 * Sandbox RPC helpers for E2E tests.
 *
 * Signs and sends transactions to the local NEAR sandbox blockchain
 * using the well-known genesis private key from the near-sandbox crate.
 */
import { KeyPair } from "@near-js/crypto";
import {
    actionCreators,
    createTransaction,
    Signature,
    SignedTransaction,
} from "@near-js/transactions";
import { createHash } from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58 = require("bs58") as {
    encode: (buf: Uint8Array) => string;
    decode: (str: string) => Uint8Array;
};

const SANDBOX_RPC = "http://localhost:3030";

// near-sandbox crate default genesis key (controls test.near and near accounts)
const GENESIS_PRIVATE_KEY =
    "ed25519:3tgdk2wPraJzT4nsTuf86UX41xgPNk3MHnq8epARMdBNs29AFEztAuaQ7iHddDfXG9F2RzV1XNQYgJyAyoW51UBB";
const GENESIS_KEY_PAIR = KeyPair.fromString(GENESIS_PRIVATE_KEY);

/** Call a view function on the sandbox */
export async function viewFunction(
    accountId: string,
    methodName: string,
    args: Record<string, unknown> = {},
): Promise<unknown> {
    const resp = await fetch(SANDBOX_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "query",
            params: {
                request_type: "call_function",
                finality: "final",
                account_id: accountId,
                method_name: methodName,
                args_base64: Buffer.from(JSON.stringify(args)).toString(
                    "base64",
                ),
            },
        }),
    });
    const data = (await resp.json()) as {
        result?: { result?: number[] };
        error?: unknown;
    };
    if (data.error || !data.result?.result) {
        throw new Error(
            `View call failed: ${JSON.stringify(data.error || data)}`,
        );
    }
    const bytes = Buffer.from(data.result.result);
    return JSON.parse(bytes.toString());
}

/** Create an account on the sandbox funded by a parent account */
export async function createAccount(
    newAccountId: string,
    parentAccountId: string,
    amountNear: number = 10,
): Promise<void> {
    const deposit = BigInt(amountNear) * BigInt("1000000000000000000000000");
    await signAndSend(parentAccountId, newAccountId, [
        actionCreators.createAccount(),
        actionCreators.transfer(deposit),
        actionCreators.addKey(
            GENESIS_KEY_PAIR.getPublicKey(),
            actionCreators.fullAccessKey(),
        ),
    ]);
}

/** Transfer NEAR from one account to another */
export async function transferNear(
    senderId: string,
    receiverId: string,
    amountNear: number,
): Promise<void> {
    const deposit = BigInt(amountNear) * BigInt("1000000000000000000000000");
    await signAndSend(senderId, receiverId, [
        actionCreators.transfer(deposit),
    ]);
}

/** Sign and send a transaction using the genesis key */
async function signAndSend(
    signerId: string,
    receiverId: string,
    actions: ReturnType<typeof actionCreators.functionCall>[],
): Promise<Record<string, unknown>> {
    // Get access key nonce
    const keyResp = await fetch(SANDBOX_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "query",
            params: {
                request_type: "view_access_key",
                finality: "final",
                account_id: signerId,
                public_key: GENESIS_KEY_PAIR.getPublicKey().toString(),
            },
        }),
    });
    const keyData = (await keyResp.json()) as {
        result?: { nonce: number; block_hash: string };
        error?: unknown;
    };
    if (!keyData.result || keyData.result.nonce === undefined) {
        throw new Error(
            `Failed to get access key for ${signerId}: ${JSON.stringify(keyData.error || keyData)}`,
        );
    }
    const nonce = keyData.result.nonce + 1;
    const blockHash = bs58.decode(keyData.result.block_hash);

    const tx = createTransaction(
        signerId,
        GENESIS_KEY_PAIR.getPublicKey(),
        receiverId,
        nonce,
        actions,
        blockHash,
    );

    const serialized = tx.encode();
    const hash = createHash("sha256").update(serialized).digest();
    const signed = GENESIS_KEY_PAIR.sign(hash);
    const sig = new Signature({ keyType: 0, data: signed.signature });

    const signedTx = new SignedTransaction({
        transaction: tx,
        signature: sig,
    });

    const result = await fetch(SANDBOX_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "broadcast_tx_commit",
            params: [
                Buffer.from(signedTx.encode()).toString("base64"),
            ],
        }),
    });

    const data = (await result.json()) as {
        result?: Record<string, unknown>;
        error?: unknown;
    };
    if (data.error) {
        throw new Error(`Transaction failed: ${JSON.stringify(data.error)}`);
    }
    // Check for execution failures in the transaction outcome
    const txResult = data.result!;
    const status = (txResult as { status?: { Failure?: unknown } }).status;
    if (status?.Failure) {
        throw new Error(
            `Transaction execution failed: ${JSON.stringify(status.Failure)}`,
        );
    }
    return txResult;
}

/** Add a proposal to a DAO and return the new proposal's ID */
export async function addProposal(
    signerId: string,
    daoId: string,
    proposal: Record<string, unknown>,
): Promise<number> {
    await signAndSend(signerId, daoId, [
        actionCreators.functionCall(
            "add_proposal",
            Buffer.from(JSON.stringify({ proposal })),
            BigInt("100000000000000"), // 100 TGas
            BigInt(0), // bond (matches DAO policy)
        ),
    ]);

    // get_last_proposal_id returns the count; the newest proposal's ID = count - 1
    const count = (await viewFunction(daoId, "get_last_proposal_id")) as number;
    return count - 1;
}

/** Approve a DAO proposal and return the full execution result (including cross-contract receipts) */
export async function approveProposal(
    signerId: string,
    daoId: string,
    proposalId: number,
): Promise<Record<string, unknown>> {
    // Fetch proposal to get kind (needed for act_proposal)
    const proposal = (await viewFunction(daoId, "get_proposal", {
        id: proposalId,
    })) as { kind: Record<string, unknown> };

    const broadcastResult = await signAndSend(signerId, daoId, [
        actionCreators.functionCall(
            "act_proposal",
            Buffer.from(
                JSON.stringify({
                    id: proposalId,
                    action: "VoteApprove",
                    proposal: { FunctionCall: proposal.kind.FunctionCall },
                }),
            ),
            BigInt("300000000000000"), // 300 TGas for MPC signing
            BigInt(0),
        ),
    ]);

    // broadcast_tx_commit doesn't include cross-contract receipts (e.g. v1.signer).
    // Use EXPERIMENTAL_tx_status to get the full receipt tree.
    const txHash = (broadcastResult as { transaction?: { hash?: string } })
        .transaction?.hash;
    if (!txHash) return broadcastResult;

    // Wait for cross-contract receipts to be processed
    await new Promise((r) => setTimeout(r, 3000));

    const resp = await fetch(SANDBOX_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "EXPERIMENTAL_tx_status",
            params: {
                tx_hash: txHash,
                sender_account_id: signerId,
                wait_until: "EXECUTED",
            },
        }),
    });
    const data = (await resp.json()) as {
        result?: Record<string, unknown>;
    };
    return data.result || broadcastResult;
}

/**
 * Extract the MPC signature from an act_proposal execution result.
 *
 * Searches for the base64 marker "eyJzY2hlbWUi" (= `{"scheme"`) in
 * SuccessValue fields, decodes it, and returns the raw 64-byte signature.
 */
export function extractMpcSignature(
    txResult: Record<string, unknown>,
): Uint8Array | null {
    const resultStr = JSON.stringify(txResult);
    const marker = "eyJzY2hlbWUi";
    const idx = resultStr.indexOf(marker);
    if (idx === -1) return null;

    // Extract base64 value
    const rest = resultStr.slice(idx);
    const endIdx = rest.search(/[^A-Za-z0-9+/=]/);
    const b64 = rest.slice(0, endIdx === -1 ? rest.length : endIdx);

    const decoded = Buffer.from(b64, "base64").toString();
    const sigJson = JSON.parse(decoded) as {
        scheme: string;
        signature: number[];
    };

    if (sigJson.scheme !== "Ed25519" || !Array.isArray(sigJson.signature)) {
        return null;
    }

    return new Uint8Array(sigJson.signature);
}

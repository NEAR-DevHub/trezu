import { V1_SIGNER_CONTRACT } from "../constants";

/**
 * Fetch the Ed25519 derived public key for a DAO's path from v1.signer.
 */
export async function fetchMpcPublicKey(daoId: string): Promise<string> {
    const rpcUrl =
        process.env.NEXT_PUBLIC_NEAR_RPC_URL ||
        "https://archival-rpc.mainnet.fastnear.com";
    const args = JSON.stringify({
        path: daoId,
        predecessor: daoId,
        domain_id: 1,
    });

    const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "query",
            params: {
                request_type: "call_function",
                finality: "final",
                account_id: "v1.signer",
                method_name: "derived_public_key",
                args_base64: btoa(args),
            },
        }),
    });

    const data = (await resp.json()) as {
        result?: { result?: number[] };
    };
    if (!data.result?.result) {
        throw new Error("Failed to fetch MPC public key from v1.signer");
    }

    const keyStr = new TextDecoder().decode(
        new Uint8Array(data.result.result),
    );
    return keyStr.replace(/"/g, "");
}

/**
 * Fetch the full transaction status (including all receipts) from NEAR RPC.
 */
async function fetchTxStatus(
    txHash: string,
    senderId: string,
): Promise<Record<string, unknown>> {
    const rpcUrl =
        process.env.NEXT_PUBLIC_NEAR_RPC_URL ||
        "https://archival-rpc.mainnet.fastnear.com";

    const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "EXPERIMENTAL_tx_status",
            params: { tx_hash: txHash, sender_account_id: senderId, wait_until: "EXECUTED" },
        }),
    });

    const data = (await resp.json()) as { result?: Record<string, unknown> };
    if (!data.result) throw new Error("Failed to fetch transaction status");
    return data.result;
}

/**
 * Extract the MPC Ed25519 signature from a v1.signer execution result.
 *
 * Searches the transaction receipts for a SuccessValue from v1.signer
 * containing the base64-encoded JSON: {"scheme":"Ed25519","signature":[...]}
 */
export function extractSignatureFromTxResult(
    txResult: Record<string, unknown>,
): Uint8Array | null {
    const receiptsOutcome = txResult.receipts_outcome as
        | Array<{
              outcome: {
                  executor_id: string;
                  status: { SuccessValue?: string };
              };
          }>
        | undefined;

    if (!receiptsOutcome) return null;

    for (const receipt of receiptsOutcome) {
        const { executor_id, status } = receipt.outcome;
        if (
            executor_id === V1_SIGNER_CONTRACT &&
            status.SuccessValue
        ) {
            try {
                const decoded = atob(status.SuccessValue);
                const parsed = JSON.parse(decoded) as {
                    scheme?: string;
                    signature?: number[];
                };
                if (
                    parsed.scheme === "Ed25519" &&
                    Array.isArray(parsed.signature) &&
                    parsed.signature.length === 64
                ) {
                    return new Uint8Array(parsed.signature);
                }
            } catch {
                // Not the receipt we're looking for
            }
        }
    }

    return null;
}

/**
 * Fetch the transaction and extract the MPC signature.
 */
export async function extractSignatureFromTx(
    txHash: string,
    senderId: string,
): Promise<Uint8Array | null> {
    const txResult = await fetchTxStatus(txHash, senderId);
    return extractSignatureFromTxResult(txResult);
}

/**
 * Encode a signature as ed25519:base58 format for the 1Click API.
 */
export function formatSignature(sigBytes: Uint8Array): string {
    // base58 encode
    const ALPHABET =
        "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let num = BigInt(0);
    for (const byte of sigBytes) {
        num = num * 256n + BigInt(byte);
    }
    let encoded = "";
    while (num > 0n) {
        const remainder = Number(num % 58n);
        num = num / 58n;
        encoded = ALPHABET[remainder] + encoded;
    }
    // Leading zeros
    for (const byte of sigBytes) {
        if (byte === 0) encoded = "1" + encoded;
        else break;
    }
    return `ed25519:${encoded}`;
}

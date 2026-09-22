async function rpcCall(
    rpcUrl: string,
    method: string,
    params: unknown[],
): Promise<string> {
    const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) {
        throw new Error(`RPC ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    if (body?.error) {
        throw new Error(body.error.message ?? "RPC error");
    }
    if (
        typeof body?.result !== "string" ||
        !/^0x[0-9a-fA-F]*$/.test(body.result)
    ) {
        throw new Error(`RPC: malformed ${method} result`);
    }
    return body.result;
}

/**
 * Current account nonce via public JSON-RPC (`eth_getTransactionCount`,
 * pending). Throws on failure; callers show "unavailable".
 */
export async function fetchEvmNonce(
    rpcUrl: string,
    address: string,
): Promise<bigint> {
    const result = await rpcCall(rpcUrl, "eth_getTransactionCount", [
        address,
        "pending",
    ]);
    if (result === "0x") throw new Error("RPC: malformed nonce");
    return BigInt(result);
}

/** True when the address has deployed code (`eth_getCode` != "0x"). */
export async function fetchEvmHasCode(
    rpcUrl: string,
    address: string,
): Promise<boolean> {
    const code = await rpcCall(rpcUrl, "eth_getCode", [address, "latest"]);
    return code !== "0x";
}

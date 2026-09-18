import { getNearRpcUrl } from "./network";
import type { NearNetwork } from "./types";

/**
 * Minimal NEAR `call_function` view helper (no wallet needed). Throws on
 * transport/RPC errors; callers degrade to "unavailable".
 */
export async function nearViewFunction<T>(
    network: NearNetwork,
    contractId: string,
    methodName: string,
    args: Record<string, unknown>,
): Promise<T> {
    const response = await fetch(getNearRpcUrl(network), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "query",
            params: {
                request_type: "call_function",
                finality: "final",
                account_id: contractId,
                method_name: methodName,
                args_base64: btoa(JSON.stringify(args)),
            },
        }),
    });
    if (!response.ok) {
        throw new Error(`NEAR RPC ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    if (body?.error) {
        throw new Error(
            `NEAR RPC error: ${body.error.message ?? JSON.stringify(body.error)}`,
        );
    }
    const resultBytes: number[] | undefined = body?.result?.result;
    if (!resultBytes) {
        throw new Error(`NEAR RPC: empty result for ${methodName}`);
    }
    const text = new TextDecoder().decode(new Uint8Array(resultBytes));
    return JSON.parse(text) as T;
}

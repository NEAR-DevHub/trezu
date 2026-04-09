/**
 * Helper to create a treasury via the SSE create-stream endpoint.
 *
 * Used by E2E tests that need a DAO registered in the sandbox backend.
 */

const BACKEND_URL =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_BASE ||
    "http://localhost:8080";

export interface CreateTreasuryOptions {
    name: string;
    accountId: string;
    paymentThreshold?: number;
    governanceThreshold?: number;
    governors: string[];
    financiers: string[];
    requestors: string[];
    isConfidential?: boolean;
}

/**
 * Creates a treasury on the sandbox backend via the SSE stream endpoint.
 * Consumes the full stream and throws on error events.
 */
export async function createTreasury(
    opts: CreateTreasuryOptions,
): Promise<void> {
    const resp = await fetch(`${BACKEND_URL}/api/treasury/create-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: opts.name,
            accountId: opts.accountId,
            paymentThreshold: opts.paymentThreshold ?? 1,
            governanceThreshold: opts.governanceThreshold ?? 1,
            governors: opts.governors,
            financiers: opts.financiers,
            requestors: opts.requestors,
            ...(opts.isConfidential ? { isConfidential: true } : {}),
        }),
    });

    if (!resp.ok) {
        throw new Error(
            `Failed to create DAO: ${resp.status} ${await resp.text()}`,
        );
    }

    // Consume SSE stream until "done" or "error"
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = JSON.parse(line.slice(5).trim());
            console.log(`[CREATE] ${data.step}: ${data.status}`);
            if (data.step === "error") {
                throw new Error(`DAO creation failed: ${data.message}`);
            }
        }
    }
}

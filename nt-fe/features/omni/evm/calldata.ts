import {
    type Abi,
    type AbiFunction,
    decodeFunctionData,
    getAbiItem,
    getAddress,
    isAddress,
    parseAbi,
    toFunctionSelector,
} from "viem";

/**
 * Fallback ABI for the most common admin/token selectors, used when Sourcify
 * has no verified source (or is down). Names come from the selector only, so
 * the source is labelled "built-in selector table".
 */
export const BUILTIN_SELECTOR_ABI: Abi = parseAbi([
    "function transfer(address to, uint256 amount)",
    "function approve(address spender, uint256 amount)",
    "function transferFrom(address from, address to, uint256 amount)",
    "function transferOwnership(address newOwner)",
    "function pause()",
    "function unpause()",
    "function upgradeTo(address newImplementation)",
    "function upgradeToAndCall(address newImplementation, bytes data)",
    "function grantRole(bytes32 role, address account)",
    "function revokeRole(bytes32 role, address account)",
    "function renounceRole(bytes32 role, address account)",
]);

export const BUILTIN_SOURCE_LABEL = "built-in selector table";

/** Decode with the built-in table only (sync, no network). */
export function decodeCalldataBuiltin(
    input: `0x${string}`,
): DecodedCall | null {
    const decoded = decodeWithAbi(BUILTIN_SELECTOR_ABI, input);
    return decoded ? { ...decoded, source: BUILTIN_SOURCE_LABEL } : null;
}

const SOURCIFY_URL = "https://sourcify.dev/server";

/** Selector + argument bytes split of calldata (presentation only). */
export function splitCalldata(input: `0x${string}`): {
    selector: `0x${string}` | null;
    args: `0x${string}` | null;
    byteLength: number;
} {
    const bytes = (input.length - 2) / 2;
    if (bytes < 4) {
        return { selector: null, args: null, byteLength: bytes };
    }
    return {
        selector: input.slice(0, 10) as `0x${string}`,
        args: `0x${input.slice(10)}` as `0x${string}`,
        byteLength: bytes,
    };
}

export interface DecodedCall {
    functionName: string;
    signature: string;
    args: Array<{ name: string; type: string; value: string }>;
    /** Where the ABI came from, e.g. "Sourcify (exact match)". */
    source: string;
    /** Implementation address when the target is a verified proxy. */
    implementation?: string;
}

interface SourcifyResponse {
    match?: string;
    abi?: Abi;
    proxyResolution?: {
        isProxy?: boolean;
        implementations?: Array<{ address: string }>;
    };
}

type SourcifyContract = { abi: Abi; source: string; implementation?: string };

const SOURCIFY_TIMEOUT_MS = 5_000;

/** Page-lifetime cache per (chainId, address); failures are not cached. */
const sourcifyCache = new Map<string, Promise<SourcifyContract | null>>();

function sourcifyLookup(
    chainId: number,
    address: string,
): Promise<SourcifyContract | null> {
    const key = `${chainId}:${address.toLowerCase()}`;
    const cached = sourcifyCache.get(key);
    if (cached) return cached;
    const pending = sourcifyLookupUncached(chainId, address).catch((error) => {
        sourcifyCache.delete(key);
        throw error;
    });
    sourcifyCache.set(key, pending);
    return pending;
}

async function sourcifyLookupUncached(
    chainId: number,
    address: string,
): Promise<SourcifyContract | null> {
    const url = `${SOURCIFY_URL}/v2/contract/${chainId}/${address}?fields=abi,proxyResolution`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SOURCIFY_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Sourcify answered ${response.status}`);
    let body: SourcifyResponse;
    try {
        body = (await response.json()) as SourcifyResponse;
    } catch {
        throw new Error("Sourcify returned a non-JSON response");
    }
    if (!body || typeof body !== "object" || !Array.isArray(body.abi)) {
        return null;
    }
    const source =
        body.match === "exact_match"
            ? "Sourcify (exact match)"
            : body.match
              ? `Sourcify (${body.match.replace(/_/g, " ")}: names may differ from the deployed source)`
              : "Sourcify";
    const implementation = body.proxyResolution?.isProxy
        ? body.proxyResolution.implementations?.[0]?.address
        : undefined;
    return { abi: body.abi, source, implementation };
}

function stringifyArg(value: unknown, type?: string): string {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") {
        return type === "address" && isAddress(value, { strict: false })
            ? getAddress(value)
            : value;
    }
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    return JSON.stringify(value, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
    );
}

function decodeWithAbi(
    abi: Abi,
    input: `0x${string}`,
): Omit<DecodedCall, "source" | "implementation"> | null {
    try {
        const { functionName, args } = decodeFunctionData({ abi, data: input });
        const item = getAbiItem({ abi, name: functionName }) as
            | AbiFunction
            | undefined;
        if (!item || item.type !== "function") return null;
        const signature = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
        // When a contract overloads a name, pick the item whose selector
        // matches the calldata.
        const selector = input.slice(0, 10);
        const candidates = abi.filter(
            (entry): entry is AbiFunction =>
                entry.type === "function" && entry.name === functionName,
        );
        const exact =
            candidates.find((c) => toFunctionSelector(c) === selector) ?? item;
        return {
            functionName: exact.name,
            signature: `${exact.name}(${exact.inputs.map((i) => i.type).join(",")})`,
            args: exact.inputs.map((param, index) => ({
                name: param.name || `arg${index}`,
                type: param.type,
                value: stringifyArg(
                    (args as unknown[] | undefined)?.[index],
                    param.type,
                ),
            })),
        } satisfies Omit<DecodedCall, "source" | "implementation"> & {
            signature: typeof signature;
        };
    } catch {
        return null;
    }
}

/**
 * Resolve the target's ABI via Sourcify (keyless) and decode the calldata.
 * Follows one proxy hop. Returns null when nothing verified is available.
 * Throws only on transport errors so callers can show "unavailable".
 */
export async function decodeCalldataViaSourcify(
    chainId: number,
    to: string,
    input: `0x${string}`,
): Promise<DecodedCall | null> {
    if (input.length < 10) return null;
    const contract = await sourcifyLookup(chainId, to);
    if (!contract) return null;
    let decoded = decodeWithAbi(contract.abi, input);
    let source = contract.source;
    if (!decoded && contract.implementation) {
        const implementation = await sourcifyLookup(
            chainId,
            contract.implementation,
        );
        if (implementation) {
            decoded = decodeWithAbi(implementation.abi, input);
            source = `${implementation.source}, via proxy`;
        }
    }
    if (!decoded) return null;
    return { ...decoded, source, implementation: contract.implementation };
}

/**
 * Sourcify first; the built-in selector table when Sourcify has nothing.
 * A Sourcify transport failure still falls back to the table (and is
 * reported via `sourcifyFailed` so the UI can say "lookup unavailable").
 */
export async function decodeCalldata(
    chainId: number,
    to: string,
    input: `0x${string}`,
): Promise<{ decoded: DecodedCall | null; sourcifyFailed: boolean }> {
    try {
        const decoded = await decodeCalldataViaSourcify(chainId, to, input);
        if (decoded) return { decoded, sourcifyFailed: false };
        return { decoded: decodeCalldataBuiltin(input), sourcifyFailed: false };
    } catch {
        return { decoded: decodeCalldataBuiltin(input), sourcifyFailed: true };
    }
}

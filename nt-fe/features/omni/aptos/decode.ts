import { bytesToHex } from "../bcs";
import {
    type AptosRawTransaction,
    type AptosTypeTag,
    formatAptosTypeTag,
} from "./recompute";

/** Human decode of well-known Aptos entry functions (presentation only). */
export type AptosKnownCall =
    | { kind: "apt-transfer"; to: string; octas: bigint }
    | {
          kind: "coin-transfer";
          coinType: string;
          to: string;
          amount: bigint;
          /** True only for 0x1::aptos_coin::AptosCoin (8 decimals known). */
          isApt: boolean;
      }
    | {
          kind: "fa-transfer";
          metadata: string;
          to: string;
          amount: bigint;
          /** True only for the APT fungible-asset object 0xa. */
          isApt: boolean;
      };

const APT_COIN_TYPE = "0x1::aptos_coin::AptosCoin";
const APT_FA_METADATA = `0x${"0".repeat(63)}a`;

export interface DecodedAptosTx {
    sender: string;
    sequenceNumber: bigint;
    /** "0x1::aptos_account::transfer" */
    functionId: string;
    tyArgs: string[];
    /** Raw args as 0x hex, in order. */
    args: string[];
    /** Typed reading per argument when the function is known (same index as `args`), else null. */
    argDetails: Array<{ type: string; value: string; note?: string } | null>;
    known: AptosKnownCall | null;
    maxGasAmount: bigint;
    gasUnitPrice: bigint;
    /** max_gas_amount * gas_unit_price, in octas. */
    maxGasOctas: bigint;
    expirationTimestampSecs: bigint;
    chainId: number;
}

function shortAddress(bytes: Uint8Array): string {
    return `0x${bytesToHex(bytes).replace(/^0+(?=.)/, "")}`;
}

function fullAddress(bytes: Uint8Array): string {
    return `0x${bytesToHex(bytes)}`;
}

function readU64LE(bytes: Uint8Array): bigint | null {
    if (bytes.length !== 8) return null;
    let value = 0n;
    for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
    return value;
}

function readAddress(bytes: Uint8Array): string | null {
    return bytes.length === 32 ? fullAddress(bytes) : null;
}

const FRAMEWORK = `0x${"0".repeat(63)}1`;

function knownCall(tx: AptosRawTransaction): AptosKnownCall | null {
    const entry = tx.payload.entry;
    const moduleAddr = fullAddress(entry.moduleAddress);
    if (moduleAddr !== FRAMEWORK) return null;
    const id = `${entry.moduleName}::${entry.functionName}`;
    if (id === "aptos_account::transfer" && entry.args.length === 2) {
        const to = readAddress(entry.args[0]);
        const octas = readU64LE(entry.args[1]);
        if (to && octas !== null) return { kind: "apt-transfer", to, octas };
    }
    if (
        id === "coin::transfer" &&
        entry.args.length === 2 &&
        entry.tyArgs.length === 1
    ) {
        const to = readAddress(entry.args[0]);
        const amount = readU64LE(entry.args[1]);
        if (to && amount !== null) {
            const coinType = formatAptosTypeTag(
                entry.tyArgs[0] as AptosTypeTag,
            );
            return {
                kind: "coin-transfer",
                coinType,
                to,
                amount,
                isApt: coinType === APT_COIN_TYPE,
            };
        }
    }
    if (id === "primary_fungible_store::transfer" && entry.args.length === 3) {
        const metadata = readAddress(entry.args[0]);
        const to = readAddress(entry.args[1]);
        const amount = readU64LE(entry.args[2]);
        if (metadata && to && amount !== null) {
            return {
                kind: "fa-transfer",
                metadata,
                to,
                amount,
                isApt: metadata === APT_FA_METADATA,
            };
        }
    }
    return null;
}

/** Per-argument typed readings for the known framework calls. */
function argDetails(
    tx: AptosRawTransaction,
    known: AptosKnownCall | null,
): DecodedAptosTx["argDetails"] {
    const entry = tx.payload.entry;
    const none = entry.args.map(() => null);
    if (!known) return none;
    const address = (bytes: Uint8Array) => ({
        type: "address",
        value: fullAddress(bytes),
    });
    const amount = (bytes: Uint8Array, isApt: boolean) => {
        const raw = readU64LE(bytes);
        if (raw === null) return null;
        return {
            type: "u64",
            value: raw.toString(),
            note: isApt ? `${formatOctas(raw)} APT` : undefined,
        };
    };
    switch (known.kind) {
        case "apt-transfer":
            return [address(entry.args[0]), amount(entry.args[1], true)];
        case "coin-transfer":
            return [address(entry.args[0]), amount(entry.args[1], known.isApt)];
        case "fa-transfer":
            return [
                { type: "address", value: known.metadata, note: "metadata" },
                address(entry.args[1]),
                amount(entry.args[2], known.isApt),
            ];
    }
}

/** Exact APT amount from octas (8 decimals), trailing zeros trimmed. */
function formatOctas(octas: bigint): string {
    const text = octas.toString().padStart(9, "0");
    const whole = text.slice(0, -8);
    const fraction = text.slice(-8).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole;
}

export function decodeAptosTx(tx: AptosRawTransaction): DecodedAptosTx {
    const entry = tx.payload.entry;
    const known = knownCall(tx);
    return {
        argDetails: argDetails(tx, known),
        sender: fullAddress(tx.sender),
        sequenceNumber: tx.sequenceNumber,
        functionId: `${shortAddress(entry.moduleAddress)}::${entry.moduleName}::${entry.functionName}`,
        tyArgs: entry.tyArgs.map(formatAptosTypeTag),
        args: entry.args.map((a) => `0x${bytesToHex(a)}`),
        known,
        maxGasAmount: tx.maxGasAmount,
        gasUnitPrice: tx.gasUnitPrice,
        maxGasOctas: tx.maxGasAmount * tx.gasUnitPrice,
        expirationTimestampSecs: tx.expirationTimestampSecs,
        chainId: tx.chainId,
    };
}

/** Current on-chain sequence number via the fullnode REST API. */
export async function fetchAptosSequenceNumber(
    fullnodeUrl: string,
    address: string,
): Promise<bigint> {
    const response = await fetch(`${fullnodeUrl}/v1/accounts/${address}`, {
        headers: { Accept: "application/json" },
    });
    if (!response.ok) {
        throw new Error(
            `Aptos fullnode ${response.status} ${response.statusText}`,
        );
    }
    const body = (await response.json()) as { sequence_number?: string };
    if (
        typeof body?.sequence_number !== "string" ||
        !/^\d+$/.test(body.sequence_number)
    ) {
        throw new Error("Aptos fullnode: malformed sequence_number");
    }
    return BigInt(body.sequence_number);
}

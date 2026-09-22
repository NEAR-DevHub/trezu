import { getAddress, isAddress, keccak256, serializeTransaction } from "viem";
import type { EvmUnsignedTx, PayloadRecompute } from "../types";

const DECIMAL_RE = /^\d+$/;
const HEX_DATA_RE = /^0x(?:[0-9a-fA-F]{2})*$/;

export type EvmParseResult =
    | { ok: true; tx: EvmUnsignedTx }
    | {
          ok: false;
          reason: "unsupported-shape" | "invalid-field" | "contract-creation";
          detail: string;
      };

function readBigInt(
    record: Record<string, unknown>,
    key: string,
): bigint | null {
    const value = record[key];
    if (typeof value === "string" && DECIMAL_RE.test(value)) {
        return BigInt(value);
    }
    if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
    ) {
        return BigInt(value);
    }
    return null;
}

/**
 * Parse the reviewer-friendly `EvmTxJson` form written by omni-cli-rs:
 * `{chain_id, nonce, to, value, input, gas_limit, max_fee_per_gas,
 * max_priority_fee_per_gas}` with decimal-string amounts and 0x hex bytes.
 * The raw serde form of older CLI versions (byte arrays) is rejected as
 * "unsupported-shape".
 */
export function parseEvmUnsignedTx(unsignedTx: unknown): EvmParseResult {
    if (
        typeof unsignedTx !== "object" ||
        unsignedTx === null ||
        Array.isArray(unsignedTx)
    ) {
        return {
            ok: false,
            reason: "unsupported-shape",
            detail: "unsigned_tx is not an object",
        };
    }
    const record = unsignedTx as Record<string, unknown>;

    // Older CLI versions wrote the raw serde form (`to`/`input` as byte arrays).
    if (Array.isArray(record.to) || Array.isArray(record.input)) {
        return {
            ok: false,
            reason: "unsupported-shape",
            detail: "unsigned_tx uses the legacy byte-array form",
        };
    }

    const required = [
        "chain_id",
        "nonce",
        "to",
        "value",
        "input",
        "gas_limit",
        "max_fee_per_gas",
        "max_priority_fee_per_gas",
    ];
    for (const key of required) {
        if (!(key in record)) {
            return {
                ok: false,
                reason: "unsupported-shape",
                detail: `missing field ${key}`,
            };
        }
    }

    const chainId = readBigInt(record, "chain_id");
    if (chainId === null) {
        return { ok: false, reason: "invalid-field", detail: "chain_id" };
    }
    const nonce = readBigInt(record, "nonce");
    if (nonce === null) {
        return { ok: false, reason: "invalid-field", detail: "nonce" };
    }
    const to = record.to;
    // The Rust serializer writes `to: ""` for contract creation (`to: None`).
    // Reviewing deploy bytecode is out of scope for the browser verifier.
    if (to === "" || to === null) {
        return {
            ok: false,
            reason: "contract-creation",
            detail: "contract creation (empty `to`) is not supported",
        };
    }
    if (typeof to !== "string" || !isAddress(to, { strict: false })) {
        return { ok: false, reason: "invalid-field", detail: "to" };
    }
    const value = readBigInt(record, "value");
    if (value === null) {
        return { ok: false, reason: "invalid-field", detail: "value" };
    }
    const input = record.input;
    if (typeof input !== "string" || !HEX_DATA_RE.test(input)) {
        return { ok: false, reason: "invalid-field", detail: "input" };
    }
    const gasLimit = readBigInt(record, "gas_limit");
    if (gasLimit === null) {
        return { ok: false, reason: "invalid-field", detail: "gas_limit" };
    }
    const maxFeePerGas = readBigInt(record, "max_fee_per_gas");
    if (maxFeePerGas === null) {
        return {
            ok: false,
            reason: "invalid-field",
            detail: "max_fee_per_gas",
        };
    }
    const maxPriorityFeePerGas = readBigInt(record, "max_priority_fee_per_gas");
    if (maxPriorityFeePerGas === null) {
        return {
            ok: false,
            reason: "invalid-field",
            detail: "max_priority_fee_per_gas",
        };
    }

    return {
        ok: true,
        tx: {
            chainId,
            nonce,
            // Checksummed for display. Hashing lowercases it again: the RLP
            // is case-independent and viem's EIP-55 assertion must not turn
            // a badly-cased envelope address into a false UNVERIFIED (alloy
            // in the CLI does not enforce checksums either).
            to: getAddress(to),
            value,
            input: input as `0x${string}`,
            gasLimit,
            maxFeePerGas,
            maxPriorityFeePerGas,
        },
    };
}

/**
 * The 32-byte payload the MPC signs for an EIP-1559 transaction:
 * keccak256(0x02 || rlp([chain_id, nonce, max_priority_fee_per_gas,
 * max_fee_per_gas, gas_limit, to, value, input, accessList=[]])).
 * Returned as lowercase hex without 0x.
 */
export function evmSigningPayloadHex(tx: EvmUnsignedTx): string {
    const serialized = serializeTransaction({
        type: "eip1559",
        chainId: Number(tx.chainId),
        nonce: Number(tx.nonce),
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        maxFeePerGas: tx.maxFeePerGas,
        gas: tx.gasLimit,
        to: tx.to.toLowerCase() as `0x${string}`,
        value: tx.value,
        data: tx.input,
        accessList: [],
    });
    return keccak256(serialized).slice(2).toLowerCase();
}

/** Recompute the signing payload(s) from an EVM envelope. */
export function evmPayloadsFromEnvelope(unsignedTx: unknown): PayloadRecompute {
    const parsed = parseEvmUnsignedTx(unsignedTx);
    if (!parsed.ok) {
        return { ok: false, reason: parsed.reason, detail: parsed.detail };
    }
    // chain_id and nonce must fit a JS number for viem; both are u64 in the
    // envelope, but real values are small. Guard anyway.
    if (
        parsed.tx.chainId > BigInt(Number.MAX_SAFE_INTEGER) ||
        parsed.tx.nonce > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
        return { ok: false, reason: "invalid-field", detail: "chain_id/nonce" };
    }
    try {
        return { ok: true, payloadsHex: [evmSigningPayloadHex(parsed.tx)] };
    } catch (error) {
        return {
            ok: false,
            reason: "invalid-field",
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}

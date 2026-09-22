import { base58 } from "@scure/base";
import { bytesFromJson, bytesToHex } from "../bcs";
import type { PayloadRecompute } from "../types";

/**
 * Solana message serialization, mirroring omni-transaction-rs
 * `SolanaMessage::to_bytes`. The MPC signs the full message bytes (ed25519),
 * so the payload is the serialized message itself, not a hash.
 */

/** Solana packet limit; anything larger cannot be broadcast. */
export const SVM_MAX_MESSAGE_BYTES = 1232;

export interface SvmCompiledInstruction {
    programIdIndex: number;
    accounts: number[];
    data: Uint8Array;
}

export interface SvmAddressTableLookup {
    accountKey: Uint8Array;
    writableIndexes: number[];
    readonlyIndexes: number[];
}

export interface SvmMessage {
    version: "Legacy" | "V0";
    header: {
        numRequiredSignatures: number;
        numReadonlySignedAccounts: number;
        numReadonlyUnsignedAccounts: number;
    };
    accountKeys: Uint8Array[];
    recentBlockhash: Uint8Array;
    instructions: SvmCompiledInstruction[];
    addressTableLookups: SvmAddressTableLookup[];
}

export type SvmParseResult =
    | { ok: true; message: SvmMessage }
    | {
          ok: false;
          reason: "unsupported-shape" | "invalid-field";
          detail: string;
      };

function fail(detail: string): {
    ok: false;
    reason: "invalid-field";
    detail: string;
} {
    return { ok: false, reason: "invalid-field", detail };
}

function readU8(value: unknown): number | null {
    return typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 255
        ? value
        : null;
}

function readU8Array(value: unknown): number[] | null {
    if (!Array.isArray(value)) return null;
    const out: number[] = [];
    for (const item of value) {
        const n = readU8(item);
        if (n === null) return null;
        out.push(n);
    }
    return out;
}

function readKey(value: unknown): Uint8Array | null {
    if (typeof value !== "string") return null;
    try {
        const bytes = base58.decode(value);
        return bytes.length === 32 ? bytes : null;
    } catch {
        return null;
    }
}

/** Parse the envelope `unsigned_tx` (`{signatures?, message: {Legacy|V0: …}}`). */
export function parseSvmUnsignedTx(unsignedTx: unknown): SvmParseResult {
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
    const message = (unsignedTx as Record<string, unknown>).message;
    if (typeof message !== "object" || message === null) {
        return {
            ok: false,
            reason: "unsupported-shape",
            detail: "missing field message",
        };
    }
    const m = message as Record<string, unknown>;
    const version: "Legacy" | "V0" | null =
        "Legacy" in m ? "Legacy" : "V0" in m ? "V0" : null;
    if (!version) {
        return {
            ok: false,
            reason: "unsupported-shape",
            detail: `unsupported message kind ${Object.keys(m)[0] ?? "unknown"}`,
        };
    }
    const inner = m[version];
    if (typeof inner !== "object" || inner === null)
        return fail(`message.${version}`);
    const body = inner as Record<string, unknown>;
    for (const key of [
        "header",
        "account_keys",
        "recent_blockhash",
        "instructions",
    ]) {
        if (!(key in body))
            return {
                ok: false,
                reason: "unsupported-shape",
                detail: `missing field message.${version}.${key}`,
            };
    }
    if (version === "V0" && !("address_table_lookups" in body)) {
        return {
            ok: false,
            reason: "unsupported-shape",
            detail: "missing field message.V0.address_table_lookups",
        };
    }
    const header = body.header as Record<string, unknown> | null;
    if (typeof header !== "object" || header === null) return fail("header");
    const numRequiredSignatures = readU8(header.num_required_signatures);
    const numReadonlySignedAccounts = readU8(
        header.num_readonly_signed_accounts,
    );
    const numReadonlyUnsignedAccounts = readU8(
        header.num_readonly_unsigned_accounts,
    );
    if (
        numRequiredSignatures === null ||
        numReadonlySignedAccounts === null ||
        numReadonlyUnsignedAccounts === null
    ) {
        return fail("header");
    }
    if (!Array.isArray(body.account_keys)) return fail("account_keys");
    const accountKeys: Uint8Array[] = [];
    for (const [index, raw] of body.account_keys.entries()) {
        const key = readKey(raw);
        if (!key) return fail(`account_keys[${index}]`);
        accountKeys.push(key);
    }
    const recentBlockhash = readKey(body.recent_blockhash);
    if (!recentBlockhash) return fail("recent_blockhash");
    if (!Array.isArray(body.instructions)) return fail("instructions");
    const instructions: SvmCompiledInstruction[] = [];
    for (const [index, raw] of body.instructions.entries()) {
        if (typeof raw !== "object" || raw === null)
            return fail(`instructions[${index}]`);
        const ix = raw as Record<string, unknown>;
        const programIdIndex = readU8(ix.program_id_index);
        if (programIdIndex === null)
            return fail(`instructions[${index}].program_id_index`);
        const accounts = readU8Array(ix.accounts);
        if (!accounts) return fail(`instructions[${index}].accounts`);
        const data = bytesFromJson(ix.data);
        if (!data) return fail(`instructions[${index}].data`);
        instructions.push({ programIdIndex, accounts, data });
    }
    const addressTableLookups: SvmAddressTableLookup[] = [];
    if (version === "V0") {
        if (!Array.isArray(body.address_table_lookups))
            return fail("address_table_lookups");
        for (const [index, raw] of body.address_table_lookups.entries()) {
            if (typeof raw !== "object" || raw === null)
                return fail(`address_table_lookups[${index}]`);
            const lookup = raw as Record<string, unknown>;
            const accountKey = readKey(lookup.account_key);
            if (!accountKey)
                return fail(`address_table_lookups[${index}].account_key`);
            const writableIndexes = readU8Array(lookup.writable_indexes);
            const readonlyIndexes = readU8Array(lookup.readonly_indexes);
            if (!writableIndexes || !readonlyIndexes)
                return fail(`address_table_lookups[${index}]`);
            addressTableLookups.push({
                accountKey,
                writableIndexes,
                readonlyIndexes,
            });
        }
    }
    // Every index must point inside the account space: static keys for
    // Legacy, static + loaded (writable then readonly) for V0.
    const loadedCount = addressTableLookups.reduce(
        (sum, l) => sum + l.writableIndexes.length + l.readonlyIndexes.length,
        0,
    );
    const accountSpace = accountKeys.length + loadedCount;
    for (const [index, ix] of instructions.entries()) {
        if (ix.programIdIndex >= accountKeys.length) {
            return fail(`instructions[${index}].program_id_index`);
        }
        if (ix.accounts.some((a) => a >= accountSpace)) {
            return fail(`instructions[${index}].accounts`);
        }
    }
    return {
        ok: true,
        message: {
            version,
            header: {
                numRequiredSignatures,
                numReadonlySignedAccounts,
                numReadonlyUnsignedAccounts,
            },
            accountKeys,
            recentBlockhash,
            instructions,
            addressTableLookups,
        },
    };
}

/** Solana compact-u16 ("shortvec") length encoding. */
export function encodeCompactU16(value: number, out: number[]): void {
    if (value < 0 || value > 0xffff)
        throw new Error("compact-u16 out of range");
    let v = value;
    for (;;) {
        const byte = v & 0x7f;
        v >>= 7;
        if (v === 0) {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

function pushBytes(out: number[], bytes: Uint8Array): void {
    for (const b of bytes) out.push(b);
}

/** Serialized message bytes: exactly what the fee payer signs. */
export function serializeSvmMessage(message: SvmMessage): Uint8Array {
    const out: number[] = [];
    if (message.version === "V0") out.push(0x80);
    out.push(
        message.header.numRequiredSignatures,
        message.header.numReadonlySignedAccounts,
        message.header.numReadonlyUnsignedAccounts,
    );
    encodeCompactU16(message.accountKeys.length, out);
    for (const key of message.accountKeys) pushBytes(out, key);
    pushBytes(out, message.recentBlockhash);
    encodeCompactU16(message.instructions.length, out);
    for (const ix of message.instructions) {
        out.push(ix.programIdIndex);
        encodeCompactU16(ix.accounts.length, out);
        out.push(...ix.accounts);
        encodeCompactU16(ix.data.length, out);
        pushBytes(out, ix.data);
    }
    if (message.version === "V0") {
        encodeCompactU16(message.addressTableLookups.length, out);
        for (const lookup of message.addressTableLookups) {
            pushBytes(out, lookup.accountKey);
            encodeCompactU16(lookup.writableIndexes.length, out);
            out.push(...lookup.writableIndexes);
            encodeCompactU16(lookup.readonlyIndexes.length, out);
            out.push(...lookup.readonlyIndexes);
        }
    }
    return Uint8Array.from(out);
}

/**
 * Durable nonce stored in a nonce account (versioned state: u32 version,
 * u32 state, 32-byte authority, 32-byte durable nonce, u64 fee calculator).
 * Returns null when the account does not exist. Presentation only.
 */
export async function fetchSvmDurableNonce(
    rpcUrl: string,
    nonceAccount: string,
): Promise<string | null> {
    const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [nonceAccount, { encoding: "base64" }],
        }),
    });
    if (!response.ok)
        throw new Error(`RPC ${response.status} ${response.statusText}`);
    const body = await response.json();
    if (body?.error) throw new Error(body.error.message ?? "RPC error");
    const value = body?.result?.value;
    if (value === null) return null;
    const data = value?.data;
    if (!Array.isArray(data) || typeof data[0] !== "string")
        throw new Error("RPC: malformed account data");
    const bytes = Uint8Array.from(atob(data[0]), (c) => c.charCodeAt(0));
    if (bytes.length < 72) throw new Error("RPC: nonce account too short");
    return base58.encode(bytes.slice(40, 72));
}

export function svmPayloadsFromEnvelope(unsignedTx: unknown): PayloadRecompute {
    const parsed = parseSvmUnsignedTx(unsignedTx);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason, detail: parsed.detail };
    try {
        const bytes = serializeSvmMessage(parsed.message);
        if (bytes.length > SVM_MAX_MESSAGE_BYTES) {
            return {
                ok: false,
                reason: "invalid-field",
                detail: `oversized message (${bytes.length} bytes > ${SVM_MAX_MESSAGE_BYTES})`,
            };
        }
        return { ok: true, payloadsHex: [bytesToHex(bytes)] };
    } catch (error) {
        return {
            ok: false,
            reason: "invalid-field",
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}

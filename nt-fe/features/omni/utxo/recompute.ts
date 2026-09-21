import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, u64FromJson } from "../bcs";
import type { PayloadRecompute } from "../types";

/**
 * BIP143 (segwit v0) sighash for P2WPKH inputs, one payload per input,
 * mirroring omni-cli-rs `input_sighashes` / omni-transaction-rs
 * `build_for_signing_segwit`. The MPC signs sha256d(preimage) with
 * SIGHASH_ALL.
 */

export interface UtxoTxInput {
    /** 32-byte txid in display order (as explorers show it). */
    txidDisplay: Uint8Array;
    vout: number;
    sequence: number;
}

export interface UtxoTxOutput {
    valueSats: bigint;
    scriptPubkey: Uint8Array;
}

export interface UtxoTransaction {
    version: number;
    lockTime: number;
    inputs: UtxoTxInput[];
    outputs: UtxoTxOutput[];
    /** One value per input, in sats. */
    inputValues: bigint[];
    /** Compressed secp256k1 key (33 bytes) of the P2WPKH sender. */
    senderPublicKey: Uint8Array;
}

export type UtxoParseResult =
    | { ok: true; tx: UtxoTransaction }
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

function readU32(value: unknown): number | null {
    if (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 0xffffffff
    )
        return value;
    if (typeof value === "string" && /^\d+$/.test(value)) {
        const n = Number(value);
        return n <= 0xffffffff ? n : null;
    }
    return null;
}

/** Parse the envelope `unsigned_tx` (`{tx, input_values, sender_public_key}`). */
export function parseUtxoUnsignedTx(unsignedTx: unknown): UtxoParseResult {
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
    const outer = unsignedTx as Record<string, unknown>;
    for (const key of ["tx", "input_values", "sender_public_key"]) {
        if (!(key in outer))
            return {
                ok: false,
                reason: "unsupported-shape",
                detail: `missing field ${key}`,
            };
    }
    const tx = outer.tx as Record<string, unknown> | null;
    if (typeof tx !== "object" || tx === null) return fail("tx");
    for (const key of ["version", "lock_time", "inputs", "outputs"]) {
        if (!(key in tx))
            return {
                ok: false,
                reason: "unsupported-shape",
                detail: `missing field tx.${key}`,
            };
    }
    const version = readU32(tx.version);
    if (version === null || (version !== 1 && version !== 2))
        return fail("tx.version");
    const lockTime = readU32(tx.lock_time);
    if (lockTime === null) return fail("tx.lock_time");
    if (!Array.isArray(tx.inputs) || tx.inputs.length === 0)
        return fail("tx.inputs");
    const inputs: UtxoTxInput[] = [];
    for (const [index, raw] of tx.inputs.entries()) {
        if (typeof raw !== "object" || raw === null)
            return fail(`tx.inputs[${index}]`);
        const r = raw as Record<string, unknown>;
        const txid =
            typeof r.txid === "string" && r.txid.length === 64
                ? hexToBytes(r.txid)
                : null;
        if (!txid) return fail(`tx.inputs[${index}].txid`);
        const vout = readU32(r.vout);
        if (vout === null) return fail(`tx.inputs[${index}].vout`);
        const sequence = readU32(r.sequence);
        if (sequence === null) return fail(`tx.inputs[${index}].sequence`);
        inputs.push({ txidDisplay: txid, vout, sequence });
    }
    if (!Array.isArray(tx.outputs) || tx.outputs.length === 0)
        return fail("tx.outputs");
    const outputs: UtxoTxOutput[] = [];
    for (const [index, raw] of tx.outputs.entries()) {
        if (typeof raw !== "object" || raw === null)
            return fail(`tx.outputs[${index}]`);
        const r = raw as Record<string, unknown>;
        const valueSats = u64FromJson(r.value_sats);
        if (valueSats === null) return fail(`tx.outputs[${index}].value_sats`);
        const scriptPubkey =
            typeof r.script_pubkey === "string"
                ? hexToBytes(r.script_pubkey)
                : null;
        if (!scriptPubkey || scriptPubkey.length > 10_000)
            return fail(`tx.outputs[${index}].script_pubkey`);
        outputs.push({ valueSats, scriptPubkey });
    }
    if (
        !Array.isArray(outer.input_values) ||
        outer.input_values.length !== inputs.length
    ) {
        return fail("input_values");
    }
    const inputValues: bigint[] = [];
    for (const [index, raw] of outer.input_values.entries()) {
        const value = u64FromJson(raw);
        if (value === null) return fail(`input_values[${index}]`);
        inputValues.push(value);
    }
    const senderPublicKey =
        typeof outer.sender_public_key === "string"
            ? hexToBytes(outer.sender_public_key)
            : null;
    if (
        !senderPublicKey ||
        senderPublicKey.length !== 33 ||
        (senderPublicKey[0] !== 0x02 && senderPublicKey[0] !== 0x03)
    ) {
        return fail("sender_public_key");
    }
    return {
        ok: true,
        tx: {
            version,
            lockTime,
            inputs,
            outputs,
            inputValues,
            senderPublicKey,
        },
    };
}

function u32le(value: number): number[] {
    return [
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
    ];
}

function u64le(value: bigint): number[] {
    const out: number[] = [];
    let v = value;
    for (let i = 0; i < 8; i++) {
        out.push(Number(v & 0xffn));
        v >>= 8n;
    }
    return out;
}

/** Bitcoin CompactSize varint. */
export function varint(value: number): number[] {
    if (value < 0xfd) return [value];
    if (value <= 0xffff) return [0xfd, value & 0xff, value >>> 8];
    if (value <= 0xffffffff) return [0xfe, ...u32le(value)];
    throw new Error("varint out of range");
}

export function sha256d(bytes: Uint8Array): Uint8Array {
    return sha256(sha256(bytes));
}

export function hash160(bytes: Uint8Array): Uint8Array {
    return ripemd160(sha256(bytes));
}

/** P2WPKH scriptPubKey: OP_0 <20-byte pkh>. */
export function p2wpkhScriptPubkey(compressedKey: Uint8Array): Uint8Array {
    return Uint8Array.from([0x00, 0x14, ...hash160(compressedKey)]);
}

/** BIP143 script code of a P2WPKH input: OP_DUP OP_HASH160 <pkh> OP_EQUALVERIFY OP_CHECKSIG. */
export function p2wpkhScriptCode(compressedKey: Uint8Array): Uint8Array {
    return Uint8Array.from([
        0x76,
        0xa9,
        0x14,
        ...hash160(compressedKey),
        0x88,
        0xac,
    ]);
}

function outpointBytes(input: UtxoTxInput): number[] {
    // txid is stored display-order and serialized reversed (wire order).
    return [...Array.from(input.txidDisplay).reverse(), ...u32le(input.vout)];
}

/** BIP143 preimage for input `index` (SIGHASH_ALL, P2WPKH script code). */
export function bip143Preimage(
    tx: Pick<UtxoTransaction, "version" | "lockTime" | "inputs" | "outputs">,
    index: number,
    valueSats: bigint,
    scriptCode: Uint8Array,
): Uint8Array {
    const input = tx.inputs[index];
    if (!input) throw new Error(`input ${index} out of range`);
    const prevouts: number[] = [];
    const sequences: number[] = [];
    for (const i of tx.inputs) {
        prevouts.push(...outpointBytes(i));
        sequences.push(...u32le(i.sequence));
    }
    const outputs: number[] = [];
    for (const o of tx.outputs) {
        outputs.push(
            ...u64le(o.valueSats),
            ...varint(o.scriptPubkey.length),
            ...o.scriptPubkey,
        );
    }
    return Uint8Array.from([
        ...u32le(tx.version),
        ...sha256d(Uint8Array.from(prevouts)),
        ...sha256d(Uint8Array.from(sequences)),
        ...outpointBytes(input),
        ...varint(scriptCode.length),
        ...scriptCode,
        ...u64le(valueSats),
        ...u32le(input.sequence),
        ...sha256d(Uint8Array.from(outputs)),
        ...u32le(tx.lockTime),
        ...u32le(1), // SIGHASH_ALL
    ]);
}

/** sha256d of the BIP143 preimage, lowercase hex. */
export function utxoInputSighashHex(
    tx: Pick<UtxoTransaction, "version" | "lockTime" | "inputs" | "outputs">,
    index: number,
    valueSats: bigint,
    compressedKey: Uint8Array,
): string {
    return bytesToHex(
        sha256d(
            bip143Preimage(
                tx,
                index,
                valueSats,
                p2wpkhScriptCode(compressedKey),
            ),
        ),
    );
}

/** One sighash per input, all spending the same P2WPKH key. */
export function utxoPayloadsHex(tx: UtxoTransaction): string[] {
    return tx.inputs.map((_, index) =>
        utxoInputSighashHex(
            tx,
            index,
            tx.inputValues[index],
            tx.senderPublicKey,
        ),
    );
}

export function utxoPayloadsFromEnvelope(
    unsignedTx: unknown,
): PayloadRecompute {
    const parsed = parseUtxoUnsignedTx(unsignedTx);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason, detail: parsed.detail };
    try {
        return { ok: true, payloadsHex: utxoPayloadsHex(parsed.tx) };
    } catch (error) {
        return {
            ok: false,
            reason: "invalid-field",
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}

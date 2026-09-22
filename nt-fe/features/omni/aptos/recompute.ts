import { sha3_256 } from "@noble/hashes/sha3";
import {
    address32FromJson,
    BcsWriter,
    bytesFromJson,
    bytesToHex,
    u64FromJson,
} from "../bcs";
import type { PayloadRecompute } from "../types";

/**
 * Aptos `RawTransaction` signing message, mirroring
 * omni-transaction-rs `AptosTransaction::build_for_signing`:
 * sha3_256("APTOS::RawTransaction") || bcs(RawTransaction).
 * The MPC signs these bytes directly (ed25519), so the payload is the full
 * message, not a digest.
 */

export const APTOS_RAW_TRANSACTION_SALT_HASH_HEX =
    "b5e97db07fa0bd0e5598aa3643a9bc6f6693bddc1a9fec9e674a461eaa00b193";

export type AptosTypeTag =
    | { kind: "Bool" }
    | { kind: "U8" }
    | { kind: "U64" }
    | { kind: "U128" }
    | { kind: "Address" }
    | { kind: "Signer" }
    | { kind: "U16" }
    | { kind: "U32" }
    | { kind: "U256" }
    | { kind: "Vector"; inner: AptosTypeTag }
    | {
          kind: "Struct";
          address: Uint8Array;
          module: string;
          name: string;
          typeArgs: AptosTypeTag[];
      };

export interface AptosEntryFunction {
    moduleAddress: Uint8Array;
    moduleName: string;
    functionName: string;
    tyArgs: AptosTypeTag[];
    args: Uint8Array[];
}

export interface AptosRawTransaction {
    sender: Uint8Array;
    sequenceNumber: bigint;
    payload: { kind: "EntryFunction"; entry: AptosEntryFunction };
    maxGasAmount: bigint;
    gasUnitPrice: bigint;
    expirationTimestampSecs: bigint;
    chainId: number;
}

export type AptosParseResult =
    | { ok: true; tx: AptosRawTransaction; senderPublicKeyHex: string | null }
    | {
          ok: false;
          reason: "unsupported-shape" | "invalid-field";
          detail: string;
      };

const PRIMITIVE_TAGS: Record<string, AptosTypeTag["kind"]> = {
    Bool: "Bool",
    U8: "U8",
    U64: "U64",
    U128: "U128",
    Address: "Address",
    Signer: "Signer",
    U16: "U16",
    U32: "U32",
    U256: "U256",
};

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function fail(detail: string): {
    ok: false;
    reason: "invalid-field";
    detail: string;
} {
    return { ok: false, reason: "invalid-field", detail };
}

export function parseAptosTypeTag(
    value: unknown,
    where: string,
): AptosTypeTag | { error: string } {
    if (typeof value === "string") {
        const kind = PRIMITIVE_TAGS[value];
        return kind
            ? ({ kind } as AptosTypeTag)
            : { error: `${where}: unknown type tag ${value}` };
    }
    if (typeof value !== "object" || value === null)
        return { error: `${where}: malformed type tag` };
    const record = value as Record<string, unknown>;
    if ("Vector" in record) {
        const inner = parseAptosTypeTag(record.Vector, `${where}.Vector`);
        return "error" in inner ? inner : { kind: "Vector", inner };
    }
    if ("Struct" in record) {
        const s = record.Struct as Record<string, unknown> | undefined;
        if (!s || typeof s !== "object")
            return { error: `${where}: malformed Struct` };
        const address = address32FromJson(s.address);
        if (!address) return { error: `${where}.Struct.address` };
        if (typeof s.module !== "string" || !IDENTIFIER_RE.test(s.module))
            return { error: `${where}.Struct.module` };
        if (typeof s.name !== "string" || !IDENTIFIER_RE.test(s.name))
            return { error: `${where}.Struct.name` };
        const rawTypeArgs = Array.isArray(s.type_args) ? s.type_args : [];
        const typeArgs: AptosTypeTag[] = [];
        for (const [index, raw] of rawTypeArgs.entries()) {
            const parsed = parseAptosTypeTag(
                raw,
                `${where}.Struct.type_args[${index}]`,
            );
            if ("error" in parsed) return parsed;
            typeArgs.push(parsed);
        }
        return {
            kind: "Struct",
            address,
            module: s.module,
            name: s.name,
            typeArgs,
        };
    }
    return { error: `${where}: unknown type tag` };
}

export function formatAptosTypeTag(tag: AptosTypeTag): string {
    switch (tag.kind) {
        case "Vector":
            return `vector<${formatAptosTypeTag(tag.inner)}>`;
        case "Struct": {
            const addr = `0x${bytesToHex(tag.address).replace(/^0+(?=.)/, "")}`;
            const generics = tag.typeArgs.length
                ? `<${tag.typeArgs.map(formatAptosTypeTag).join(", ")}>`
                : "";
            return `${addr}::${tag.module}::${tag.name}${generics}`;
        }
        default:
            return tag.kind.toLowerCase();
    }
}

/**
 * Parse the envelope `unsigned_tx` (`{sender_public_key, tx}`) for aptos.
 * `args` accept 0x hex (omni-cli prettified form) or byte arrays.
 */
export function parseAptosUnsignedTx(unsignedTx: unknown): AptosParseResult {
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
    const tx = outer.tx;
    if (typeof tx !== "object" || tx === null) {
        return {
            ok: false,
            reason: "unsupported-shape",
            detail: "missing field tx",
        };
    }
    const t = tx as Record<string, unknown>;
    for (const key of [
        "sender",
        "sequence_number",
        "payload",
        "max_gas_amount",
        "gas_unit_price",
        "expiration_timestamp_secs",
        "chain_id",
    ]) {
        if (!(key in t)) {
            return {
                ok: false,
                reason: "unsupported-shape",
                detail: `missing field tx.${key}`,
            };
        }
    }
    const sender = address32FromJson(t.sender);
    if (!sender) return fail("tx.sender");
    const sequenceNumber = u64FromJson(t.sequence_number);
    if (sequenceNumber === null) return fail("tx.sequence_number");
    const maxGasAmount = u64FromJson(t.max_gas_amount);
    if (maxGasAmount === null) return fail("tx.max_gas_amount");
    const gasUnitPrice = u64FromJson(t.gas_unit_price);
    if (gasUnitPrice === null) return fail("tx.gas_unit_price");
    const expirationTimestampSecs = u64FromJson(t.expiration_timestamp_secs);
    if (expirationTimestampSecs === null)
        return fail("tx.expiration_timestamp_secs");
    const chainId = t.chain_id;
    if (
        typeof chainId !== "number" ||
        !Number.isInteger(chainId) ||
        chainId < 0 ||
        chainId > 255
    ) {
        return fail("tx.chain_id");
    }

    const payload = t.payload as Record<string, unknown> | null;
    if (typeof payload !== "object" || payload === null)
        return fail("tx.payload");
    if (!("EntryFunction" in payload)) {
        const kind = Object.keys(payload)[0] ?? "unknown";
        return {
            ok: false,
            reason: "unsupported-shape",
            detail: `unsupported payload kind ${kind}`,
        };
    }
    const entry = payload.EntryFunction as Record<string, unknown> | null;
    if (typeof entry !== "object" || entry === null)
        return fail("tx.payload.EntryFunction");
    const module = entry.module as Record<string, unknown> | null;
    if (typeof module !== "object" || module === null)
        return fail("tx.payload.EntryFunction.module");
    const moduleAddress = address32FromJson(module.address);
    if (!moduleAddress) return fail("tx.payload.EntryFunction.module.address");
    if (typeof module.name !== "string" || !IDENTIFIER_RE.test(module.name)) {
        return fail("tx.payload.EntryFunction.module.name");
    }
    if (
        typeof entry.function !== "string" ||
        !IDENTIFIER_RE.test(entry.function)
    ) {
        return fail("tx.payload.EntryFunction.function");
    }
    const tyArgs: AptosTypeTag[] = [];
    const rawTyArgs = entry.ty_args ?? [];
    if (!Array.isArray(rawTyArgs))
        return fail("tx.payload.EntryFunction.ty_args");
    for (const [index, raw] of rawTyArgs.entries()) {
        const parsed = parseAptosTypeTag(raw, `ty_args[${index}]`);
        if ("error" in parsed) return fail(parsed.error);
        tyArgs.push(parsed);
    }
    const rawArgs = entry.args ?? [];
    if (!Array.isArray(rawArgs)) return fail("tx.payload.EntryFunction.args");
    const args: Uint8Array[] = [];
    for (const [index, raw] of rawArgs.entries()) {
        const bytes = bytesFromJson(raw);
        if (!bytes) return fail(`tx.payload.EntryFunction.args[${index}]`);
        args.push(bytes);
    }

    const senderPublicKeyHex =
        typeof outer.sender_public_key === "string"
            ? outer.sender_public_key.replace(/^0x/, "").toLowerCase()
            : null;

    return {
        ok: true,
        senderPublicKeyHex,
        tx: {
            sender,
            sequenceNumber,
            payload: {
                kind: "EntryFunction",
                entry: {
                    moduleAddress,
                    moduleName: module.name,
                    functionName: entry.function,
                    tyArgs,
                    args,
                },
            },
            maxGasAmount,
            gasUnitPrice,
            expirationTimestampSecs,
            chainId,
        },
    };
}

export function encodeAptosTypeTag(tag: AptosTypeTag, w: BcsWriter): void {
    switch (tag.kind) {
        case "Bool":
            w.variant(0);
            return;
        case "U8":
            w.variant(1);
            return;
        case "U64":
            w.variant(2);
            return;
        case "U128":
            w.variant(3);
            return;
        case "Address":
            w.variant(4);
            return;
        case "Signer":
            w.variant(5);
            return;
        case "Vector":
            w.variant(6);
            encodeAptosTypeTag(tag.inner, w);
            return;
        case "Struct":
            w.variant(7);
            w.fixed(tag.address).string(tag.module).string(tag.name);
            w.vec(tag.typeArgs, encodeAptosTypeTag);
            return;
        case "U16":
            w.variant(8);
            return;
        case "U32":
            w.variant(9);
            return;
        case "U256":
            w.variant(10);
            return;
    }
}

/** BCS bytes of the RawTransaction (no salt prefix). */
export function encodeAptosRawTransaction(tx: AptosRawTransaction): Uint8Array {
    const w = new BcsWriter();
    w.fixed(tx.sender).u64(tx.sequenceNumber);
    // TransactionPayload::EntryFunction is variant 2 (1 = deprecated ModuleBundle).
    w.variant(2);
    const entry = tx.payload.entry;
    w.fixed(entry.moduleAddress)
        .string(entry.moduleName)
        .string(entry.functionName);
    w.vec(entry.tyArgs, encodeAptosTypeTag);
    w.vec(entry.args, (arg, writer) => writer.bytes(arg));
    w.u64(tx.maxGasAmount)
        .u64(tx.gasUnitPrice)
        .u64(tx.expirationTimestampSecs)
        .u8(tx.chainId);
    return w.toBytes();
}

/** The ed25519 signing message: salt hash || bcs(RawTransaction), lowercase hex. */
export function aptosSigningPayloadHex(tx: AptosRawTransaction): string {
    const salt = sha3_256(new TextEncoder().encode("APTOS::RawTransaction"));
    return bytesToHex(salt) + bytesToHex(encodeAptosRawTransaction(tx));
}

export function aptosPayloadsFromEnvelope(
    unsignedTx: unknown,
): PayloadRecompute {
    const parsed = parseAptosUnsignedTx(unsignedTx);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason, detail: parsed.detail };
    try {
        return { ok: true, payloadsHex: [aptosSigningPayloadHex(parsed.tx)] };
    } catch (error) {
        return {
            ok: false,
            reason: "invalid-field",
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}

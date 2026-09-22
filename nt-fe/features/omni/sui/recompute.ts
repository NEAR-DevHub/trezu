import { blake2b } from "@noble/hashes/blake2b";
import { base58 } from "@scure/base";
import {
    address32FromJson,
    BcsWriter,
    bytesFromJson,
    bytesToHex,
    u64FromJson,
} from "../bcs";
import type { PayloadRecompute } from "../types";

/**
 * Sui `TransactionData::V1` BCS encoding and the signing digest
 * blake2b-256([0x00,0x00,0x00] || bcs), mirroring omni-transaction-rs
 * `SuiTransaction::build_for_signing`. Intent bytes: scope TransactionData,
 * version V0, app Sui.
 */

export type SuiTypeTag =
    | { kind: "Bool" }
    | { kind: "U8" }
    | { kind: "U64" }
    | { kind: "U128" }
    | { kind: "Address" }
    | { kind: "Signer" }
    | { kind: "U16" }
    | { kind: "U32" }
    | { kind: "U256" }
    | { kind: "Vector"; inner: SuiTypeTag }
    | {
          kind: "Struct";
          address: Uint8Array;
          module: string;
          name: string;
          typeParams: SuiTypeTag[];
      };

export interface SuiObjectRef {
    objectId: Uint8Array;
    version: bigint;
    digest: Uint8Array;
    /** Base58 digest as written in the envelope, for display. */
    digestText: string;
}

export type SuiCallArg =
    | { kind: "Pure"; bytes: Uint8Array }
    | { kind: "ImmOrOwnedObject"; ref: SuiObjectRef }
    | {
          kind: "SharedObject";
          id: Uint8Array;
          initialSharedVersion: bigint;
          mutable: boolean;
      }
    | { kind: "Receiving"; ref: SuiObjectRef };

export type SuiArgument =
    | { kind: "GasCoin" }
    | { kind: "Input"; index: number }
    | { kind: "Result"; index: number }
    | { kind: "NestedResult"; command: number; result: number };

export type SuiCommand =
    | {
          kind: "MoveCall";
          pkg: Uint8Array;
          module: string;
          fn: string;
          typeArguments: SuiTypeTag[];
          arguments: SuiArgument[];
      }
    | { kind: "TransferObjects"; objects: SuiArgument[]; address: SuiArgument }
    | { kind: "SplitCoins"; coin: SuiArgument; amounts: SuiArgument[] }
    | { kind: "MergeCoins"; coin: SuiArgument; coinsToMerge: SuiArgument[] }
    | {
          kind: "MakeMoveVec";
          typeTag: SuiTypeTag | null;
          elements: SuiArgument[];
      };

export interface SuiTransaction {
    inputs: SuiCallArg[];
    commands: SuiCommand[];
    sender: Uint8Array;
    gas: {
        payment: SuiObjectRef[];
        owner: Uint8Array;
        price: bigint;
        budget: bigint;
    };
    expiration: { kind: "None" } | { kind: "Epoch"; epoch: bigint };
}

export type SuiParseResult =
    | { ok: true; tx: SuiTransaction; senderPublicKeyHex: string | null }
    | {
          ok: false;
          reason: "unsupported-shape" | "invalid-field";
          detail: string;
      };

type Fail = {
    ok: false;
    reason: "unsupported-shape" | "invalid-field";
    detail: string;
};

const PRIMITIVE_TAGS: Record<string, SuiTypeTag["kind"]> = {
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

function invalid(detail: string): Fail {
    return { ok: false, reason: "invalid-field", detail };
}
function unsupported(detail: string): Fail {
    return { ok: false, reason: "unsupported-shape", detail };
}

export function parseSuiTypeTag(
    value: unknown,
    where: string,
): SuiTypeTag | Fail {
    if (typeof value === "string") {
        const kind = PRIMITIVE_TAGS[value];
        return kind
            ? ({ kind } as SuiTypeTag)
            : invalid(`${where}: unknown type tag ${value}`);
    }
    if (typeof value !== "object" || value === null)
        return invalid(`${where}: malformed type tag`);
    const record = value as Record<string, unknown>;
    if ("Vector" in record) {
        const inner = parseSuiTypeTag(record.Vector, `${where}.Vector`);
        return "ok" in inner ? inner : { kind: "Vector", inner };
    }
    if ("Struct" in record) {
        const s = record.Struct as Record<string, unknown> | undefined;
        if (!s || typeof s !== "object")
            return invalid(`${where}: malformed Struct`);
        const address = address32FromJson(s.address);
        if (!address) return invalid(`${where}.Struct.address`);
        if (typeof s.module !== "string" || !IDENTIFIER_RE.test(s.module))
            return invalid(`${where}.Struct.module`);
        if (typeof s.name !== "string" || !IDENTIFIER_RE.test(s.name))
            return invalid(`${where}.Struct.name`);
        // omni-transaction-rs names the field `type_params`; accept `type_args` too.
        const rawParams = s.type_params ?? s.type_args ?? [];
        if (!Array.isArray(rawParams))
            return invalid(`${where}.Struct.type_params`);
        const typeParams: SuiTypeTag[] = [];
        for (const [index, raw] of rawParams.entries()) {
            const parsed = parseSuiTypeTag(
                raw,
                `${where}.Struct.type_params[${index}]`,
            );
            if ("ok" in parsed) return parsed;
            typeParams.push(parsed);
        }
        return {
            kind: "Struct",
            address,
            module: s.module,
            name: s.name,
            typeParams,
        };
    }
    return invalid(`${where}: unknown type tag`);
}

export function formatSuiTypeTag(tag: SuiTypeTag): string {
    switch (tag.kind) {
        case "Vector":
            return `vector<${formatSuiTypeTag(tag.inner)}>`;
        case "Struct": {
            const addr = `0x${bytesToHex(tag.address).replace(/^0+(?=.)/, "")}`;
            const generics = tag.typeParams.length
                ? `<${tag.typeParams.map(formatSuiTypeTag).join(", ")}>`
                : "";
            return `${addr}::${tag.module}::${tag.name}${generics}`;
        }
        default:
            return tag.kind.toLowerCase();
    }
}

function parseObjectRef(value: unknown, where: string): SuiObjectRef | Fail {
    if (typeof value !== "object" || value === null) return invalid(where);
    const r = value as Record<string, unknown>;
    const objectId = address32FromJson(r.object_id);
    if (!objectId) return invalid(`${where}.object_id`);
    const version = u64FromJson(r.version);
    if (version === null) return invalid(`${where}.version`);
    if (typeof r.digest !== "string") return invalid(`${where}.digest`);
    let digest: Uint8Array;
    try {
        digest = base58.decode(r.digest);
    } catch {
        return invalid(`${where}.digest`);
    }
    if (digest.length !== 32) return invalid(`${where}.digest`);
    return { objectId, version, digest, digestText: r.digest };
}

function parseArgument(value: unknown, where: string): SuiArgument | Fail {
    if (value === "GasCoin") return { kind: "GasCoin" };
    if (typeof value !== "object" || value === null) return invalid(where);
    const r = value as Record<string, unknown>;
    const u16 = (v: unknown) =>
        typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffff
            ? v
            : null;
    if ("Input" in r) {
        const index = u16(r.Input);
        return index === null
            ? invalid(`${where}.Input`)
            : { kind: "Input", index };
    }
    if ("Result" in r) {
        const index = u16(r.Result);
        return index === null
            ? invalid(`${where}.Result`)
            : { kind: "Result", index };
    }
    if ("NestedResult" in r) {
        const pair = r.NestedResult;
        if (!Array.isArray(pair) || pair.length !== 2)
            return invalid(`${where}.NestedResult`);
        const command = u16(pair[0]);
        const result = u16(pair[1]);
        if (command === null || result === null)
            return invalid(`${where}.NestedResult`);
        return { kind: "NestedResult", command, result };
    }
    return invalid(`${where}: unknown argument`);
}

function parseArguments(value: unknown, where: string): SuiArgument[] | Fail {
    if (!Array.isArray(value)) return invalid(where);
    const out: SuiArgument[] = [];
    for (const [index, raw] of value.entries()) {
        const parsed = parseArgument(raw, `${where}[${index}]`);
        if ("ok" in parsed) return parsed;
        out.push(parsed);
    }
    return out;
}

function parseCallArg(value: unknown, where: string): SuiCallArg | Fail {
    if (typeof value !== "object" || value === null) return invalid(where);
    const r = value as Record<string, unknown>;
    if ("Pure" in r) {
        const bytes = bytesFromJson(r.Pure);
        return bytes ? { kind: "Pure", bytes } : invalid(`${where}.Pure`);
    }
    if ("Object" in r) {
        const o = r.Object as Record<string, unknown> | null;
        if (typeof o !== "object" || o === null)
            return invalid(`${where}.Object`);
        if ("ImmOrOwnedObject" in o) {
            const ref = parseObjectRef(
                o.ImmOrOwnedObject,
                `${where}.Object.ImmOrOwnedObject`,
            );
            return "ok" in ref ? ref : { kind: "ImmOrOwnedObject", ref };
        }
        if ("SharedObject" in o) {
            const s = o.SharedObject as Record<string, unknown> | null;
            if (typeof s !== "object" || s === null)
                return invalid(`${where}.Object.SharedObject`);
            const id = address32FromJson(s.id);
            const initialSharedVersion = u64FromJson(s.initial_shared_version);
            if (
                !id ||
                initialSharedVersion === null ||
                typeof s.mutable !== "boolean"
            ) {
                return invalid(`${where}.Object.SharedObject`);
            }
            return {
                kind: "SharedObject",
                id,
                initialSharedVersion,
                mutable: s.mutable,
            };
        }
        if ("Receiving" in o) {
            const ref = parseObjectRef(
                o.Receiving,
                `${where}.Object.Receiving`,
            );
            return "ok" in ref ? ref : { kind: "Receiving", ref };
        }
        return invalid(`${where}.Object: unknown object arg`);
    }
    return invalid(`${where}: unknown call arg`);
}

function parseCommand(value: unknown, where: string): SuiCommand | Fail {
    if (typeof value !== "object" || value === null) return invalid(where);
    const r = value as Record<string, unknown>;
    const key = Object.keys(r)[0];
    const body = key ? (r[key] as Record<string, unknown>) : null;
    if (!key || typeof body !== "object" || body === null)
        return invalid(where);
    switch (key) {
        case "MoveCall": {
            const pkg = address32FromJson(body.package);
            if (!pkg) return invalid(`${where}.MoveCall.package`);
            if (
                typeof body.module !== "string" ||
                !IDENTIFIER_RE.test(body.module)
            )
                return invalid(`${where}.MoveCall.module`);
            if (
                typeof body.function !== "string" ||
                !IDENTIFIER_RE.test(body.function)
            )
                return invalid(`${where}.MoveCall.function`);
            const rawTypes = body.type_arguments ?? [];
            if (!Array.isArray(rawTypes))
                return invalid(`${where}.MoveCall.type_arguments`);
            const typeArguments: SuiTypeTag[] = [];
            for (const [index, raw] of rawTypes.entries()) {
                const parsed = parseSuiTypeTag(
                    raw,
                    `${where}.MoveCall.type_arguments[${index}]`,
                );
                if ("ok" in parsed) return parsed;
                typeArguments.push(parsed);
            }
            const args = parseArguments(
                body.arguments ?? [],
                `${where}.MoveCall.arguments`,
            );
            if ("ok" in args) return args;
            return {
                kind: "MoveCall",
                pkg,
                module: body.module,
                fn: body.function,
                typeArguments,
                arguments: args,
            };
        }
        case "TransferObjects": {
            const objects = parseArguments(
                body.objects,
                `${where}.TransferObjects.objects`,
            );
            if ("ok" in objects) return objects;
            const address = parseArgument(
                body.address,
                `${where}.TransferObjects.address`,
            );
            if ("ok" in address) return address;
            return { kind: "TransferObjects", objects, address };
        }
        case "SplitCoins": {
            const coin = parseArgument(body.coin, `${where}.SplitCoins.coin`);
            if ("ok" in coin) return coin;
            const amounts = parseArguments(
                body.amounts,
                `${where}.SplitCoins.amounts`,
            );
            if ("ok" in amounts) return amounts;
            return { kind: "SplitCoins", coin, amounts };
        }
        case "MergeCoins": {
            const coin = parseArgument(body.coin, `${where}.MergeCoins.coin`);
            if ("ok" in coin) return coin;
            const coinsToMerge = parseArguments(
                body.coins_to_merge,
                `${where}.MergeCoins.coins_to_merge`,
            );
            if ("ok" in coinsToMerge) return coinsToMerge;
            return { kind: "MergeCoins", coin, coinsToMerge };
        }
        case "MakeMoveVec": {
            let typeTag: SuiTypeTag | null = null;
            if (body.type_tag !== null && body.type_tag !== undefined) {
                const parsed = parseSuiTypeTag(
                    body.type_tag,
                    `${where}.MakeMoveVec.type_tag`,
                );
                if ("ok" in parsed) return parsed;
                typeTag = parsed;
            }
            const elements = parseArguments(
                body.elements ?? [],
                `${where}.MakeMoveVec.elements`,
            );
            if ("ok" in elements) return elements;
            return { kind: "MakeMoveVec", typeTag, elements };
        }
        case "Publish":
        case "Upgrade":
            return unsupported(`unsupported command kind ${key}`);
        default:
            return invalid(`${where}: unknown command ${key}`);
    }
}

/** Parse the envelope `unsigned_tx` (`{sender_public_key, tx}`) for sui. */
export function parseSuiUnsignedTx(unsignedTx: unknown): SuiParseResult {
    if (
        typeof unsignedTx !== "object" ||
        unsignedTx === null ||
        Array.isArray(unsignedTx)
    ) {
        return unsupported("unsigned_tx is not an object");
    }
    const outer = unsignedTx as Record<string, unknown>;
    const tx = outer.tx as Record<string, unknown> | null;
    if (typeof tx !== "object" || tx === null)
        return unsupported("missing field tx");
    for (const key of ["kind", "sender", "gas_data", "expiration"]) {
        if (!(key in tx)) return unsupported(`missing field tx.${key}`);
    }
    const kind = tx.kind as Record<string, unknown> | null;
    if (typeof kind !== "object" || kind === null) return invalid("tx.kind");
    if (!("ProgrammableTransaction" in kind)) {
        return unsupported(
            `unsupported transaction kind ${Object.keys(kind)[0] ?? "unknown"}`,
        );
    }
    const pt = kind.ProgrammableTransaction as Record<string, unknown> | null;
    if (typeof pt !== "object" || pt === null)
        return invalid("tx.kind.ProgrammableTransaction");
    if (!Array.isArray(pt.inputs) || !Array.isArray(pt.commands))
        return invalid("tx.kind.ProgrammableTransaction");
    const inputs: SuiCallArg[] = [];
    for (const [index, raw] of pt.inputs.entries()) {
        const parsed = parseCallArg(raw, `inputs[${index}]`);
        if ("ok" in parsed) return parsed;
        inputs.push(parsed);
    }
    const commands: SuiCommand[] = [];
    for (const [index, raw] of pt.commands.entries()) {
        const parsed = parseCommand(raw, `commands[${index}]`);
        if ("ok" in parsed) return parsed;
        commands.push(parsed);
    }
    const sender = address32FromJson(tx.sender);
    if (!sender) return invalid("tx.sender");
    const gasData = tx.gas_data as Record<string, unknown> | null;
    if (typeof gasData !== "object" || gasData === null)
        return invalid("tx.gas_data");
    if (!Array.isArray(gasData.payment)) return invalid("tx.gas_data.payment");
    const payment: SuiObjectRef[] = [];
    for (const [index, raw] of gasData.payment.entries()) {
        const parsed = parseObjectRef(raw, `tx.gas_data.payment[${index}]`);
        if ("ok" in parsed) return parsed;
        payment.push(parsed);
    }
    const owner = address32FromJson(gasData.owner);
    if (!owner) return invalid("tx.gas_data.owner");
    const price = u64FromJson(gasData.price);
    if (price === null) return invalid("tx.gas_data.price");
    const budget = u64FromJson(gasData.budget);
    if (budget === null) return invalid("tx.gas_data.budget");
    let expiration: SuiTransaction["expiration"];
    if (tx.expiration === "None") {
        expiration = { kind: "None" };
    } else if (
        typeof tx.expiration === "object" &&
        tx.expiration !== null &&
        "Epoch" in tx.expiration
    ) {
        const epoch = u64FromJson(
            (tx.expiration as Record<string, unknown>).Epoch,
        );
        if (epoch === null) return invalid("tx.expiration.Epoch");
        expiration = { kind: "Epoch", epoch };
    } else {
        return invalid("tx.expiration");
    }
    const senderPublicKeyHex =
        typeof outer.sender_public_key === "string"
            ? outer.sender_public_key.replace(/^0x/, "").toLowerCase()
            : null;
    return {
        ok: true,
        senderPublicKeyHex,
        tx: {
            inputs,
            commands,
            sender,
            gas: { payment, owner, price, budget },
            expiration,
        },
    };
}

// ------------------------------------------------------------------- BCS

export function encodeSuiTypeTag(tag: SuiTypeTag, w: BcsWriter): void {
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
            encodeSuiTypeTag(tag.inner, w);
            return;
        case "Struct":
            w.variant(7);
            w.fixed(tag.address).string(tag.module).string(tag.name);
            w.vec(tag.typeParams, encodeSuiTypeTag);
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

function encodeObjectRef(ref: SuiObjectRef, w: BcsWriter): void {
    // Digest is BCS `bytes` (ULEB 0x20 + 32 bytes), not a fixed array.
    w.fixed(ref.objectId).u64(ref.version).bytes(ref.digest);
}

function encodeArgument(arg: SuiArgument, w: BcsWriter): void {
    switch (arg.kind) {
        case "GasCoin":
            w.variant(0);
            return;
        case "Input":
            w.variant(1).u16(arg.index);
            return;
        case "Result":
            w.variant(2).u16(arg.index);
            return;
        case "NestedResult":
            w.variant(3).u16(arg.command).u16(arg.result);
            return;
    }
}

function encodeCallArg(arg: SuiCallArg, w: BcsWriter): void {
    switch (arg.kind) {
        case "Pure":
            w.variant(0).bytes(arg.bytes);
            return;
        case "ImmOrOwnedObject":
            w.variant(1).variant(0);
            encodeObjectRef(arg.ref, w);
            return;
        case "SharedObject":
            w.variant(1)
                .variant(1)
                .fixed(arg.id)
                .u64(arg.initialSharedVersion)
                .bool(arg.mutable);
            return;
        case "Receiving":
            w.variant(1).variant(2);
            encodeObjectRef(arg.ref, w);
            return;
    }
}

function encodeCommand(command: SuiCommand, w: BcsWriter): void {
    switch (command.kind) {
        case "MoveCall":
            w.variant(0)
                .fixed(command.pkg)
                .string(command.module)
                .string(command.fn);
            w.vec(command.typeArguments, encodeSuiTypeTag);
            w.vec(command.arguments, encodeArgument);
            return;
        case "TransferObjects":
            w.variant(1).vec(command.objects, encodeArgument);
            encodeArgument(command.address, w);
            return;
        case "SplitCoins":
            w.variant(2);
            encodeArgument(command.coin, w);
            w.vec(command.amounts, encodeArgument);
            return;
        case "MergeCoins":
            w.variant(3);
            encodeArgument(command.coin, w);
            w.vec(command.coinsToMerge, encodeArgument);
            return;
        case "MakeMoveVec":
            w.variant(5).option(command.typeTag, encodeSuiTypeTag);
            w.vec(command.elements, encodeArgument);
            return;
    }
}

/** bcs(TransactionData::V1 { kind, sender, gas_data, expiration }). */
export function encodeSuiTransaction(tx: SuiTransaction): Uint8Array {
    const w = new BcsWriter();
    w.variant(0); // TransactionData::V1
    w.variant(0); // TransactionKind::ProgrammableTransaction
    w.vec(tx.inputs, encodeCallArg);
    w.vec(tx.commands, encodeCommand);
    w.fixed(tx.sender);
    w.vec(tx.gas.payment, encodeObjectRef)
        .fixed(tx.gas.owner)
        .u64(tx.gas.price)
        .u64(tx.gas.budget);
    if (tx.expiration.kind === "None") w.variant(0);
    else w.variant(1).u64(tx.expiration.epoch);
    return w.toBytes();
}

const TRANSACTION_INTENT = Uint8Array.from([0x00, 0x00, 0x00]);

/** blake2b-256(intent || bcs), lowercase hex. */
export function suiSigningDigestHex(tx: SuiTransaction): string {
    const bcs = encodeSuiTransaction(tx);
    const message = new Uint8Array(3 + bcs.length);
    message.set(TRANSACTION_INTENT, 0);
    message.set(bcs, 3);
    return bytesToHex(blake2b(message, { dkLen: 32 }));
}

export function suiPayloadsFromEnvelope(unsignedTx: unknown): PayloadRecompute {
    const parsed = parseSuiUnsignedTx(unsignedTx);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason, detail: parsed.detail };
    try {
        return { ok: true, payloadsHex: [suiSigningDigestHex(parsed.tx)] };
    } catch (error) {
        return {
            ok: false,
            reason: "invalid-field",
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}

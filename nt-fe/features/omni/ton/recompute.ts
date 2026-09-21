import { bytesFromJson, bytesToHex, hexToBytes } from "../bcs";
import type { NearNetwork, PayloadRecompute } from "../types";
import { Cell, CellBuilder, cellFromBocString, TonAddress } from "./cell";

/**
 * TON wallet transaction signing payload: the representation hash of the
 * unsigned wallet body cell (v4r2 or v5r1). Mirrors omni-transaction-rs
 * `TonTransaction::build_for_signing`.
 */

export const V5R1_SIGNED_EXTERNAL_OPCODE = 0x7369_676e; // "sign"
export const ACTION_SEND_MSG_OPCODE = 0x0ec3_c86d;
export const SEND_MODE_IGNORE_ERRORS = 2;
export const DEFAULT_SEND_MODE = 3;
export const DEFAULT_V4R2_WALLET_ID = 698_983_191;
export const MAINNET_GLOBAL_ID = -239;
export const TESTNET_GLOBAL_ID = -3;
export const V4R2_MAX_MESSAGES = 4;
export const V5R1_MAX_MESSAGES = 255;

export type TonWalletVersion = "V4R2" | "V5R1";

export interface TonInternalMessage {
    dest: TonAddress;
    /** Original dest string from the envelope, for display. */
    destText: string;
    valueNanotons: bigint;
    bounce: boolean;
    mode: number;
    body: Cell | null;
    /** Original body string (base64/hex BoC) when present. */
    bodyText: string | null;
}

export interface TonTransaction {
    walletVersion: TonWalletVersion;
    workchain: number;
    publicKey: Uint8Array;
    walletId: number;
    validUntil: number;
    seqno: number;
    messages: TonInternalMessage[];
    deploy: boolean;
}

export type TonParseResult =
    | { ok: true; tx: TonTransaction }
    | {
          ok: false;
          reason: "unsupported-shape" | "invalid-field";
          detail: string;
      };

/** v5r1 wallet id: network global id XOR packed context (1, workchain i8, version 0, subwallet u15). */
export function v5r1WalletId(
    networkGlobalId: number,
    workchain: number,
    subwallet = 0,
): number {
    const context =
        ((1 << 31) | ((workchain & 0xff) << 23) | (subwallet & 0x7fff)) >>> 0;
    return ((networkGlobalId >>> 0) ^ context) >>> 0;
}

export function globalIdForNetwork(network: NearNetwork): number {
    return network === "mainnet" ? MAINNET_GLOBAL_ID : TESTNET_GLOBAL_ID;
}

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

function readCoins(value: unknown): bigint | null {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
        return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value)) {
        const v = BigInt(value);
        return v < 1n << 120n ? v : null;
    }
    return null;
}

/** Parse the envelope `unsigned_tx` for the ton family. */
export function parseTonUnsignedTx(unsignedTx: unknown): TonParseResult {
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
    const t = unsignedTx as Record<string, unknown>;
    for (const key of [
        "public_key",
        "wallet_id",
        "valid_until",
        "seqno",
        "messages",
    ]) {
        if (!(key in t))
            return {
                ok: false,
                reason: "unsupported-shape",
                detail: `missing field ${key}`,
            };
    }
    const versionRaw = t.wallet_version ?? "V5R1";
    if (versionRaw !== "V4R2" && versionRaw !== "V5R1")
        return fail("wallet_version");
    const walletVersion = versionRaw as TonWalletVersion;
    const workchainRaw = t.workchain ?? 0;
    if (
        typeof workchainRaw !== "number" ||
        !Number.isInteger(workchainRaw) ||
        workchainRaw < -128 ||
        workchainRaw > 127
    ) {
        return fail("workchain");
    }
    const publicKey = bytesFromJson(t.public_key);
    if (!publicKey || publicKey.length !== 32) return fail("public_key");
    const walletId = readU32(t.wallet_id);
    if (walletId === null) return fail("wallet_id");
    const validUntil = readU32(t.valid_until);
    if (validUntil === null) return fail("valid_until");
    const seqno = readU32(t.seqno);
    if (seqno === null) return fail("seqno");
    if (!Array.isArray(t.messages)) return fail("messages");
    const maxMessages =
        walletVersion === "V4R2" ? V4R2_MAX_MESSAGES : V5R1_MAX_MESSAGES;
    if (t.messages.length === 0 || t.messages.length > maxMessages)
        return fail("messages.length");
    const messages: TonInternalMessage[] = [];
    for (const [index, raw] of t.messages.entries()) {
        if (typeof raw !== "object" || raw === null)
            return fail(`messages[${index}]`);
        const m = raw as Record<string, unknown>;
        if (typeof m.dest !== "string") return fail(`messages[${index}].dest`);
        const dest = TonAddress.parse(m.dest);
        if (!dest) return fail(`messages[${index}].dest`);
        const valueNanotons = readCoins(m.value);
        if (valueNanotons === null) return fail(`messages[${index}].value`);
        const bounce = m.bounce ?? true;
        if (typeof bounce !== "boolean")
            return fail(`messages[${index}].bounce`);
        const mode = m.mode ?? DEFAULT_SEND_MODE;
        if (
            typeof mode !== "number" ||
            !Number.isInteger(mode) ||
            mode < 0 ||
            mode > 255
        ) {
            return fail(`messages[${index}].mode`);
        }
        let body: Cell | null = null;
        let bodyText: string | null = null;
        if (m.body !== undefined && m.body !== null) {
            if (typeof m.body !== "string")
                return fail(`messages[${index}].body`);
            body = cellFromBocString(m.body);
            if (!body) return fail(`messages[${index}].body`);
            bodyText = m.body;
        }
        messages.push({
            dest,
            destText: m.dest,
            valueNanotons,
            bounce,
            mode,
            body,
            bodyText,
        });
    }
    const deploy = t.deploy ?? false;
    if (typeof deploy !== "boolean") return fail("deploy");
    return {
        ok: true,
        tx: {
            walletVersion,
            workchain: workchainRaw,
            publicKey,
            walletId,
            validUntil,
            seqno,
            messages,
            deploy,
        },
    };
}

/** `int_msg_info$0` internal message cell. */
export function messageCell(message: TonInternalMessage): Cell {
    const b = new CellBuilder()
        .storeBit(false) // int_msg_info$0
        .storeBit(true) // ihr_disabled
        .storeBit(message.bounce)
        .storeBit(false) // bounced
        .storeUint(0, 2) // src: addr_none$00
        .storeAddress(message.dest)
        .storeCoins(message.valueNanotons)
        .storeBit(false) // no extra currencies
        .storeUint(0, 4) // ihr_fee
        .storeUint(0, 4) // fwd_fee
        .storeU64(0) // created_lt
        .storeU32(0) // created_at
        .storeBit(false); // init: nothing
    if (!message.body) {
        b.storeBit(false);
    } else if (
        b.remainingBits > message.body.bitLen &&
        b.refsCount + message.body.refs.length <= 4
    ) {
        b.storeBit(false).storeCell(message.body);
    } else {
        b.storeBit(true).storeRef(message.body);
    }
    return b.build();
}

function outList(messages: TonInternalMessage[]): Cell {
    let list = Cell.empty();
    for (const message of messages) {
        list = new CellBuilder()
            .storeRef(list)
            .storeU32(ACTION_SEND_MSG_OPCODE)
            .storeU8(message.mode | SEND_MODE_IGNORE_ERRORS)
            .storeRef(messageCell(message))
            .build();
    }
    return list;
}

/** The unsigned wallet body cell whose representation hash is signed. */
export function unsignedBodyCell(tx: TonTransaction): Cell {
    if (tx.walletVersion === "V4R2") {
        const b = new CellBuilder()
            .storeU32(tx.walletId)
            .storeU32(tx.validUntil)
            .storeU32(tx.seqno)
            .storeU8(0);
        for (const message of tx.messages)
            b.storeU8(message.mode).storeRef(messageCell(message));
        return b.build();
    }
    return new CellBuilder()
        .storeU32(V5R1_SIGNED_EXTERNAL_OPCODE)
        .storeU32(tx.walletId)
        .storeU32(tx.validUntil)
        .storeU32(tx.seqno)
        .storeBit(true)
        .storeRef(outList(tx.messages))
        .storeBit(false)
        .build();
}

export function tonSigningPayloadHex(tx: TonTransaction): string {
    return unsignedBodyCell(tx).hashHex();
}

export function tonPayloadsFromEnvelope(unsignedTx: unknown): PayloadRecompute {
    const parsed = parseTonUnsignedTx(unsignedTx);
    if (!parsed.ok)
        return { ok: false, reason: parsed.reason, detail: parsed.detail };
    try {
        return { ok: true, payloadsHex: [tonSigningPayloadHex(parsed.tx)] };
    } catch (error) {
        return {
            ok: false,
            reason: "invalid-field",
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}

// ------------------------------------------------------- wallet addresses

/** Official wallet code BoCs (tonlib-core resources), pinned by hash below. */
const WALLET_V4R2_CODE_BOC =
    "b5ee9c72410214010002d4000114ff00f4a413f4bcf2c80b010201200203020148040504f8f28308d71820d31fd31fd31f02f823bbf264ed44d0d31fd31fd3fff404d15143baf2a15151baf2a205f901541064f910f2a3f80024a4c8cb1f5240cb1f5230cbff5210f400c9ed54f80f01d30721c0009f6c519320d74a96d307d402fb00e830e021c001e30021c002e30001c0039130e30d03a4c8cb1f12cb1fcbff1011121302e6d001d0d3032171b0925f04e022d749c120925f04e002d31f218210706c7567bd22821064737472bdb0925f05e003fa403020fa4401c8ca07cbffc9d0ed44d0810140d721f404305c810108f40a6fa131b3925f07e005d33fc8258210706c7567ba923830e30d03821064737472ba925f06e30d06070201200809007801fa00f40430f8276f2230500aa121bef2e0508210706c7567831eb17080185004cb0526cf1658fa0219f400cb6917cb1f5260cb3f20c98040fb0006008a5004810108f45930ed44d0810140d720c801cf16f400c9ed540172b08e23821064737472831eb17080185005cb055003cf1623fa0213cb6acb1fcb3fc98040fb00925f03e20201200a0b0059bd242b6f6a2684080a06b90fa0218470d4080847a4937d29910ce6903e9ff9837812801b7810148987159f31840201580c0d0011b8c97ed44d0d70b1f8003db29dfb513420405035c87d010c00b23281f2fff274006040423d029be84c600201200e0f0019adce76a26840206b90eb85ffc00019af1df6a26840106b90eb858fc0006ed207fa00d4d422f90005c8ca0715cbffc9d077748018c8cb05cb0222cf165005fa0214cb6b12ccccc973fb00c84014810108f451f2a7020070810108d718fa00d33fc8542047810108f451f2a782106e6f746570748018c8cb05cb025006cf165004fa0214cb6a12cb1fcb3fc973fb0002006c810108d718fa00d33f305224810108f459f2a782106473747270748018c8cb05cb025005cf165003fa0213cb6acb1f12cb3fc973fb00000af400c9ed54696225e5";
const WALLET_V5R1_CODE_BOC =
    "b5ee9c7201021401000281000114ff00f4a413f4bcf2c80b01020120020302014804050102f20e02dcd020d749c120915b8f6320d70b1f2082106578746ebd21821073696e74bdb0925f03e082106578746eba8eb48020d72101d074d721fa4030fa44f828fa443058bd915be0ed44d0810141d721f4058307f40e6fa1319130e18040d721707fdb3ce03120d749810280b99130e070e2100f020120060702012008090019be5f0f6a2684080a0eb90fa02c02016e0a0b0201480c0d0019adce76a2684020eb90eb85ffc00019af1df6a2684010eb90eb858fc00017b325fb51341c75c875c2c7e00011b262fb513435c28020011e20d70b1f82107369676ebaf2e08a7f0f01e68ef0eda2edfb218308d722028308d723208020d721d31fd31fd31fed44d0d200d31f20d31fd3ffd70a000af90140ccf9109a28945f0adb31e1f2c087df02b35007b0f2d0845125baf2e0855036baf2e086f823bbf2d0882292f800de01a47fc8ca00cb1f01cf16c9ed542092f80fde70db3cd81003f6eda2edfb02f404216e926c218e4c0221d73930709421c700b38e2d01d72820761e436c20d749c008f2e09320d74ac002f2e09320d71d06c712c2005230b0f2d089d74cd7393001a4e86c128407bbf2e093d74ac000f2e093ed55e2d20001c000915be0ebd72c08142091709601d72c081c12e25210b1e30f20d74a111213009601fa4001fa44f828fa443058baf2e091ed44d0810141d718f405049d7fc8ca0040048307f453f2e08b8e14038307f45bf2e08c22d70a00216e01b3b0f2d090e2c85003cf1612f400c9ed54007230d72c08248e2d21f2e092d200ed44d0d2005113baf2d08f54503091319c01810140d721d70a00f2e08ee2c8ca0058cf16c9ed5493f2c08de20010935bdb31e1d74cd0";

export const WALLET_CODE_HASH_HEX: Record<TonWalletVersion, string> = {
    V4R2: "feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0",
    V5R1: "20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f",
};

const codeCellCache = new Map<TonWalletVersion, Cell>();

export function walletCodeCell(version: TonWalletVersion): Cell {
    const cached = codeCellCache.get(version);
    if (cached) return cached;
    const boc =
        version === "V4R2" ? WALLET_V4R2_CODE_BOC : WALLET_V5R1_CODE_BOC;
    const cell = cellFromBocString(boc);
    if (!cell || cell.hashHex() !== WALLET_CODE_HASH_HEX[version]) {
        throw new Error(
            `embedded ${version} wallet code does not match its pinned hash`,
        );
    }
    codeCellCache.set(version, cell);
    return cell;
}

export function initialDataCell(
    version: TonWalletVersion,
    walletId: number,
    publicKey: Uint8Array,
): Cell {
    const b = new CellBuilder();
    if (version === "V5R1") b.storeBit(true);
    b.storeU32(0).storeU32(walletId).storeSlice(publicKey).storeBit(false);
    return b.build();
}

export function stateInitCell(
    version: TonWalletVersion,
    walletId: number,
    publicKey: Uint8Array,
): Cell {
    return new CellBuilder()
        .storeUint(0b00110, 5)
        .storeRef(walletCodeCell(version))
        .storeRef(initialDataCell(version, walletId, publicKey))
        .build();
}

export function deriveWalletAddress(
    version: TonWalletVersion,
    workchain: number,
    walletId: number,
    publicKey: Uint8Array,
): TonAddress {
    return new TonAddress(
        workchain,
        stateInitCell(version, walletId, publicKey).hash,
    );
}

/**
 * Wallet address for a derived ed25519 key using the envelope's wallet
 * parameters (version, workchain, wallet id). Null when the envelope does
 * not parse.
 */
export function walletAddressForKey(
    unsignedTx: unknown,
    publicKeyHex: string,
): TonAddress | null {
    const parsed = parseTonUnsignedTx(unsignedTx);
    const key = hexToBytes(publicKeyHex);
    if (!parsed.ok || !key || key.length !== 32) return null;
    try {
        return deriveWalletAddress(
            parsed.tx.walletVersion,
            parsed.tx.workchain,
            parsed.tx.walletId,
            key,
        );
    } catch {
        return null;
    }
}

/**
 * Network consistency of a v5r1 wallet id: "pass" when it equals this
 * network's default id (subwallet 0), "fail" when it equals the other
 * network's default, "skip" for custom ids and for v4r2 (no network bit).
 */
export function walletIdNetworkCheck(
    tx: TonTransaction,
    network: NearNetwork,
): { state: "pass" | "fail" | "skip"; expected: number } {
    if (tx.walletVersion !== "V5R1")
        return { state: "skip", expected: tx.walletId };
    const expected = v5r1WalletId(globalIdForNetwork(network), tx.workchain, 0);
    if (tx.walletId === expected) return { state: "pass", expected };
    const other = v5r1WalletId(
        globalIdForNetwork(network === "mainnet" ? "testnet" : "mainnet"),
        tx.workchain,
        0,
    );
    if (tx.walletId === other) return { state: "fail", expected };
    return { state: "skip", expected };
}

export { bytesToHex };

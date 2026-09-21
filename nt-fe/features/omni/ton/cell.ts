import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "../bcs";

/**
 * Minimal TON cell model: ordinary level-0 cells, the CellBuilder, the
 * standard representation hash (TVM whitepaper 3.1.4-3.1.5) and a Bag of
 * Cells parser for message bodies and the embedded wallet code. Mirrors
 * omni-transaction-rs src/ton/types/{cell,boc,address}.rs.
 */

export const MAX_CELL_BITS = 1023;
export const MAX_CELL_REFS = 4;

export class CellError extends Error {}

export class Cell {
    /** Padded data: ceil(bitLen/8) bytes, completion tag applied. */
    readonly data: Uint8Array;
    readonly bitLen: number;
    readonly refs: readonly Cell[];
    readonly hash: Uint8Array;
    readonly depth: number;

    constructor(data: Uint8Array, bitLen: number, refs: readonly Cell[]) {
        if (bitLen > MAX_CELL_BITS || data.length !== Math.ceil(bitLen / 8)) {
            throw new CellError("cell overflow");
        }
        if (refs.length > MAX_CELL_REFS) throw new CellError("too many refs");
        this.data = data;
        this.bitLen = bitLen;
        this.refs = refs;
        this.depth =
            refs.length === 0 ? 0 : 1 + Math.max(...refs.map((r) => r.depth));
        if (this.depth > MAX_CELL_BITS) throw new CellError("depth overflow");
        const d1 = refs.length;
        const d2 = Math.ceil(bitLen / 8) + Math.floor(bitLen / 8);
        const parts: number[] = [d1, d2, ...data];
        for (const r of refs) parts.push((r.depth >> 8) & 0xff, r.depth & 0xff);
        for (const r of refs) parts.push(...r.hash);
        this.hash = sha256(Uint8Array.from(parts));
    }

    static empty(): Cell {
        return new Cell(new Uint8Array(0), 0, []);
    }

    hashHex(): string {
        return bytesToHex(this.hash);
    }

    /** Read `bits` bits starting at `offset` as a BigInt (MSB first). */
    readUint(offset: number, bits: number): bigint {
        let value = 0n;
        for (let i = 0; i < bits; i++) {
            const index = offset + i;
            const bit = (this.data[index >> 3] >> (7 - (index & 7))) & 1;
            value = (value << 1n) | BigInt(bit);
        }
        return value;
    }
}

export class CellBuilder {
    private data: number[] = [];
    private bitLen = 0;
    private refs: Cell[] = [];

    get remainingBits(): number {
        return MAX_CELL_BITS - this.bitLen;
    }

    get refsCount(): number {
        return this.refs.length;
    }

    private pushBit(bit: boolean): void {
        if (this.bitLen % 8 === 0) this.data.push(0);
        if (bit) this.data[this.bitLen >> 3] |= 1 << (7 - (this.bitLen & 7));
        this.bitLen += 1;
    }

    storeBit(bit: boolean): this {
        if (this.bitLen >= MAX_CELL_BITS) throw new CellError("cell overflow");
        this.pushBit(bit);
        return this;
    }

    storeUint(value: bigint | number, bits: number): this {
        const v = BigInt(value);
        if (v < 0n || (bits < 256 && v >= 1n << BigInt(bits))) {
            throw new CellError("value out of range");
        }
        if (this.bitLen + bits > MAX_CELL_BITS)
            throw new CellError("cell overflow");
        for (let i = bits - 1; i >= 0; i--)
            this.pushBit(((v >> BigInt(i)) & 1n) === 1n);
        return this;
    }

    storeInt8(value: number): this {
        return this.storeUint(value & 0xff, 8);
    }

    storeU8(value: number): this {
        return this.storeUint(value, 8);
    }

    storeU32(value: number | bigint): this {
        return this.storeUint(value, 32);
    }

    storeU64(value: number | bigint): this {
        return this.storeUint(value, 64);
    }

    storeSlice(bytes: Uint8Array): this {
        return this.storeBits(bytes, bytes.length * 8);
    }

    /** Store the first `bits` bits of `bytes` (MSB first). */
    storeBits(bytes: Uint8Array, bits: number): this {
        if (this.bitLen + bits > MAX_CELL_BITS)
            throw new CellError("cell overflow");
        for (let i = 0; i < bits; i++) {
            this.pushBit(((bytes[i >> 3] >> (7 - (i & 7))) & 1) === 1);
        }
        return this;
    }

    storeRef(cell: Cell): this {
        if (this.refs.length >= MAX_CELL_REFS)
            throw new CellError("too many refs");
        this.refs.push(cell);
        return this;
    }

    /** `Grams`: 4-bit byte length then the big-endian value. */
    storeCoins(nanotons: bigint): this {
        if (nanotons < 0n) throw new CellError("negative coins");
        let byteLen = 0;
        let v = nanotons;
        while (v > 0n) {
            byteLen += 1;
            v >>= 8n;
        }
        if (byteLen > 15) throw new CellError("coins out of range");
        return this.storeUint(byteLen, 4).storeUint(nanotons, byteLen * 8);
    }

    /** `addr_std$10`: tag 10, no anycast, int8 workchain, 256-bit hash. */
    storeAddress(address: TonAddress): this {
        return this.storeUint(0b10, 2)
            .storeBit(false)
            .storeInt8(address.workchain)
            .storeSlice(address.hash);
    }

    /** Inline all bits and refs of `cell`. */
    storeCell(cell: Cell): this {
        if (this.refs.length + cell.refs.length > MAX_CELL_REFS)
            throw new CellError("too many refs");
        this.storeBits(cell.data, cell.bitLen);
        this.refs.push(...cell.refs);
        return this;
    }

    build(): Cell {
        const data = Uint8Array.from(this.data);
        if (this.bitLen % 8 !== 0)
            data[this.bitLen >> 3] |= 1 << (7 - (this.bitLen & 7));
        return new Cell(data, this.bitLen, this.refs);
    }
}

// ----------------------------------------------------------------- address

export function crc16Xmodem(data: Uint8Array): number {
    let crc = 0;
    for (const byte of data) {
        crc ^= byte << 8;
        for (let i = 0; i < 8; i++) {
            crc =
                (crc & 0x8000) === 0
                    ? (crc << 1) & 0xffff
                    : ((crc << 1) ^ 0x1021) & 0xffff;
        }
    }
    return crc;
}

function base64ToBytes(text: string): Uint8Array | null {
    const standard = text.replace(/-/g, "+").replace(/_/g, "/");
    const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
    try {
        const latin1 = atob(padded);
        return Uint8Array.from(latin1, (c) => c.charCodeAt(0));
    } catch {
        return null;
    }
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

const TAG_BOUNCEABLE = 0x11;
const TAG_NON_BOUNCEABLE = 0x51;
const FLAG_TESTNET = 0x80;

export class TonAddress {
    constructor(
        readonly workchain: number,
        readonly hash: Uint8Array,
    ) {
        if (hash.length !== 32)
            throw new CellError("address hash must be 32 bytes");
    }

    /** Raw "wc:hex" or user-friendly base64 (either alphabet, any flags). */
    static parse(text: string): TonAddress | null {
        const trimmed = text.trim();
        if (trimmed.includes(":")) {
            const [wc, hex] = trimmed.split(":");
            const workchain = Number(wc);
            const hash = hex && hex.length === 64 ? hexToBytes(hex) : null;
            if (
                !Number.isInteger(workchain) ||
                workchain < -128 ||
                workchain > 127 ||
                !hash
            )
                return null;
            return new TonAddress(workchain, hash);
        }
        const bytes = base64ToBytes(trimmed);
        if (!bytes || bytes.length !== 36) return null;
        const tag = bytes[0] & ~FLAG_TESTNET;
        if (tag !== TAG_BOUNCEABLE && tag !== TAG_NON_BOUNCEABLE) return null;
        const expected = (bytes[34] << 8) | bytes[35];
        if (crc16Xmodem(bytes.slice(0, 34)) !== expected) return null;
        const workchain = (bytes[1] << 24) >> 24; // sign-extend i8
        return new TonAddress(workchain, bytes.slice(2, 34));
    }

    toRaw(): string {
        return `${this.workchain}:${bytesToHex(this.hash)}`;
    }

    toUserFriendly(bounceable: boolean, testnet: boolean): string {
        const bytes = new Uint8Array(36);
        bytes[0] =
            (bounceable ? TAG_BOUNCEABLE : TAG_NON_BOUNCEABLE) |
            (testnet ? FLAG_TESTNET : 0);
        bytes[1] = this.workchain & 0xff;
        bytes.set(this.hash, 2);
        const crc = crc16Xmodem(bytes.slice(0, 34));
        bytes[34] = crc >> 8;
        bytes[35] = crc & 0xff;
        return bytesToBase64Url(bytes);
    }
}

// --------------------------------------------------------------------- BoC

const BOC_MAGIC = [0xb5, 0xee, 0x9c, 0x72];

function readBe(bytes: Uint8Array, pos: number, width: number): number {
    let value = 0;
    for (let i = 0; i < width; i++) value = value * 256 + bytes[pos + i];
    return value;
}

function decodeBitLen(d2: number, data: Uint8Array): number {
    const fullBytes = Math.floor(d2 / 2);
    if (d2 % 2 === 0) return fullBytes * 8;
    const last = data[data.length - 1];
    if (last === undefined || last === 0)
        throw new CellError("invalid completion tag");
    let trailing = 0;
    while (((last >> trailing) & 1) === 0) trailing += 1;
    return fullBytes * 8 + 7 - trailing;
}

/** Parse a single-root Bag of Cells (ordinary cells only, CRC not verified). */
export function parseBocSingleRoot(bytes: Uint8Array): Cell {
    if (bytes.length < 10 || BOC_MAGIC.some((b, i) => bytes[i] !== b)) {
        throw new CellError("not a bag of cells");
    }
    const flags = bytes[4];
    const hasIdx = (flags & 0x80) !== 0;
    const hasCrc = (flags & 0x40) !== 0;
    const size = flags & 0x07;
    if (
        (flags & 0x20) !== 0 ||
        (flags & 0x18) !== 0 ||
        size === 0 ||
        size > 4
    ) {
        throw new CellError("unsupported bag of cells header");
    }
    const offBytes = bytes[5];
    if (offBytes === 0 || offBytes > 8)
        throw new CellError("invalid bag of cells header");
    let pos = 6;
    const cellCount = readBe(bytes, pos, size);
    pos += size;
    const rootCount = readBe(bytes, pos, size);
    pos += size;
    const absentCount = readBe(bytes, pos, size);
    pos += size;
    const totalCellsSize = readBe(bytes, pos, offBytes);
    pos += offBytes;
    if (
        rootCount !== 1 ||
        absentCount !== 0 ||
        cellCount === 0 ||
        cellCount * 2 > totalCellsSize
    ) {
        throw new CellError("unsupported bag of cells");
    }
    if (
        pos +
            rootCount * size +
            (hasIdx ? cellCount * offBytes : 0) +
            totalCellsSize +
            (hasCrc ? 4 : 0) >
        bytes.length
    ) {
        throw new CellError("truncated bag of cells");
    }
    const rootIndex = readBe(bytes, pos, size);
    pos += size;
    if (rootIndex >= cellCount) throw new CellError("invalid root index");
    if (hasIdx) pos += cellCount * offBytes;
    const raw: Array<{ d2: number; data: Uint8Array; refs: number[] }> = [];
    for (let i = 0; i < cellCount; i++) {
        const d1 = bytes[pos];
        const d2 = bytes[pos + 1];
        pos += 2;
        if ((d1 & 0x08) !== 0 || (d1 & 0xe0) !== 0)
            throw new CellError("exotic cells are not supported");
        const refCount = d1 & 0x07;
        if (refCount > MAX_CELL_REFS) throw new CellError("too many refs");
        const dataLen = Math.ceil(d2 / 2);
        const data = bytes.slice(pos, pos + dataLen);
        pos += dataLen;
        const refs: number[] = [];
        for (let r = 0; r < refCount; r++) {
            const idx = readBe(bytes, pos, size);
            pos += size;
            if (idx <= i || idx >= cellCount)
                throw new CellError("invalid ref order");
            refs.push(idx);
        }
        raw.push({ d2, data, refs });
    }
    const cells: Cell[] = new Array(cellCount);
    for (let i = cellCount - 1; i >= 0; i--) {
        const { d2, data, refs } = raw[i];
        cells[i] = new Cell(
            data,
            decodeBitLen(d2, data),
            refs.map((idx) => cells[idx]),
        );
    }
    return cells[rootIndex];
}

/** Cell from the envelope's body string: hex or base64 (either alphabet) BoC. */
export function cellFromBocString(text: string): Cell | null {
    const trimmed = text.trim();
    const bytes =
        trimmed.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(trimmed)
            ? hexToBytes(trimmed)
            : base64ToBytes(trimmed);
    if (!bytes) return null;
    try {
        return parseBocSingleRoot(bytes);
    } catch {
        return null;
    }
}

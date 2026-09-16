/**
 * Minimal BCS (Binary Canonical Serialization) writer, enough for Move
 * transactions (Aptos, Sui): fixed-width little-endian integers, ULEB128
 * lengths/variant indexes, byte strings and sequences.
 */
export class BcsWriter {
    private chunks: number[] = [];

    u8(value: number): this {
        this.chunks.push(value & 0xff);
        return this;
    }

    u16(value: number): this {
        this.chunks.push(value & 0xff, (value >>> 8) & 0xff);
        return this;
    }

    u32(value: number): this {
        for (let i = 0; i < 4; i++)
            this.chunks.push((value >>> (8 * i)) & 0xff);
        return this;
    }

    u64(value: bigint): this {
        return this.uintLE(value, 8);
    }

    u128(value: bigint): this {
        return this.uintLE(value, 16);
    }

    u256(value: bigint): this {
        return this.uintLE(value, 32);
    }

    private uintLE(value: bigint, bytes: number): this {
        let v = value;
        for (let i = 0; i < bytes; i++) {
            this.chunks.push(Number(v & 0xffn));
            v >>= 8n;
        }
        return this;
    }

    bool(value: boolean): this {
        return this.u8(value ? 1 : 0);
    }

    /** ULEB128, used for sequence lengths and enum variant indexes. */
    uleb128(value: number): this {
        let v = value >>> 0;
        while (v >= 0x80) {
            this.chunks.push((v & 0x7f) | 0x80);
            v >>>= 7;
        }
        this.chunks.push(v);
        return this;
    }

    variant(index: number): this {
        return this.uleb128(index);
    }

    /** Raw bytes without a length prefix (fixed-size fields). */
    fixed(bytes: Uint8Array): this {
        for (const b of bytes) this.chunks.push(b);
        return this;
    }

    /** Length-prefixed bytes (`vector<u8>`). */
    bytes(bytes: Uint8Array): this {
        this.uleb128(bytes.length);
        return this.fixed(bytes);
    }

    /** Length-prefixed UTF-8 string. */
    string(text: string): this {
        return this.bytes(new TextEncoder().encode(text));
    }

    /** Length-prefixed sequence; `write` encodes one element. */
    vec<T>(items: readonly T[], write: (item: T, w: BcsWriter) => void): this {
        this.uleb128(items.length);
        for (const item of items) write(item, this);
        return this;
    }

    option<T>(
        value: T | null | undefined,
        write: (item: T, w: BcsWriter) => void,
    ): this {
        if (value === null || value === undefined) return this.u8(0);
        this.u8(1);
        write(value, this);
        return this;
    }

    toBytes(): Uint8Array {
        return Uint8Array.from(this.chunks);
    }
}

export function hexToBytes(hex: string): Uint8Array | null {
    const clean =
        hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

export function bytesToHex(bytes: Uint8Array): string {
    let out = "";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out;
}

/** Bytes from a 0x hex string or a JSON byte array (older envelopes). */
export function bytesFromJson(value: unknown): Uint8Array | null {
    if (typeof value === "string") return hexToBytes(value);
    if (
        Array.isArray(value) &&
        value.every(
            (b) =>
                typeof b === "number" &&
                Number.isInteger(b) &&
                b >= 0 &&
                b <= 255,
        )
    ) {
        return Uint8Array.from(value as number[]);
    }
    return null;
}

/** u64 from a decimal string or a safe JSON number (serde flexible form). */
export function u64FromJson(value: unknown): bigint | null {
    if (typeof value === "string" && /^\d+$/.test(value)) {
        const v = BigInt(value);
        return v <= 0xffffffffffffffffn ? v : null;
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

/** 32-byte address from "0x…" hex, left-padded when shorter (Move short form). */
export function address32FromJson(value: unknown): Uint8Array | null {
    if (typeof value !== "string") return null;
    const clean =
        value.startsWith("0x") || value.startsWith("0X")
            ? value.slice(2)
            : value;
    if (
        clean.length === 0 ||
        clean.length > 64 ||
        !/^[0-9a-fA-F]+$/.test(clean)
    )
        return null;
    return hexToBytes(clean.padStart(64, "0"));
}

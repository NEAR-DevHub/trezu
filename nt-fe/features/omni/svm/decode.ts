const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Human decode of the instructions omni-cli-rs emits itself. */
export type SvmDecodedInstruction =
    | { kind: "system-transfer"; lamports: bigint; from: string; to: string }
    | {
          kind: "spl-transfer";
          amount: bigint;
          /** Present for transferChecked. */
          decimals: number | null;
          source: string;
          destination: string;
          authority: string;
      };

function hexToBytes(hex: string): Uint8Array | null {
    const clean = hex.replace(/^0x/, "");
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function readU64LE(bytes: Uint8Array, offset: number): bigint | null {
    if (bytes.length < offset + 8) return null;
    let value = 0n;
    for (let i = 7; i >= 0; i--) {
        value = (value << 8n) | BigInt(bytes[offset + i]);
    }
    return value;
}

function decodeKnownInstruction(
    programId: string,
    dataHex: string,
    accounts: SvmAccount[],
): SvmDecodedInstruction | null {
    const bytes = hexToBytes(dataHex);
    if (!bytes) return null;
    if (programId === SYSTEM_PROGRAM) {
        // SystemInstruction::Transfer = 2 (u32 LE) + lamports (u64 LE)
        if (
            bytes.length === 12 &&
            bytes[0] === 2 &&
            bytes[1] === 0 &&
            bytes[2] === 0 &&
            bytes[3] === 0 &&
            accounts.length >= 2
        ) {
            const lamports = readU64LE(bytes, 4);
            if (lamports === null) return null;
            return {
                kind: "system-transfer",
                lamports,
                from: accounts[0].address,
                to: accounts[1].address,
            };
        }
        return null;
    }
    if (programId === TOKEN_PROGRAM) {
        // TokenInstruction::Transfer = 3 + amount; TransferChecked = 12 + amount + decimals
        if (bytes[0] === 3 && bytes.length === 9 && accounts.length >= 3) {
            const amount = readU64LE(bytes, 1);
            if (amount === null) return null;
            return {
                kind: "spl-transfer",
                amount,
                decimals: null,
                source: accounts[0].address,
                destination: accounts[1].address,
                authority: accounts[2].address,
            };
        }
        if (bytes[0] === 12 && bytes.length === 10 && accounts.length >= 4) {
            const amount = readU64LE(bytes, 1);
            if (amount === null) return null;
            return {
                kind: "spl-transfer",
                amount,
                decimals: bytes[9],
                source: accounts[0].address,
                destination: accounts[2].address,
                authority: accounts[3].address,
            };
        }
    }
    return null;
}

export interface SvmAccount {
    /** Base58 address for static keys; a "lookup table #i[j]" label otherwise. */
    address: string;
    isSigner: boolean;
    isWritable: boolean;
    /** True when the account comes from an address lookup table (V0). */
    fromLookupTable: boolean;
}

export interface SvmInstruction {
    programId: string;
    accounts: SvmAccount[];
    /** 0x hex data as written by omni-cli-rs. */
    dataHex: string;
    /** True for SystemProgram::AdvanceNonceAccount (durable nonce). */
    isNonceAdvance: boolean;
    /** Human decode for known system / SPL token instructions. */
    decoded: SvmDecodedInstruction | null;
}

export interface DecodedSvmTx {
    version: "Legacy" | "V0";
    feePayer: string | null;
    recentBlockhash: string | null;
    accountKeys: string[];
    instructions: SvmInstruction[];
    /** Number of signatures the message requires. */
    numRequiredSignatures: number | null;
}

function toHex(data: unknown): string {
    if (typeof data === "string") {
        return data.startsWith("0x") ? data : `0x${data}`;
    }
    if (Array.isArray(data) && data.every((b) => typeof b === "number")) {
        return `0x${(data as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    }
    return "0x";
}

/**
 * Decode the omni-transaction-rs `SolanaTransaction` serde JSON for display:
 * `{signatures, message: {Legacy|V0: {header, account_keys, recent_blockhash,
 * instructions[{program_id_index, accounts, data}]}}}`. Never throws.
 */
export function decodeSvmUnsignedTx(unsignedTx: unknown): DecodedSvmTx | null {
    if (typeof unsignedTx !== "object" || unsignedTx === null) return null;
    const message = (unsignedTx as Record<string, unknown>).message as
        | Record<string, unknown>
        | undefined;
    if (!message || typeof message !== "object") return null;
    const version: "Legacy" | "V0" | null =
        "Legacy" in message ? "Legacy" : "V0" in message ? "V0" : null;
    if (!version) return null;
    const inner = message[version] as Record<string, unknown>;
    if (!inner || typeof inner !== "object") return null;

    const accountKeys: string[] = Array.isArray(inner.account_keys)
        ? inner.account_keys.filter((k): k is string => typeof k === "string")
        : [];
    const header = (inner.header ?? {}) as Record<string, unknown>;
    const numRequired =
        typeof header.num_required_signatures === "number"
            ? header.num_required_signatures
            : null;
    const numReadonlySigned =
        typeof header.num_readonly_signed_accounts === "number"
            ? header.num_readonly_signed_accounts
            : 0;
    const numReadonlyUnsigned =
        typeof header.num_readonly_unsigned_accounts === "number"
            ? header.num_readonly_unsigned_accounts
            : 0;

    // V0: the index space continues past the static keys with every
    // writable lookup address (table order), then every read-only one. We
    // cannot resolve those addresses without the tables, so label them.
    const loaded: SvmAccount[] = [];
    if (version === "V0" && Array.isArray(inner.address_table_lookups)) {
        const lookups = inner.address_table_lookups as unknown[];
        const push = (writable: boolean) => {
            lookups.forEach((raw, tableIndex) => {
                const table = (raw ?? {}) as Record<string, unknown>;
                const key = writable ? "writable_indexes" : "readonly_indexes";
                const indexes = Array.isArray(table[key]) ? table[key] : [];
                for (const position of indexes as unknown[]) {
                    loaded.push({
                        address: `lookup table #${tableIndex + 1}[${String(position)}]`,
                        isSigner: false,
                        isWritable: writable,
                        fromLookupTable: true,
                    });
                }
            });
        };
        push(true);
        push(false);
    }

    const accountMeta = (index: number): SvmAccount => {
        if (index >= accountKeys.length) {
            return (
                loaded[index - accountKeys.length] ?? {
                    address: `#${index}`,
                    isSigner: false,
                    isWritable: false,
                    fromLookupTable: true,
                }
            );
        }
        const address = accountKeys[index];
        const required = numRequired ?? 0;
        const isSigner = index < required;
        const isWritable = isSigner
            ? index < required - numReadonlySigned
            : index < accountKeys.length - numReadonlyUnsigned;
        return { address, isSigner, isWritable, fromLookupTable: false };
    };

    const instructions: SvmInstruction[] = Array.isArray(inner.instructions)
        ? inner.instructions.map((raw) => {
              const r = (raw ?? {}) as Record<string, unknown>;
              const programIndex =
                  typeof r.program_id_index === "number"
                      ? r.program_id_index
                      : -1;
              const programId = accountKeys[programIndex] ?? `#${programIndex}`;
              const dataHex = toHex(r.data);
              const accounts = Array.isArray(r.accounts)
                  ? (r.accounts as unknown[])
                        .filter((i): i is number => typeof i === "number")
                        .map(accountMeta)
                  : [];
              // SystemInstruction::AdvanceNonceAccount = index 4 (u32 LE).
              const isNonceAdvance =
                  programId === SYSTEM_PROGRAM &&
                  dataHex.toLowerCase() === "0x04000000";
              return {
                  programId,
                  accounts,
                  dataHex,
                  isNonceAdvance,
                  decoded: decodeKnownInstruction(programId, dataHex, accounts),
              };
          })
        : [];

    return {
        version,
        feePayer: accountKeys[0] ?? null,
        recentBlockhash:
            typeof inner.recent_blockhash === "string"
                ? inner.recent_blockhash
                : null,
        accountKeys,
        instructions,
        numRequiredSignatures: numRequired,
    };
}

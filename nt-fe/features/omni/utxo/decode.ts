import { sha256 } from "@noble/hashes/sha256";
import { base58, bech32, bech32m, hex } from "@scure/base";
import type { NearNetwork } from "../types";
import { p2wpkhScriptPubkey } from "./recompute";

export interface UtxoInput {
    txid: string;
    vout: number;
    sequence: number;
    /** Value in sats from `input_values`, when present. */
    valueSats: bigint | null;
}

export interface UtxoOutput {
    valueSats: bigint;
    scriptPubkeyHex: string;
    /** Decoded address, or null for unknown script types. */
    address: string | null;
    scriptType: "p2wpkh" | "p2wsh" | "p2tr" | "p2pkh" | "p2sh" | "unknown";
    /** True when the output pays back to the envelope's sender key. */
    isChange: boolean;
}

export interface DecodedUtxoTx {
    version: number | null;
    lockTime: number | null;
    inputs: UtxoInput[];
    outputs: UtxoOutput[];
    /** Compressed sender key from the envelope (hex33) when present. */
    senderPublicKeyHex: string | null;
    totalInSats: bigint | null;
    totalOutSats: bigint;
    feeSats: bigint | null;
    estimatedVbytes: number;
}

function base58check(version: number, payload: Uint8Array): string {
    const data = new Uint8Array(1 + payload.length);
    data[0] = version;
    data.set(payload, 1);
    const checksum = sha256(sha256(data)).slice(0, 4);
    const full = new Uint8Array(data.length + 4);
    full.set(data);
    full.set(checksum, data.length);
    return base58.encode(full);
}

/** Decode a script_pubkey into a Bitcoin address for the common templates. */
export function addressFromScriptPubkey(
    scriptHex: string,
    network: NearNetwork,
): Pick<UtxoOutput, "address" | "scriptType"> {
    const clean = scriptHex.replace(/^0x/, "").toLowerCase();
    let script: Uint8Array;
    try {
        script = hex.decode(clean);
    } catch {
        return { address: null, scriptType: "unknown" };
    }
    const hrp = network === "mainnet" ? "bc" : "tb";
    // OP_0 <20 bytes>
    if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) {
        return {
            address: bech32.encode(
                hrp,
                [0, ...bech32.toWords(script.slice(2))],
                90,
            ),
            scriptType: "p2wpkh",
        };
    }
    // OP_0 <32 bytes>
    if (script.length === 34 && script[0] === 0x00 && script[1] === 0x20) {
        return {
            address: bech32.encode(
                hrp,
                [0, ...bech32.toWords(script.slice(2))],
                90,
            ),
            scriptType: "p2wsh",
        };
    }
    // OP_1 <32 bytes>
    if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) {
        return {
            address: bech32m.encode(
                hrp,
                [1, ...bech32.toWords(script.slice(2))],
                90,
            ),
            scriptType: "p2tr",
        };
    }
    // OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
    if (
        script.length === 25 &&
        script[0] === 0x76 &&
        script[1] === 0xa9 &&
        script[2] === 0x14 &&
        script[23] === 0x88 &&
        script[24] === 0xac
    ) {
        return {
            address: base58check(
                network === "mainnet" ? 0x00 : 0x6f,
                script.slice(3, 23),
            ),
            scriptType: "p2pkh",
        };
    }
    // OP_HASH160 <20> OP_EQUAL
    if (
        script.length === 23 &&
        script[0] === 0xa9 &&
        script[1] === 0x14 &&
        script[22] === 0x87
    ) {
        return {
            address: base58check(
                network === "mainnet" ? 0x05 : 0xc4,
                script.slice(2, 22),
            ),
            scriptType: "p2sh",
        };
    }
    return { address: null, scriptType: "unknown" };
}

function toBigIntOrNull(value: unknown): bigint | null {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
        return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
    return null;
}

/** Decode the `utxo` envelope `unsigned_tx` for display. Never throws. */
export function decodeUtxoUnsignedTx(
    unsignedTx: unknown,
    network: NearNetwork,
): DecodedUtxoTx | null {
    if (typeof unsignedTx !== "object" || unsignedTx === null) return null;
    const outer = unsignedTx as Record<string, unknown>;
    const tx = outer.tx as Record<string, unknown> | undefined;
    if (!tx || typeof tx !== "object") return null;
    const inputValues = Array.isArray(outer.input_values)
        ? outer.input_values.map(toBigIntOrNull)
        : [];
    const inputs: UtxoInput[] = Array.isArray(tx.inputs)
        ? tx.inputs.map((raw, index) => {
              const r = (raw ?? {}) as Record<string, unknown>;
              return {
                  txid: typeof r.txid === "string" ? r.txid : "",
                  vout: typeof r.vout === "number" ? r.vout : 0,
                  sequence: typeof r.sequence === "number" ? r.sequence : 0,
                  valueSats: inputValues[index] ?? null,
              };
          })
        : [];
    const senderKeyHex =
        typeof outer.sender_public_key === "string"
            ? outer.sender_public_key.replace(/^0x/, "").toLowerCase()
            : null;
    let changeScriptHex: string | null = null;
    if (senderKeyHex && senderKeyHex.length === 66) {
        try {
            changeScriptHex = hex.encode(
                p2wpkhScriptPubkey(hex.decode(senderKeyHex)),
            );
        } catch {
            changeScriptHex = null;
        }
    }
    const outputs: UtxoOutput[] = Array.isArray(tx.outputs)
        ? tx.outputs.map((raw) => {
              const r = (raw ?? {}) as Record<string, unknown>;
              const scriptPubkeyHex =
                  typeof r.script_pubkey === "string" ? r.script_pubkey : "";
              const clean = scriptPubkeyHex.replace(/^0x/, "").toLowerCase();
              return {
                  valueSats: toBigIntOrNull(r.value_sats) ?? 0n,
                  scriptPubkeyHex,
                  ...addressFromScriptPubkey(scriptPubkeyHex, network),
                  isChange:
                      changeScriptHex !== null && clean === changeScriptHex,
              };
          })
        : [];
    const totalOutSats = outputs.reduce((sum, o) => sum + o.valueSats, 0n);
    const allInputsKnown =
        inputs.length > 0 && inputs.every((i) => i.valueSats !== null);
    const totalInSats = allInputsKnown
        ? inputs.reduce((sum, i) => sum + (i.valueSats ?? 0n), 0n)
        : null;
    return {
        version: typeof tx.version === "number" ? tx.version : null,
        lockTime: typeof tx.lock_time === "number" ? tx.lock_time : null,
        inputs,
        outputs,
        senderPublicKeyHex:
            typeof outer.sender_public_key === "string"
                ? outer.sender_public_key
                : null,
        totalInSats,
        totalOutSats,
        feeSats: totalInSats === null ? null : totalInSats - totalOutSats,
        // BIP141 weight estimate for P2WPKH: 10.5 vB overhead + 68 per input
        // + 31 per output (presentation only).
        estimatedVbytes: 10.5 + 68 * inputs.length + 31 * outputs.length,
    };
}

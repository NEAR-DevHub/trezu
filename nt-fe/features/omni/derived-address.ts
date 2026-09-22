import { blake2b } from "@noble/hashes/blake2b";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha3_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { base58, bech32 } from "@scure/base";
import { getAddress, keccak256 } from "viem";
import { nearViewFunction } from "./near-view";
import { getMpcSignerContract } from "./network";
import { domainIdForFamily, type NearNetwork, type OmniFamily } from "./types";

/**
 * The foreign account a (DAO, path) pair controls on a family's chains.
 * `publicKeyHex` is the raw key (64-byte uncompressed secp256k1 without the
 * 0x04 prefix, or 32-byte ed25519), lowercase hex without 0x.
 */
export interface DerivedAccount {
    family: OmniFamily;
    /** Chain-format address; null when the family has no key-only address
     * form in the browser (TON wallet addresses need the wallet code). */
    address: string | null;
    publicKeyHex: string;
    /** Compressed secp256k1 key (33 bytes hex) for secp256k1 families. */
    compressedPublicKeyHex?: string;
}

/** Parse a NEAR public key string ("secp256k1:<b58>" / "ed25519:<b58>"). */
export function parseNearPublicKey(value: string): {
    curve: "secp256k1" | "ed25519";
    bytes: Uint8Array;
} {
    const separator = value.indexOf(":");
    if (separator === -1) throw new Error("Malformed NEAR public key");
    const curve = value.slice(0, separator);
    const bytes = base58.decode(value.slice(separator + 1));
    if (curve === "secp256k1" && bytes.length === 64) {
        return { curve, bytes };
    }
    if (curve === "ed25519" && bytes.length === 32) {
        return { curve, bytes };
    }
    throw new Error(
        `Unexpected NEAR public key ${curve} (${bytes.length} bytes)`,
    );
}

export function compressSecp256k1(uncompressed64: Uint8Array): Uint8Array {
    const x = uncompressed64.slice(0, 32);
    const yIsOdd = (uncompressed64[63] & 1) === 1;
    const out = new Uint8Array(33);
    out[0] = yIsOdd ? 0x03 : 0x02;
    out.set(x, 1);
    return out;
}

/** EVM address: keccak256(uncompressed key without 04)[12..], checksummed. */
export function evmAddressFromPublicKey(uncompressed64: Uint8Array): string {
    const hash = keccak256(`0x${bytesToHex(uncompressed64)}`);
    return getAddress(`0x${hash.slice(26)}`);
}

/** Native segwit v0 P2WPKH address for a compressed key. */
export function p2wpkhAddress(
    compressed33: Uint8Array,
    network: NearNetwork,
): string {
    const hash160 = ripemd160(sha256(compressed33));
    const words = bech32.toWords(hash160);
    return bech32.encode(
        network === "mainnet" ? "bc" : "tb",
        [0, ...words],
        90,
    );
}

/** Aptos single-key ed25519 auth key: sha3_256(pubkey || 0x00). */
export function aptosAddressFromPublicKey(pk32: Uint8Array): string {
    const input = new Uint8Array(33);
    input.set(pk32, 0);
    input[32] = 0x00;
    return `0x${bytesToHex(sha3_256(input))}`;
}

/** Sui ed25519 address: blake2b-256(0x00 || pubkey). */
export function suiAddressFromPublicKey(pk32: Uint8Array): string {
    const input = new Uint8Array(33);
    input[0] = 0x00;
    input.set(pk32, 1);
    return `0x${bytesToHex(blake2b(input, { dkLen: 32 }))}`;
}

export function deriveAccount(
    family: OmniFamily,
    nearPublicKey: string,
    network: NearNetwork,
): DerivedAccount {
    const { curve, bytes } = parseNearPublicKey(nearPublicKey);
    const publicKeyHex = bytesToHex(bytes);
    switch (family) {
        case "evm": {
            if (curve !== "secp256k1") throw new Error("Expected secp256k1");
            return {
                family,
                address: evmAddressFromPublicKey(bytes),
                publicKeyHex,
                compressedPublicKeyHex: bytesToHex(compressSecp256k1(bytes)),
            };
        }
        case "utxo": {
            if (curve !== "secp256k1") throw new Error("Expected secp256k1");
            const compressed = compressSecp256k1(bytes);
            return {
                family,
                address: p2wpkhAddress(compressed, network),
                publicKeyHex,
                compressedPublicKeyHex: bytesToHex(compressed),
            };
        }
        case "svm": {
            if (curve !== "ed25519") throw new Error("Expected ed25519");
            return { family, address: base58.encode(bytes), publicKeyHex };
        }
        case "aptos": {
            if (curve !== "ed25519") throw new Error("Expected ed25519");
            return {
                family,
                address: aptosAddressFromPublicKey(bytes),
                publicKeyHex,
            };
        }
        case "sui": {
            if (curve !== "ed25519") throw new Error("Expected ed25519");
            return {
                family,
                address: suiAddressFromPublicKey(bytes),
                publicKeyHex,
            };
        }
        case "ton": {
            if (curve !== "ed25519") throw new Error("Expected ed25519");
            return { family, address: null, publicKeyHex };
        }
    }
}

/**
 * Fetch the derived key for (dao, path) from the MPC contract and turn it
 * into the family's address. Throws on RPC failure.
 */
export async function fetchDerivedAccount(
    dao: string,
    path: string,
    family: OmniFamily,
    network: NearNetwork,
): Promise<DerivedAccount> {
    const nearPublicKey = await nearViewFunction<string>(
        network,
        getMpcSignerContract(network),
        "derived_public_key",
        { path, predecessor: dao, domain_id: domainIdForFamily(family) },
    );
    return deriveAccount(family, nearPublicKey, network);
}

/**
 * The sender the envelope claims, when the family embeds one, so the UI can
 * compare it with the derived account (async informational check).
 */
export interface EnvelopeSender {
    kind: "address" | "publicKey";
    value: string;
    /** Account address the envelope also names (aptos `tx.sender`); must
     * equal the derived address too. */
    address?: string;
}

export function envelopeSender(
    family: OmniFamily,
    unsignedTx: unknown,
): EnvelopeSender | null {
    if (typeof unsignedTx !== "object" || unsignedTx === null) return null;
    const tx = unsignedTx as Record<string, unknown>;
    switch (family) {
        case "svm": {
            const message = tx.message as Record<string, unknown> | undefined;
            const inner = (message?.Legacy ?? message?.V0) as
                | Record<string, unknown>
                | undefined;
            const keys = inner?.account_keys;
            if (Array.isArray(keys) && typeof keys[0] === "string") {
                return { kind: "address", value: keys[0] };
            }
            return null;
        }
        case "utxo":
        case "aptos":
        case "sui": {
            const key = tx.sender_public_key;
            if (typeof key !== "string") return null;
            const sender: EnvelopeSender = {
                kind: "publicKey",
                value: key.replace(/^0x/, "").toLowerCase(),
            };
            const inner = tx.tx as Record<string, unknown> | undefined;
            if (family === "aptos" && typeof inner?.sender === "string") {
                sender.address = inner.sender.toLowerCase();
            }
            return sender;
        }
        case "ton": {
            const key = tx.public_key;
            if (Array.isArray(key) && key.every((b) => typeof b === "number")) {
                return {
                    kind: "publicKey",
                    value: bytesToHex(Uint8Array.from(key as number[])),
                };
            }
            if (typeof key === "string") {
                return {
                    kind: "publicKey",
                    value: key.replace(/^0x/, "").toLowerCase(),
                };
            }
            return null;
        }
        case "evm":
            return null;
    }
}

/** Compare the envelope sender with the derived account. */
export function senderMatchesDerived(
    sender: EnvelopeSender,
    derived: DerivedAccount,
): boolean {
    if (sender.kind === "address") {
        return derived.address !== null && derived.address === sender.value;
    }
    const keyMatches =
        derived.family === "utxo"
            ? derived.compressedPublicKeyHex === sender.value
            : derived.publicKeyHex === sender.value;
    if (!keyMatches) return false;
    if (sender.address !== undefined) {
        // The account that actually moves is `tx.sender`; it must be the
        // auth key derived from the same public key.
        return (
            derived.address !== null &&
            derived.address.toLowerCase() === sender.address
        );
    }
    return true;
}

import { describe, expect, it } from "bun:test";
import {
    deriveAccount,
    envelopeSender,
    senderMatchesDerived,
} from "./derived-address";
import { formatBaseUnits, formatGwei, truncateMiddle } from "./format";
import { decodeSvmUnsignedTx } from "./svm/decode";
import { addressFromScriptPubkey, decodeUtxoUnsignedTx } from "./utxo/decode";

/**
 * `derived_public_key` on v1.signer for
 * {path: "omni-1", predecessor: "testing-treasury-frolik.sputnik-dao.near"}
 * fetched from NEAR mainnet on 2026-09-15.
 */
const SECP_KEY =
    "secp256k1:3A8DnBMDthxjaqBqe5MEiBqHoF1TL7gXRfyrHQjGgKPgz8GVqYmSsfARABrPYKPwTpLf2zwdJGtTWBPvFaHJzUz1";
const ED_KEY = "ed25519:ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw";
/**
 * `derived_public_key` on v1.signer-prod.testnet for
 * {path: "omni-1", predecessor: "omni-e2e.sputnik-v2.testnet"} (2026-09-15).
 */
const TESTNET_SECP_KEY =
    "secp256k1:7RJ21KeXJNLs58vt6HY56YnuYnrspVjnWZY7sWmx7mqPj7C1i7xd8QF3c7g7mabKuHGTk115FyfUpsFo8fHr6Ti";

describe("derived accounts", () => {
    it("derives the EVM address for the proposal 10 DAO/path", () => {
        const account = deriveAccount("evm", SECP_KEY, "mainnet");
        expect(account.address?.toLowerCase()).toBe(
            "0x80f0c642d82d46367bed51bd30735c2d2a3546c9",
        );
        expect(account.compressedPublicKeyHex).toHaveLength(66);
    });

    it("derives the testnet e2e DAO address (matches the omni CLI)", () => {
        const account = deriveAccount("evm", TESTNET_SECP_KEY, "testnet");
        expect(account.address).toBe(
            "0x02ff3a60639532e141E5E9CCBF84a3517F15674a",
        );
    });

    it("derives a bech32 P2WPKH address for utxo", () => {
        const account = deriveAccount("utxo", SECP_KEY, "mainnet");
        expect(account.address?.startsWith("bc1q")).toBe(true);
        const testnet = deriveAccount("utxo", SECP_KEY, "testnet");
        expect(testnet.address?.startsWith("tb1q")).toBe(true);
    });

    it("derives ed25519 family addresses", () => {
        const svm = deriveAccount("svm", ED_KEY, "mainnet");
        expect(svm.address).toBe(
            "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
        );
        const aptos = deriveAccount("aptos", ED_KEY, "mainnet");
        expect(aptos.address).toMatch(/^0x[0-9a-f]{64}$/);
        const sui = deriveAccount("sui", ED_KEY, "mainnet");
        expect(sui.address).toMatch(/^0x[0-9a-f]{64}$/);
        expect(sui.address).not.toBe(aptos.address);
        const ton = deriveAccount("ton", ED_KEY, "mainnet");
        expect(ton.address).toBeNull();
        expect(ton.publicKeyHex).toHaveLength(64);
    });

    it("rejects a key from the wrong curve", () => {
        expect(() => deriveAccount("evm", ED_KEY, "mainnet")).toThrow();
        expect(() => deriveAccount("svm", SECP_KEY, "mainnet")).toThrow();
    });

    it("compares envelope senders with the derived account", () => {
        const svm = deriveAccount("svm", ED_KEY, "mainnet");
        const sender = envelopeSender("svm", {
            message: {
                Legacy: {
                    account_keys: [
                        svm.address,
                        "11111111111111111111111111111111",
                    ],
                },
            },
        });
        if (!sender || !svm.address) throw new Error("unreachable");
        expect(sender).toEqual({ kind: "address", value: svm.address });
        expect(senderMatchesDerived(sender, svm)).toBe(true);
        expect(
            senderMatchesDerived({ kind: "address", value: "other" }, svm),
        ).toBe(false);

        const utxo = deriveAccount("utxo", SECP_KEY, "mainnet");
        const utxoSender = envelopeSender("utxo", {
            sender_public_key: utxo.compressedPublicKeyHex,
        });
        if (!utxoSender) throw new Error("unreachable");
        expect(senderMatchesDerived(utxoSender, utxo)).toBe(true);
        expect(envelopeSender("evm", {})).toBeNull();

        // aptos: both the key and tx.sender (auth key) must match.
        const aptos = deriveAccount("aptos", ED_KEY, "mainnet");
        const aptosSender = envelopeSender("aptos", {
            sender_public_key: aptos.publicKeyHex,
            tx: { sender: aptos.address },
        });
        if (!aptosSender) throw new Error("unreachable");
        expect(senderMatchesDerived(aptosSender, aptos)).toBe(true);
        const wrongAccount = envelopeSender("aptos", {
            sender_public_key: aptos.publicKeyHex,
            tx: { sender: `0x${"ab".repeat(32)}` },
        });
        if (!wrongAccount) throw new Error("unreachable");
        expect(senderMatchesDerived(wrongAccount, aptos)).toBe(false);
    });
});

describe("utxo decode", () => {
    it("decodes common script templates", () => {
        expect(
            addressFromScriptPubkey(
                "0014751e76e8199196d454941c45d1b3a323f1433bd6",
                "mainnet",
            ).address,
        ).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
        expect(
            addressFromScriptPubkey(
                "76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac",
                "mainnet",
            ).address,
        ).toBe("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
        expect(addressFromScriptPubkey("6a0474657874", "mainnet")).toEqual({
            address: null,
            scriptType: "unknown",
        });
    });

    it("computes the fee from input values and outputs", () => {
        const decoded = decodeUtxoUnsignedTx(
            {
                tx: {
                    version: 2,
                    lock_time: 0,
                    inputs: [
                        {
                            txid: "ab".repeat(32),
                            vout: 1,
                            sequence: 4294967293,
                        },
                    ],
                    outputs: [
                        {
                            value_sats: 50000,
                            script_pubkey:
                                "0014751e76e8199196d454941c45d1b3a323f1433bd6",
                        },
                    ],
                },
                input_values: [60000],
                sender_public_key: `02${"11".repeat(32)}`,
            },
            "mainnet",
        );
        expect(decoded?.feeSats).toBe(10000n);
        expect(decoded?.outputs[0].address).toBe(
            "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        );
        expect(decodeUtxoUnsignedTx("nope", "mainnet")).toBeNull();
    });
});

describe("svm decode", () => {
    it("extracts fee payer and flags the nonce advance", () => {
        const decoded = decodeSvmUnsignedTx({
            signatures: [],
            message: {
                Legacy: {
                    header: {
                        num_required_signatures: 1,
                        num_readonly_signed_accounts: 0,
                        num_readonly_unsigned_accounts: 2,
                    },
                    account_keys: [
                        "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
                        "NonceAcc11111111111111111111111111111111111",
                        "SysvarRecentB1ockHashes11111111111111111111",
                        "11111111111111111111111111111111",
                    ],
                    recent_blockhash: "hash",
                    instructions: [
                        {
                            program_id_index: 3,
                            accounts: [1, 2, 0],
                            data: "0x04000000",
                        },
                        {
                            program_id_index: 3,
                            accounts: [0, 1],
                            data: "0x0200000040420f0000000000",
                        },
                    ],
                },
            },
        });
        expect(decoded?.feePayer).toBe(
            "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
        );
        expect(decoded?.instructions[0].isNonceAdvance).toBe(true);
        expect(decoded?.instructions[1].isNonceAdvance).toBe(false);
        expect(decoded?.instructions[0].accounts[2]).toEqual({
            address: "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
            isSigner: true,
            isWritable: true,
            fromLookupTable: false,
        });
        expect(decoded?.instructions[0].accounts[1].isWritable).toBe(false);
    });

    it("decodes a SystemProgram transfer and an SPL transferChecked", () => {
        const decoded = decodeSvmUnsignedTx({
            message: {
                Legacy: {
                    header: {
                        num_required_signatures: 1,
                        num_readonly_signed_accounts: 0,
                        num_readonly_unsigned_accounts: 2,
                    },
                    account_keys: [
                        "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
                        "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
                        "11111111111111111111111111111111",
                        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                    ],
                    recent_blockhash: "hash",
                    instructions: [
                        // Transfer(1_000_000 lamports)
                        {
                            program_id_index: 2,
                            accounts: [0, 1],
                            data: "0x0200000040420f0000000000",
                        },
                        // TransferChecked(amount=5000, decimals=6): source, mint, destination, authority
                        {
                            program_id_index: 3,
                            accounts: [1, 1, 1, 0],
                            data: "0x0c881300000000000006",
                        },
                    ],
                },
            },
        });
        expect(decoded?.instructions[0].decoded).toEqual({
            kind: "system-transfer",
            lamports: 1_000_000n,
            from: "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
            to: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
        });
        expect(decoded?.instructions[1].decoded).toEqual({
            kind: "spl-transfer",
            amount: 5000n,
            decimals: 6,
            source: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            destination: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
            authority: "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
        });
    });

    it("labels V0 lookup-table accounts instead of resolving them", () => {
        const decoded = decodeSvmUnsignedTx({
            message: {
                V0: {
                    header: {
                        num_required_signatures: 1,
                        num_readonly_signed_accounts: 0,
                        num_readonly_unsigned_accounts: 1,
                    },
                    account_keys: [
                        "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
                        "11111111111111111111111111111111",
                    ],
                    recent_blockhash: "hash",
                    instructions: [
                        {
                            program_id_index: 1,
                            accounts: [0, 2, 3],
                            data: "0x00",
                        },
                    ],
                    address_table_lookups: [
                        {
                            account_key:
                                "Tab1e11111111111111111111111111111111111111",
                            writable_indexes: [7],
                            readonly_indexes: [9],
                        },
                    ],
                },
            },
        });
        expect(decoded?.version).toBe("V0");
        expect(decoded?.feePayer).toBe(
            "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
        );
        const accounts = decoded?.instructions[0].accounts ?? [];
        expect(accounts[0].fromLookupTable).toBe(false);
        expect(accounts[1]).toEqual({
            address: "lookup table #1[7]",
            isSigner: false,
            isWritable: true,
            fromLookupTable: true,
        });
        expect(accounts[2]).toEqual({
            address: "lookup table #1[9]",
            isSigner: false,
            isWritable: false,
            fromLookupTable: true,
        });
    });
});

describe("format", () => {
    it("formats base units exactly", () => {
        expect(formatBaseUnits(0n, 18)).toBe("0");
        expect(formatBaseUnits(1_500_000_000_000_000_000n, 18)).toBe("1.5");
        expect(formatBaseUnits(10218200000000n, 18)).toBe("0.0000102182");
        expect(formatGwei(100000000n)).toBe("0.1");
        expect(
            truncateMiddle("0xd025b38762B4A4E36F0Cde483b86CB13ea00D989"),
        ).toBe("0xd025…D989");
    });
});

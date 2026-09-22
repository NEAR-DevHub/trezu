import { describe, expect, it } from "bun:test";
import { base58 } from "@scure/base";
import type { Proposal } from "@/lib/proposals-api";
import { bytesToHex, hexToBytes } from "../bcs";
import { extractOmniProposalData } from "../verify";
import { decodeSvmUnsignedTx } from "./decode";
import {
    encodeCompactU16,
    parseSvmUnsignedTx,
    serializeSvmMessage,
    svmPayloadsFromEnvelope,
} from "./recompute";

/**
 * NEAR testnet DAO omni-e2e.sputnik-v2.testnet proposal 5 (InProgress),
 * VERIFIED by `omni proposal review`. Durable-nonce transfer of 0.01 SOL.
 * Receiver v1.signer-prod.testnet, path omni-1, domain 1.
 */
const P5_DESCRIPTION =
    '{"omni":1,"intent":"SOL vector for trezu UI: do not approve","family":"svm","chain":"solana","path":"omni-1","unsigned_tx":{"message":{"Legacy":{"account_keys":["FXTyp6DD7QcSLumbkiJ86uCGirNUETaWoSkhQ3Bx88JQ","LqhzpZza29cAGHrSZGaorXNSt7fXG9MxT7wx9Wcuoyy","2hCKz5TNpxtZR6wpS8qZqSbh1pW59akjp54hHtj3akYX","11111111111111111111111111111111","SysvarRecentB1ockHashes11111111111111111111"],"header":{"num_readonly_signed_accounts":0,"num_readonly_unsigned_accounts":2,"num_required_signatures":1},"instructions":[{"accounts":[1,4,0],"data":"0x04000000","program_id_index":3},{"accounts":[0,2],"data":"0x020000008096980000000000","program_id_index":3}],"recent_blockhash":"CHkazskSfCWyqZdH7BGuU9MrNFvGccYEHLS2GH9QUZeB"}}},"meta":{"builder_version":"0.1.1"}}';
const P5_PAYLOAD =
    "01000205d7d18c0d34ce4f0989df790c3ebe406db209573428ad5f3cfea61cbcec3e65b505151bbe7ee0ca711291c2fcb5999b8090d29402014a61e0f488fc2e9041db501927ba24a44865e96d6a3b4c23e2a396ef877f7222510a302317fb9837f52678000000000000000000000000000000000000000000000000000000000000000006a7d517192c568ee08a845f73d29788cf035c3145b21ab344d8062ea9400000a7bb21d62cf7c428ab0181c66d849b72e0a7b6c5f41eaddea98fdad38d5351140203030104000404000000030200020c020000008096980000000000";

function proposal(
    description: string,
    payload: string,
    path = "omni-1",
): Proposal {
    return {
        id: 5,
        proposer: "omni-e2e-1789512353.testnet",
        description,
        kind: {
            FunctionCall: {
                receiver_id: "v1.signer-prod.testnet",
                actions: [
                    {
                        method_name: "sign",
                        args: btoa(
                            JSON.stringify({
                                request: {
                                    path,
                                    payload_v2: { Eddsa: payload },
                                    domain_id: 1,
                                },
                            }),
                        ),
                        deposit: "1",
                        gas: "30000000000000",
                    },
                ],
            },
        },
        status: "InProgress",
        vote_counts: {},
        votes: {},
        submission_time: "1790000000000000000",
        last_actions_log: null,
    };
}

/** omni-cli-rs round-trip case: payer [7;32], transfer 1_000_000 to [9;32], blockhash [3;32]. */
function roundTripEnvelope(): unknown {
    const payer = base58.encode(new Uint8Array(32).fill(7));
    const dest = base58.encode(new Uint8Array(32).fill(9));
    return {
        signatures: [],
        message: {
            Legacy: {
                header: {
                    num_required_signatures: 1,
                    num_readonly_signed_accounts: 0,
                    num_readonly_unsigned_accounts: 1,
                },
                account_keys: [payer, dest, "11111111111111111111111111111111"],
                recent_blockhash: base58.encode(new Uint8Array(32).fill(3)),
                instructions: [
                    {
                        program_id_index: 2,
                        accounts: [0, 1],
                        data: "0x0200000040420f0000000000",
                    },
                ],
            },
        },
    };
}

describe("svm message serialization", () => {
    it("encodes compact-u16 like solana shortvec", () => {
        const cases: Array<[number, number[]]> = [
            [0, [0x00]],
            [5, [0x05]],
            [0x7f, [0x7f]],
            [0x80, [0x80, 0x01]],
            [0xff, [0xff, 0x01]],
            [0x100, [0x80, 0x02]],
            [0x3fff, [0xff, 0x7f]],
            [0x4000, [0x80, 0x80, 0x01]],
        ];
        for (const [value, expected] of cases) {
            const out: number[] = [];
            encodeCompactU16(value, out);
            expect(out).toEqual(expected);
        }
    });

    it("recomputes testnet proposal 5 (durable nonce + transfer) byte-for-byte", () => {
        const unsignedTx = JSON.parse(P5_DESCRIPTION).unsigned_tx;
        expect(svmPayloadsFromEnvelope(unsignedTx)).toEqual({
            ok: true,
            payloadsHex: [P5_PAYLOAD],
        });
        const parsed = parseSvmUnsignedTx(unsignedTx);
        if (!parsed.ok) throw new Error("unreachable");
        // SysvarRecentB1ockHashes… decodes to 32 bytes like any key.
        expect(parsed.message.accountKeys[4]).toHaveLength(32);
        expect(bytesToHex(parsed.message.accountKeys[4])).toBe(
            "06a7d517192c568ee08a845f73d29788cf035c3145b21ab344d8062ea9400000",
        );
    });

    it("serializes the omni-cli-rs round-trip case with byte-array and hex data alike", () => {
        const hexForm = svmPayloadsFromEnvelope(roundTripEnvelope());
        expect(hexForm.ok).toBe(true);
        if (!hexForm.ok) throw new Error("unreachable");
        const raw = roundTripEnvelope() as {
            message: { Legacy: { instructions: Array<{ data: unknown }> } };
        };
        raw.message.Legacy.instructions[0].data = [
            2, 0, 0, 0, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0,
        ];
        expect(svmPayloadsFromEnvelope(raw)).toEqual(hexForm);
        // header, 3 keys, blockhash, 1 instruction: 3 + 1 + 96 + 32 + 1 + (1 + 1 + 2 + 1 + 12) = 150 bytes
        expect(hexForm.payloadsHex[0]).toHaveLength(150 * 2);
        expect(hexForm.payloadsHex[0].startsWith("01000103")).toBe(true);
        // 1 instruction: program 02, 2 accounts [00 01], 12 data bytes
        expect(
            hexForm.payloadsHex[0].endsWith(
                "0102020001" + "0c" + "0200000040420f0000000000",
            ),
        ).toBe(true);
    });
    it("serializes V0 messages with the 0x80 prefix and lookup tables", () => {
        const table = base58.encode(new Uint8Array(32).fill(0xaa));
        const parsed = parseSvmUnsignedTx({
            message: {
                V0: {
                    header: {
                        num_required_signatures: 1,
                        num_readonly_signed_accounts: 0,
                        num_readonly_unsigned_accounts: 1,
                    },
                    account_keys: [
                        base58.encode(new Uint8Array(32).fill(7)),
                        "11111111111111111111111111111111",
                    ],
                    recent_blockhash: base58.encode(new Uint8Array(32).fill(3)),
                    instructions: [
                        { program_id_index: 1, accounts: [0, 2], data: "0x00" },
                    ],
                    address_table_lookups: [
                        {
                            account_key: table,
                            writable_indexes: [7],
                            readonly_indexes: [9, 10],
                        },
                    ],
                },
            },
        });
        if (!parsed.ok) throw new Error("unreachable");
        const bytes = serializeSvmMessage(parsed.message);
        expect(bytes[0]).toBe(0x80);
        // 1 lookup: 32-byte table key, writable [7], readonly [9, 10]
        expect(
            bytesToHex(bytes).endsWith(`01${"aa".repeat(32)}0107${"02"}090a`),
        ).toBe(true);
    });
    it("rejects out-of-range program and account indexes", () => {
        const badProgram = JSON.parse(P5_DESCRIPTION).unsigned_tx;
        badProgram.message.Legacy.instructions[0].program_id_index = 9;
        expect(svmPayloadsFromEnvelope(badProgram)).toEqual({
            ok: false,
            reason: "invalid-field",
            detail: "instructions[0].program_id_index",
        });
        const badAccount = JSON.parse(P5_DESCRIPTION).unsigned_tx;
        badAccount.message.Legacy.instructions[1].accounts = [0, 7];
        expect(svmPayloadsFromEnvelope(badAccount)).toEqual({
            ok: false,
            reason: "invalid-field",
            detail: "instructions[1].accounts",
        });
    });

    it("rejects missing fields, bad keys and oversized messages", () => {
        expect(
            svmPayloadsFromEnvelope({ message: { Legacy: { header: {} } } }),
        ).toEqual({
            ok: false,
            reason: "unsupported-shape",
            detail: "missing field message.Legacy.account_keys",
        });
        expect(svmPayloadsFromEnvelope({ message: { V1: {} } })).toEqual({
            ok: false,
            reason: "unsupported-shape",
            detail: "unsupported message kind V1",
        });
        const badKey = JSON.parse(P5_DESCRIPTION).unsigned_tx;
        badKey.message.Legacy.account_keys[0] = "not-base58-0OIl";
        expect(svmPayloadsFromEnvelope(badKey)).toEqual({
            ok: false,
            reason: "invalid-field",
            detail: "account_keys[0]",
        });
        const huge = JSON.parse(P5_DESCRIPTION).unsigned_tx;
        huge.message.Legacy.instructions[1].data = `0x${"00".repeat(1300)}`;
        const oversized = svmPayloadsFromEnvelope(huge);
        expect(oversized.ok).toBe(false);
        if (oversized.ok) throw new Error("unreachable");
        expect(oversized.detail?.startsWith("oversized message")).toBe(true);
    });
});

describe("omni-transaction-rs golden vectors", () => {
    const V1_MESSAGE_HEX =
        "01000103010101010101010101010101010101010101010101010101010101010101010102000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001020200010c0200000040420f0000000000";
    const V2_MESSAGE_HEX =
        "010001038a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c02000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c49ae77603782054f17a9decea43b444eba0edb12c6f1d31c6e0e4a84bf052eb01020200010c020000002a00000000000000";
    const V4_MESSAGE_HEX =
        "80010001028a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c054a535a992921064d24e87160da387c7c35b5ddbc92bb81e41fa8404105448dc49ae77603782054f17a9decea43b444eba0edb12c6f1d31c6e0e4a84bf052eb0101030203000301020301d09e258ae6cf647b0e2441b43818bb9713c47f6351f87bef581f6f8346c9cc2a01000101";
    const key = (hex: string) => base58.encode(hexToBytes(hex) as Uint8Array);
    const PAYER = key(
        "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c",
    );
    const BLOCKHASH = key(
        "c49ae77603782054f17a9decea43b444eba0edb12c6f1d31c6e0e4a84bf052eb",
    );
    const HEADER = {
        num_required_signatures: 1,
        num_readonly_signed_accounts: 0,
        num_readonly_unsigned_accounts: 1,
    };

    it("V1: legacy transfer from the JSON form (byte-array data)", () => {
        const result = svmPayloadsFromEnvelope({
            message: {
                Legacy: {
                    header: HEADER,
                    account_keys: [
                        "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
                        "8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKh",
                        "11111111111111111111111111111111",
                    ],
                    recent_blockhash: "11111111111111111111111111111111",
                    instructions: [
                        {
                            program_id_index: 2,
                            accounts: [0, 1],
                            data: [2, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0],
                        },
                    ],
                },
            },
        });
        expect(result).toEqual({ ok: true, payloadsHex: [V1_MESSAGE_HEX] });
    });

    it("V2: legacy transfer of 42 lamports from the seed [1;32] keypair", () => {
        const result = svmPayloadsFromEnvelope({
            message: {
                Legacy: {
                    header: HEADER,
                    account_keys: [
                        PAYER,
                        base58.encode(
                            new Uint8Array(32)
                                .fill(0)
                                .map((_, i) => (i === 0 ? 2 : 0)),
                        ),
                        "11111111111111111111111111111111",
                    ],
                    recent_blockhash: BLOCKHASH,
                    instructions: [
                        {
                            program_id_index: 2,
                            accounts: [0, 1],
                            data: "0x020000002a00000000000000",
                        },
                    ],
                },
            },
        });
        expect(result).toEqual({ ok: true, payloadsHex: [V2_MESSAGE_HEX] });
    });

    it("V4: V0 message with one address table lookup", () => {
        const result = svmPayloadsFromEnvelope({
            message: {
                V0: {
                    header: HEADER,
                    account_keys: [
                        PAYER,
                        key(
                            "054a535a992921064d24e87160da387c7c35b5ddbc92bb81e41fa8404105448d",
                        ),
                    ],
                    recent_blockhash: BLOCKHASH,
                    instructions: [
                        {
                            program_id_index: 1,
                            accounts: [2, 3, 0],
                            data: "0x010203",
                        },
                    ],
                    address_table_lookups: [
                        {
                            account_key: key(
                                "d09e258ae6cf647b0e2441b43818bb9713c47f6351f87bef581f6f8346c9cc2a",
                            ),
                            writable_indexes: [0],
                            readonly_indexes: [1],
                        },
                    ],
                },
            },
        });
        expect(result).toEqual({ ok: true, payloadsHex: [V4_MESSAGE_HEX] });
    });
});

describe("svm proposals end to end", () => {
    it("verifies testnet proposal 5 and decodes nonce advance + transfer", () => {
        const data = extractOmniProposalData(
            proposal(P5_DESCRIPTION, P5_PAYLOAD),
            "testnet",
        );
        expect(data.verification.status).toBe("verified");
        expect(data.verification.recomputedPayloadsHex).toEqual([P5_PAYLOAD]);
        const decoded = decodeSvmUnsignedTx(
            JSON.parse(P5_DESCRIPTION).unsigned_tx,
        );
        expect(decoded?.feePayer).toBe(
            "FXTyp6DD7QcSLumbkiJ86uCGirNUETaWoSkhQ3Bx88JQ",
        );
        expect(decoded?.instructions[0].isNonceAdvance).toBe(true);
        expect(decoded?.instructions[1].decoded).toEqual({
            kind: "system-transfer",
            lamports: 10_000_000n,
            from: "FXTyp6DD7QcSLumbkiJ86uCGirNUETaWoSkhQ3Bx88JQ",
            to: "2hCKz5TNpxtZR6wpS8qZqSbh1pW59akjp54hHtj3akYX",
        });
    });

    it("flags a tampered lamports byte and a tampered recipient as MISMATCH", () => {
        const amount = P5_DESCRIPTION.replace(
            "0x020000008096980000000000",
            "0x020000008196980000000000",
        );
        expect(amount).not.toBe(P5_DESCRIPTION);
        const data = extractOmniProposalData(
            proposal(amount, P5_PAYLOAD),
            "testnet",
        );
        expect(data.verification.status).toBe("mismatch");
        expect(
            data.verification.checks.find((c) => c.id === "payload-bytes")
                ?.detail?.actual,
        ).toBe(P5_PAYLOAD);

        const recipient = P5_DESCRIPTION.replace(
            "2hCKz5TNpxtZR6wpS8qZqSbh1pW59akjp54hHtj3akYX",
            "FXTyp6DD7QcSLumbkiJ86uCGirNUETaWoSkhQ3Bx88JQ",
        );
        expect(
            extractOmniProposalData(proposal(recipient, P5_PAYLOAD), "testnet")
                .verification.status,
        ).toBe("mismatch");
    });

    it("flags a wrong derivation path as MISMATCH", () => {
        const data = extractOmniProposalData(
            proposal(P5_DESCRIPTION, P5_PAYLOAD, "omni-2"),
            "testnet",
        );
        expect(data.verification.status).toBe("mismatch");
        expect(
            data.verification.checks.find((c) => c.id === "path")?.state,
        ).toBe("fail");
    });
});

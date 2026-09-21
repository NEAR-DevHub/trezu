import { describe, expect, it } from "bun:test";
import { base58 } from "@scure/base";
import type { Proposal } from "@/lib/proposals-api";
import { bytesToHex } from "../bcs";
import { extractOmniProposalData } from "../verify";
import { decodeSuiTx } from "./decode";
import {
    encodeSuiTransaction,
    parseSuiUnsignedTx,
    suiPayloadsFromEnvelope,
    suiSigningDigestHex,
} from "./recompute";

/**
 * NEAR testnet DAO omni-e2e.sputnik-v2.testnet proposal 6 (InProgress),
 * VERIFIED by `omni proposal review`. 0.01 SUI transfer.
 */
const P6_DESCRIPTION =
    '{"omni":1,"intent":"SUI vector for trezu UI: do not approve","family":"sui","chain":"sui","path":"omni-1","unsigned_tx":{"sender_public_key":"d7d18c0d34ce4f0989df790c3ebe406db209573428ad5f3cfea61cbcec3e65b5","tx":{"expiration":"None","gas_data":{"budget":10000000,"owner":"0x0672aee8395afe7e242a304966a46755f1271ed175b2a829257aa7703e334acc","payment":[{"digest":"6paeDqevY5BtkVBmjiJQxawzJUeWJ8Pi5swbGuo9mWGk","object_id":"0xd4d1616cdcc44482d118116d01c24f39df099ca4aac42c3fe13fd0b10cddbe11","version":349181949}],"price":1000},"kind":{"ProgrammableTransaction":{"commands":[{"SplitCoins":{"amounts":[{"Input":0}],"coin":"GasCoin"}},{"TransferObjects":{"address":{"Input":1},"objects":[{"Result":0}]}}],"inputs":[{"Pure":"0x8096980000000000"},{"Pure":"0xd367c7ff1a7d38c2217f8e73c03fb023c7e6ac88a32fd771fd9bf5e223b8e7b8"}]}},"sender":"0x0672aee8395afe7e242a304966a46755f1271ed175b2a829257aa7703e334acc"}},"meta":{"builder_version":"0.1.1"}}';
const P6_PAYLOAD =
    "53f148af874d09713464469e3c2e19038997a1f21bfdb423ea04b65a938db7e7";

/** omni-transaction-rs golden vectors (src/sui/sui_transaction.rs). */
const V1_BCS_HEX =
    "000002000840420f000000000000200000000000000000000000000000000000000000000000000000000000000003020200010100000101020000010100000000000000000000000000000000000000000000000000000000000000000201000000000000000000000000000000000000000000000000000000000000000102000000000000002063636363636363636363636363636363636363636363636363636363636363630000000000000000000000000000000000000000000000000000000000000002e803000000000000404b4c000000000000";
const V1_DIGEST =
    "56bb898ff33187d573e7cc2a0124fe8940c94b74d1dedb5020548eb5b4c87c31";
const V2_BCS_HEX =
    "0000030101000000000000000000000000000000000000000000000000000000000000000601000000000000000101001111111111111111111111111111111111111111111111111111111111111111050000000000000020636363636363636363636363636363636363636363636363636363636363636300082a0000000000000001000000000000000000000000000000000000000000000000000000000000000002037061790573706c69740107000000000000000000000000000000000000000000000000000000000000000203737569035355490002010100010200000000000000000000000000000000000000000000000000000000000000000201000000000000000000000000000000000000000000000000000000000000000102000000000000002063636363636363636363636363636363636363636363636363636363636363630000000000000000000000000000000000000000000000000000000000000002ee020000000000008096980000000000016400000000000000";
const V2_DIGEST =
    "4b62d75d483e8720c77a08527eef73d8c52ad7d7d95eb520a6a8794e1e4ea03f";
const V3_BCS_HEX =
    "000002010222222222222222222222222222222222222222222222222222222222222222220700000000000000204242424242424242424242424242424242424242424242424242424242424242010000000000000000000000000000000000000000000000000000000000000000010200000000000000206363636363636363636363636363636363636363636363636363636363636363020300010101000501020000000000000000000000000000000000000000000000000000000000000000030200000000000000000000000000000000000000000000000000000000000000010200000000000000206363636363636363636363636363636363636363636363636363636363636363333333333333333333333333333333333333333333333333333333333333333309000000000000002042424242424242424242424242424242424242424242424242424242424242420000000000000000000000000000000000000000000000000000000000000003e80300000000000080841e000000000000";
const V3_DIGEST =
    "55aa30cf2d2ccf8601f260787b353fd8365a018ef4c13e6ea1c8e6f701ec1ae4";

const digest63 = base58.encode(new Uint8Array(32).fill(0x63));
const digest42 = base58.encode(new Uint8Array(32).fill(0x42));

const V1_TX = {
    sender_public_key: "00".repeat(32),
    tx: {
        kind: {
            ProgrammableTransaction: {
                inputs: [
                    { Pure: "0x40420f0000000000" },
                    { Pure: `0x${"00".repeat(31)}03` },
                ],
                commands: [
                    {
                        SplitCoins: {
                            coin: "GasCoin",
                            amounts: [{ Input: 0 }],
                        },
                    },
                    {
                        TransferObjects: {
                            objects: [{ Result: 0 }],
                            address: { Input: 1 },
                        },
                    },
                ],
            },
        },
        sender: "0x2",
        gas_data: {
            payment: [{ object_id: "0x1", version: 2, digest: digest63 }],
            owner: "0x2",
            price: 1000,
            budget: 5000000,
        },
        expiration: "None",
    },
};

const V2_TX = {
    tx: {
        kind: {
            ProgrammableTransaction: {
                inputs: [
                    {
                        Object: {
                            SharedObject: {
                                id: "0x6",
                                initial_shared_version: 1,
                                mutable: true,
                            },
                        },
                    },
                    {
                        Object: {
                            ImmOrOwnedObject: {
                                object_id: `0x${"11".repeat(32)}`,
                                version: "5",
                                digest: digest63,
                            },
                        },
                    },
                    { Pure: [42, 0, 0, 0, 0, 0, 0, 0] },
                ],
                commands: [
                    {
                        MoveCall: {
                            package: "0x2",
                            module: "pay",
                            function: "split",
                            type_arguments: [
                                {
                                    Struct: {
                                        address: "0x2",
                                        module: "sui",
                                        name: "SUI",
                                        type_params: [],
                                    },
                                },
                            ],
                            arguments: [{ Input: 1 }, { Input: 2 }],
                        },
                    },
                ],
            },
        },
        sender: "0x2",
        gas_data: {
            payment: [{ object_id: "0x1", version: 2, digest: digest63 }],
            owner: "0x2",
            price: 750,
            budget: "10000000",
        },
        expiration: { Epoch: 100 },
    },
};

const V3_TX = {
    tx: {
        kind: {
            ProgrammableTransaction: {
                inputs: [
                    {
                        Object: {
                            Receiving: {
                                object_id: `0x${"22".repeat(32)}`,
                                version: 7,
                                digest: digest42,
                            },
                        },
                    },
                    {
                        Object: {
                            ImmOrOwnedObject: {
                                object_id: "0x1",
                                version: 2,
                                digest: digest63,
                            },
                        },
                    },
                ],
                commands: [
                    {
                        MergeCoins: {
                            coin: "GasCoin",
                            coins_to_merge: [{ Input: 1 }],
                        },
                    },
                    { MakeMoveVec: { type_tag: "U64", elements: [] } },
                ],
            },
        },
        sender: "0x3",
        gas_data: {
            payment: [
                { object_id: "0x1", version: 2, digest: digest63 },
                {
                    object_id: `0x${"33".repeat(32)}`,
                    version: 9,
                    digest: digest42,
                },
            ],
            owner: "0x3",
            price: 1000,
            budget: 2000000,
        },
        expiration: "None",
    },
};

function proposal(
    description: string,
    payload: string,
    path = "omni-1",
): Proposal {
    return {
        id: 6,
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

describe("sui bcs + signing digest", () => {
    it("matches golden vector V1 (split + transfer)", () => {
        const parsed = parseSuiUnsignedTx(V1_TX);
        if (!parsed.ok) throw new Error(parsed.detail);
        expect(bytesToHex(encodeSuiTransaction(parsed.tx))).toBe(V1_BCS_HEX);
        expect(suiSigningDigestHex(parsed.tx)).toBe(V1_DIGEST);
    });

    it("matches golden vector V2 (shared + owned + pure inputs, MoveCall, epoch expiry)", () => {
        const parsed = parseSuiUnsignedTx(V2_TX);
        if (!parsed.ok) throw new Error(parsed.detail);
        expect(bytesToHex(encodeSuiTransaction(parsed.tx))).toBe(V2_BCS_HEX);
        expect(suiSigningDigestHex(parsed.tx)).toBe(V2_DIGEST);
    });

    it("matches golden vector V3 (receiving, merge, make_move_vec, two gas coins)", () => {
        const parsed = parseSuiUnsignedTx(V3_TX);
        if (!parsed.ok) throw new Error(parsed.detail);
        expect(bytesToHex(encodeSuiTransaction(parsed.tx))).toBe(V3_BCS_HEX);
        expect(suiSigningDigestHex(parsed.tx)).toBe(V3_DIGEST);
    });

    it("recomputes testnet proposal 6 byte-for-byte", () => {
        expect(
            suiPayloadsFromEnvelope(JSON.parse(P6_DESCRIPTION).unsigned_tx),
        ).toEqual({ ok: true, payloadsHex: [P6_PAYLOAD] });
    });

    it("rejects Publish/Upgrade, unknown kinds and malformed refs", () => {
        const publish = JSON.parse(P6_DESCRIPTION).unsigned_tx;
        publish.tx.kind.ProgrammableTransaction.commands.push({
            Publish: { modules: [], dependencies: [] },
        });
        expect(suiPayloadsFromEnvelope(publish)).toEqual({
            ok: false,
            reason: "unsupported-shape",
            detail: "unsupported command kind Publish",
        });
        expect(
            suiPayloadsFromEnvelope({
                tx: {
                    kind: { Other: {} },
                    sender: "0x1",
                    gas_data: {},
                    expiration: "None",
                },
            }),
        ).toEqual({
            ok: false,
            reason: "unsupported-shape",
            detail: "unsupported transaction kind Other",
        });
        const badDigest = JSON.parse(P6_DESCRIPTION).unsigned_tx;
        badDigest.tx.gas_data.payment[0].digest = "abc";
        expect(suiPayloadsFromEnvelope(badDigest)).toEqual({
            ok: false,
            reason: "invalid-field",
            detail: "tx.gas_data.payment[0].digest",
        });
        expect(suiPayloadsFromEnvelope({ tx: { kind: {} } })).toEqual({
            ok: false,
            reason: "unsupported-shape",
            detail: "missing field tx.sender",
        });
    });
});

describe("sui proposals end to end", () => {
    it("verifies testnet proposal 6 and decodes the transfer", () => {
        const data = extractOmniProposalData(
            proposal(P6_DESCRIPTION, P6_PAYLOAD),
            "testnet",
        );
        expect(data.verification.status).toBe("verified");
        const parsed = parseSuiUnsignedTx(
            JSON.parse(P6_DESCRIPTION).unsigned_tx,
        );
        if (!parsed.ok) throw new Error("unreachable");
        const decoded = decodeSuiTx(parsed.tx);
        expect(decoded.transfers).toEqual([
            {
                mist: 10_000_000n,
                to: "0xd367c7ff1a7d38c2217f8e73c03fb023c7e6ac88a32fd771fd9bf5e223b8e7b8",
            },
        ]);
        expect(decoded.gasBudget).toBe(10_000_000n);
        expect(decoded.gasPrice).toBe(1000n);
        expect(decoded.commands[0]).toBe(
            "SplitCoins GasCoin -> [10000000 MIST]",
        );
        expect(decoded.hasSharedObjects).toBe(false);
    });

    it("flags a tampered amount, a tampered recipient and a wrong path as MISMATCH", () => {
        const amount = P6_DESCRIPTION.replace(
            '"0x8096980000000000"',
            '"0x8196980000000000"',
        );
        expect(amount).not.toBe(P6_DESCRIPTION);
        const data = extractOmniProposalData(
            proposal(amount, P6_PAYLOAD),
            "testnet",
        );
        expect(data.verification.status).toBe("mismatch");
        expect(
            data.verification.checks.find((c) => c.id === "payload-bytes")
                ?.detail?.actual,
        ).toBe(P6_PAYLOAD);

        const recipient = P6_DESCRIPTION.replace("223b8e7b8", "223b8e7b9");
        expect(
            extractOmniProposalData(proposal(recipient, P6_PAYLOAD), "testnet")
                .verification.status,
        ).toBe("mismatch");

        const wrongPath = extractOmniProposalData(
            proposal(P6_DESCRIPTION, P6_PAYLOAD, "omni-2"),
            "testnet",
        );
        expect(wrongPath.verification.status).toBe("mismatch");
        expect(
            wrongPath.verification.checks.find((c) => c.id === "path")?.state,
        ).toBe("fail");
    });
});

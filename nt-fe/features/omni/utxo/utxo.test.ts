import { describe, expect, it } from "bun:test";
import type { Proposal } from "@/lib/proposals-api";
import { bytesToHex, hexToBytes } from "../bcs";
import { extractOmniProposalData } from "../verify";
import { decodeUtxoUnsignedTx } from "./decode";
import {
    bip143Preimage,
    p2wpkhScriptCode,
    p2wpkhScriptPubkey,
    sha256d,
    utxoInputSighashHex,
    utxoPayloadsFromEnvelope,
    varint,
} from "./recompute";

/**
 * NEAR testnet DAO omni-e2e.sputnik-v2.testnet proposal 4 (InProgress),
 * VERIFIED by `omni proposal review`. One P2WPKH input, recipient + change.
 */
const P4_DESCRIPTION =
    '{"omni":1,"intent":"BTC vector for trezu UI: do not approve","family":"utxo","chain":"btc","path":"omni-1","unsigned_tx":{"input_values":[192831],"sender_public_key":"0305890e47132c6e360100cb7d50473895778555fb543a42a790d3b618cade9b38","tx":{"inputs":[{"sequence":4294967293,"txid":"a7c11e4b58018150f94a22497abb0add471cde29ae2e83ac347a5725c8b8c0c5","vout":1}],"lock_time":0,"outputs":[{"script_pubkey":"0x00141088442812b585b82757b8210196428777ec0f73","value_sats":50000},{"script_pubkey":"0x001430a0f9876d272c1c6108688118a5a73033050acf","value_sats":142616}],"version":2}},"meta":{"builder_version":"0.1.1"}}';
const P4_PAYLOAD =
    "ff539417b96929dce995fbf4358ba029012eac669ca47d2044b57f1d90d1d625";

function proposal(
    description: string,
    payloads: string[],
    path = "omni-1",
): Proposal {
    return {
        id: 4,
        proposer: "omni-e2e-1789512353.testnet",
        description,
        kind: {
            FunctionCall: {
                receiver_id: "v1.signer-prod.testnet",
                actions: payloads.map((payload) => ({
                    method_name: "sign",
                    args: btoa(
                        JSON.stringify({
                            request: {
                                path,
                                payload_v2: { Ecdsa: payload },
                                domain_id: 0,
                            },
                        }),
                    ),
                    deposit: "1",
                    gas: "30000000000000",
                })),
            },
        },
        status: "InProgress",
        vote_counts: {},
        votes: {},
        submission_time: "1790000000000000000",
        last_actions_log: null,
    };
}

describe("bip143 sighash", () => {
    it("reproduces the BIP143 native P2WPKH example (input 1)", () => {
        // https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki, "Native P2WPKH"
        const tx = {
            version: 1,
            lockTime: 0x11,
            inputs: [
                {
                    txidDisplay: hexToBytes(
                        "9f96ade4b41d5433f4eda31e1738ec2b36f6e7d1420d94a6af99801a88f7f7ff",
                    ) as Uint8Array,
                    vout: 0,
                    sequence: 0xffffffee,
                },
                {
                    txidDisplay: hexToBytes(
                        "8ac60eb9575db5b2d987e29f301b5b819ea83a5c6579d282d189cc04b8e151ef",
                    ) as Uint8Array,
                    vout: 1,
                    sequence: 0xffffffff,
                },
            ],
            outputs: [
                {
                    valueSats: 112340000n,
                    scriptPubkey: hexToBytes(
                        "76a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac",
                    ) as Uint8Array,
                },
                {
                    valueSats: 223450000n,
                    scriptPubkey: hexToBytes(
                        "76a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac",
                    ) as Uint8Array,
                },
            ],
        };
        const key = hexToBytes(
            "025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357",
        ) as Uint8Array;
        const preimage = bip143Preimage(
            tx,
            1,
            600000000n,
            p2wpkhScriptCode(key),
        );
        expect(bytesToHex(preimage)).toBe(
            "01000000" +
                "96b827c8483d4e9b96712b6713a7b68d6e8003a781feba36c31143470b4efd37" +
                "52b0a642eea2fb7ae638c36f6252b6750293dbe574a806984b8e4d8548339a3b" +
                "ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a01000000" +
                "1976a9141d0f172a0ecb48aee1be1f2687d2963ae33f71a188ac" +
                "0046c32300000000" +
                "ffffffff" +
                "863ef3e1a92afbfdb97f31ad0fc7683ee943e9abcf2501590ff8f6551f47e5e5" +
                "11000000" +
                "01000000",
        );
        expect(utxoInputSighashHex(tx, 1, 600000000n, key)).toBe(
            "c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670",
        );
    });

    it("encodes varints and P2WPKH scripts", () => {
        expect(varint(0x19)).toEqual([0x19]);
        expect(varint(0xfd)).toEqual([0xfd, 0xfd, 0x00]);
        expect(varint(0x1234)).toEqual([0xfd, 0x34, 0x12]);
        const key = hexToBytes(
            "0305890e47132c6e360100cb7d50473895778555fb543a42a790d3b618cade9b38",
        ) as Uint8Array;
        // The change output of proposal 4 pays back to the sender key.
        expect(bytesToHex(p2wpkhScriptPubkey(key))).toBe(
            "001430a0f9876d272c1c6108688118a5a73033050acf",
        );
        expect(bytesToHex(p2wpkhScriptCode(key))).toBe(
            "76a91430a0f9876d272c1c6108688118a5a73033050acf88ac",
        );
        expect(bytesToHex(sha256d(new Uint8Array(0)))).toBe(
            "5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456",
        );
    });

    it("recomputes testnet proposal 4 byte-for-byte (one payload per input)", () => {
        expect(
            utxoPayloadsFromEnvelope(JSON.parse(P4_DESCRIPTION).unsigned_tx),
        ).toEqual({
            ok: true,
            payloadsHex: [P4_PAYLOAD],
        });
    });

    it("produces one sighash per input for multi-input transactions", () => {
        const raw = JSON.parse(P4_DESCRIPTION).unsigned_tx;
        raw.tx.inputs.push({ ...raw.tx.inputs[0], vout: 2 });
        raw.input_values.push(1000);
        const result = utxoPayloadsFromEnvelope(raw);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("unreachable");
        expect(result.payloadsHex).toHaveLength(2);
        expect(result.payloadsHex[0]).not.toBe(P4_PAYLOAD); // hashPrevouts changed
        expect(result.payloadsHex[0]).not.toBe(result.payloadsHex[1]);
    });

    it("rejects missing fields, mismatched input_values and bad keys", () => {
        expect(utxoPayloadsFromEnvelope({ tx: {} })).toEqual({
            ok: false,
            reason: "unsupported-shape",
            detail: "missing field input_values",
        });
        const short = JSON.parse(P4_DESCRIPTION).unsigned_tx;
        short.input_values = [];
        expect(utxoPayloadsFromEnvelope(short)).toEqual({
            ok: false,
            reason: "invalid-field",
            detail: "input_values",
        });
        const badKey = JSON.parse(P4_DESCRIPTION).unsigned_tx;
        badKey.sender_public_key = `04${"11".repeat(64)}`;
        expect(utxoPayloadsFromEnvelope(badKey)).toEqual({
            ok: false,
            reason: "invalid-field",
            detail: "sender_public_key",
        });
        const badTxid = JSON.parse(P4_DESCRIPTION).unsigned_tx;
        badTxid.tx.inputs[0].txid = "abc";
        expect(utxoPayloadsFromEnvelope(badTxid)).toEqual({
            ok: false,
            reason: "invalid-field",
            detail: "tx.inputs[0].txid",
        });
    });
});

describe("utxo proposals end to end", () => {
    it("verifies testnet proposal 4 and decodes recipient, change and fee", () => {
        const data = extractOmniProposalData(
            proposal(P4_DESCRIPTION, [P4_PAYLOAD]),
            "testnet",
        );
        expect(data.verification.status).toBe("verified");
        expect(
            data.verification.checks.find((c) => c.id === "payload-count")
                ?.state,
        ).toBe("pass");
        const decoded = decodeUtxoUnsignedTx(
            JSON.parse(P4_DESCRIPTION).unsigned_tx,
            "testnet",
        );
        expect(decoded?.outputs[0].address).toBe(
            "tb1qzzyyg2qjkkzmsf6hhqssr9jzsam7crmnfmnxhj",
        );
        expect(decoded?.outputs[0].isChange).toBe(false);
        expect(decoded?.outputs[1].address).toBe(
            "tb1qxzs0npmdyukpccggdzq33fd8xqes2zk009e3np",
        );
        expect(decoded?.outputs[1].isChange).toBe(true);
        expect(decoded?.feeSats).toBe(215n);
        expect(decoded?.inputs[0].sequence).toBe(0xfffffffd);
    });

    it("flags a wrong action count, a tampered output and a wrong path as MISMATCH", () => {
        const twoActions = extractOmniProposalData(
            proposal(P4_DESCRIPTION, [P4_PAYLOAD, P4_PAYLOAD]),
            "testnet",
        );
        expect(twoActions.verification.status).toBe("mismatch");
        expect(
            twoActions.verification.checks.find((c) => c.id === "payload-count")
                ?.state,
        ).toBe("fail");

        const tampered = P4_DESCRIPTION.replace(
            '"value_sats":50000',
            '"value_sats":50001',
        );
        expect(tampered).not.toBe(P4_DESCRIPTION);
        const data = extractOmniProposalData(
            proposal(tampered, [P4_PAYLOAD]),
            "testnet",
        );
        expect(data.verification.status).toBe("mismatch");
        expect(
            data.verification.checks.find((c) => c.id === "payload-bytes")
                ?.detail?.actual,
        ).toBe(P4_PAYLOAD);

        const recipient = P4_DESCRIPTION.replace(
            "1088442812b585b82757b8210196428777ec0f73",
            "1088442812b585b82757b8210196428777ec0f74",
        );
        expect(
            extractOmniProposalData(
                proposal(recipient, [P4_PAYLOAD]),
                "testnet",
            ).verification.status,
        ).toBe("mismatch");

        const wrongPath = extractOmniProposalData(
            proposal(P4_DESCRIPTION, [P4_PAYLOAD], "omni-2"),
            "testnet",
        );
        expect(wrongPath.verification.status).toBe("mismatch");
    });
});

import { describe, expect, it } from "bun:test";
import type { Proposal } from "@/lib/proposals-api";
import { hexToBytes } from "../bcs";
import { extractOmniProposalData } from "../verify";
import { Cell, CellBuilder, crc16Xmodem, TonAddress } from "./cell";
import {
    DEFAULT_V4R2_WALLET_ID,
    deriveWalletAddress,
    MAINNET_GLOBAL_ID,
    parseTonUnsignedTx,
    TESTNET_GLOBAL_ID,
    type TonTransaction,
    tonPayloadsFromEnvelope,
    tonSigningPayloadHex,
    v5r1WalletId,
    walletCodeCell,
    walletIdNetworkCheck,
} from "./recompute";

/** omni-transaction-rs spec vectors (src/ton/ton_transaction.rs, utils.rs). */
const VECTOR_PUBKEY = hexToBytes(
    "31debe55d37c722768b137131caa6087080b2e0b60b94bd785d14575cfa498bc",
) as Uint8Array;
const VECTOR_DEST = TonAddress.parse(
    "0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8",
) as TonAddress;
const VALID_UNTIL = 1_735_689_600;

function vectorTx(version: "V4R2" | "V5R1", mode: number): TonTransaction {
    return {
        walletVersion: version,
        workchain: 0,
        publicKey: VECTOR_PUBKEY,
        walletId:
            version === "V4R2"
                ? DEFAULT_V4R2_WALLET_ID
                : v5r1WalletId(MAINNET_GLOBAL_ID, 0, 0),
        validUntil: VALID_UNTIL,
        seqno: 1,
        messages: [
            {
                dest: VECTOR_DEST,
                destText: VECTOR_DEST.toRaw(),
                valueNanotons: 50_000_000n,
                bounce: true,
                mode,
                body: null,
                bodyText: null,
            },
        ],
        deploy: false,
    };
}

/**
 * NEAR testnet DAO omni-e2e.sputnik-v2.testnet proposal 3 (InProgress),
 * VERIFIED by `omni proposal review`. Receiver v1.signer-prod.testnet,
 * path omni-1, domain 1.
 */
const P3_DESCRIPTION =
    '{"omni":1,"intent":"TON vector for trezu UI: do not approve","family":"ton","chain":"ton","path":"omni-1","unsigned_tx":{"deploy":true,"messages":[{"body":null,"bounce":false,"dest":"EQAW9YzOnhMwoB2TGVkSi5fNFphjhyStvoSKgDRx87i7_QxU","mode":3,"value":"10000000"}],"public_key":[215,209,140,13,52,206,79,9,137,223,121,12,62,190,64,109,178,9,87,52,40,173,95,60,254,166,28,188,236,62,101,181],"seqno":0,"valid_until":1790724975,"wallet_id":2147483645,"wallet_version":"V5R1","workchain":0},"meta":{"builder_version":"0.1.1"}}';
const P3_PAYLOAD =
    "8083b17a5e67c2456cbaea70c6cbe1a67f8801d4e3f7676b8fc25fda94fac1ec";

function proposal(
    description: string,
    payload: string,
    path = "omni-1",
    receiver = "v1.signer-prod.testnet",
): Proposal {
    return {
        id: 3,
        proposer: "omni-e2e-1789512353.testnet",
        description,
        kind: {
            FunctionCall: {
                receiver_id: receiver,
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

describe("ton cells", () => {
    it("hashes the empty cell and a 7-bit cell like the spec", () => {
        expect(Cell.empty().hashHex()).toBe(
            "96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7",
        );
        const seven = new CellBuilder().storeUint(5, 7).build();
        expect(seven.bitLen).toBe(7);
        // 0000101 + completion tag 1 -> 0x0b
        expect(Array.from(seven.data)).toEqual([0x0b]);
    });

    it("parses and re-checks the embedded wallet code hashes", () => {
        expect(walletCodeCell("V4R2").hashHex()).toBe(
            "feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0",
        );
        expect(walletCodeCell("V5R1").hashHex()).toBe(
            "20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f",
        );
    });

    it("parses and renders user-friendly addresses", () => {
        expect(crc16Xmodem(new TextEncoder().encode("123456789"))).toBe(0x31c3);
        const friendly = TonAddress.parse(
            "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
        );
        expect(friendly?.toRaw()).toBe(VECTOR_DEST.toRaw());
        expect(VECTOR_DEST.toUserFriendly(true, false)).toBe(
            "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
        );
        expect(
            TonAddress.parse(
                "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2X",
            ),
        ).toBeNull(); // bad crc
    });

    it("computes v5r1 wallet ids", () => {
        expect(v5r1WalletId(MAINNET_GLOBAL_ID, 0, 0)).toBe(2147483409);
        expect(v5r1WalletId(TESTNET_GLOBAL_ID, 0, 0)).toBe(2147483645);
    });
});

describe("ton signing payload", () => {
    it("matches the v4r2 spec vector (address + unsigned body hash)", () => {
        const tx = vectorTx("V4R2", 1);
        expect(
            deriveWalletAddress(
                "V4R2",
                0,
                tx.walletId,
                VECTOR_PUBKEY,
            ).toUserFriendly(true, false),
        ).toBe("EQC6JyR14H1yKOHN1DKMo6XbBzTBXCznvZGE0rcB0fX6ZHPD");
        expect(tonSigningPayloadHex(tx)).toBe(
            "84d81f593253be4c06ab026b2e44e78fc5d9a98a634021fd68b9519d1e8f4b83",
        );
    });

    it("matches the v5r1 spec vector and force-ORs IGNORE_ERRORS into the mode", () => {
        const tx = vectorTx("V5R1", 1);
        expect(
            deriveWalletAddress(
                "V5R1",
                0,
                tx.walletId,
                VECTOR_PUBKEY,
            ).toUserFriendly(true, false),
        ).toBe("EQBYzXWenm06gusNRk6wLQwM_HO7Qs5-tVDwkPXp-ixZL-0W");
        expect(tonSigningPayloadHex(tx)).toBe(
            "0b45a74ddb8c4bd8f9a504b255869daad1bba81a1bd03351ea5ca1a3c47a2416",
        );
        expect(tonSigningPayloadHex(vectorTx("V5R1", 3))).toBe(
            tonSigningPayloadHex(tx),
        );
    });

    it("recomputes testnet proposal 3 (v5r1, deploy, non-bounceable) byte-for-byte", () => {
        const unsignedTx = JSON.parse(P3_DESCRIPTION).unsigned_tx;
        expect(tonPayloadsFromEnvelope(unsignedTx)).toEqual({
            ok: true,
            payloadsHex: [P3_PAYLOAD],
        });
        const parsed = parseTonUnsignedTx(unsignedTx);
        if (!parsed.ok) throw new Error("unreachable");
        const address = deriveWalletAddress(
            "V5R1",
            0,
            parsed.tx.walletId,
            parsed.tx.publicKey,
        );
        expect(address.toUserFriendly(false, true)).toBe(
            "0QCTutFMrPe_VXn__js9jKGMTWtB8p5MGFVF4PbcPeNbF9-3",
        );
        expect(walletIdNetworkCheck(parsed.tx, "testnet").state).toBe("pass");
        expect(walletIdNetworkCheck(parsed.tx, "mainnet").state).toBe("fail");
    });

    it("accepts a hex public key and a text-comment body", () => {
        const raw = JSON.parse(P3_DESCRIPTION).unsigned_tx;
        raw.public_key =
            "d7d18c0d34ce4f0989df790c3ebe406db209573428ad5f3cfea61cbcec3e65b5";
        expect(tonPayloadsFromEnvelope(raw)).toEqual({
            ok: true,
            payloadsHex: [P3_PAYLOAD],
        });
        // comment cell "hi": u32 0 + "hi" -> BoC b5ee9c72 01 01 01 01 00 08 00 0c 00000000 6869
        raw.messages[0].body = "b5ee9c7201010101000800000c0000000068690000";
        const withBody = tonPayloadsFromEnvelope(raw);
        expect(withBody.ok).toBe(true);
        if (!withBody.ok) throw new Error("unreachable");
        expect(withBody.payloadsHex[0]).not.toBe(P3_PAYLOAD);
    });

    it("rejects missing fields, bad addresses and too many v4r2 messages", () => {
        const missing = tonPayloadsFromEnvelope({ messages: [] });
        expect(missing).toEqual({
            ok: false,
            reason: "unsupported-shape",
            detail: "missing field public_key",
        });
        const raw = JSON.parse(P3_DESCRIPTION).unsigned_tx;
        raw.messages[0].dest = "not-an-address";
        expect(tonPayloadsFromEnvelope(raw)).toEqual({
            ok: false,
            reason: "invalid-field",
            detail: "messages[0].dest",
        });
        const v4 = JSON.parse(P3_DESCRIPTION).unsigned_tx;
        v4.wallet_version = "V4R2";
        v4.messages = Array(5).fill(v4.messages[0]);
        expect(tonPayloadsFromEnvelope(v4)).toEqual({
            ok: false,
            reason: "invalid-field",
            detail: "messages.length",
        });
    });
});

describe("ton proposals end to end", () => {
    it("verifies testnet proposal 3 on testnet and flags wallet id / receiver on mainnet", () => {
        const ok = extractOmniProposalData(
            proposal(P3_DESCRIPTION, P3_PAYLOAD),
            "testnet",
        );
        expect(ok.verification.status).toBe("verified");
        expect(
            ok.verification.checks.find((c) => c.id === "chain-id")?.state,
        ).toBe("pass");

        const asMainnet = extractOmniProposalData(
            proposal(P3_DESCRIPTION, P3_PAYLOAD, "omni-1", "v1.signer"),
            "mainnet",
        );
        expect(asMainnet.verification.status).toBe("mismatch");
        const chainId = asMainnet.verification.checks.find(
            (c) => c.id === "chain-id",
        );
        expect(chainId?.state).toBe("fail");
        expect(chainId?.detail?.actual).toBe("2147483645");
        expect(chainId?.detail?.expected).toBe(2147483409);
    });

    it("flags a tampered amount byte as MISMATCH", () => {
        const tampered = P3_DESCRIPTION.replace(
            '"value":"10000000"',
            '"value":"10000001"',
        );
        expect(tampered).not.toBe(P3_DESCRIPTION);
        const data = extractOmniProposalData(
            proposal(tampered, P3_PAYLOAD),
            "testnet",
        );
        expect(data.verification.status).toBe("mismatch");
        const bytes = data.verification.checks.find(
            (c) => c.id === "payload-bytes",
        );
        expect(bytes?.state).toBe("fail");
        expect(bytes?.detail?.actual).toBe(P3_PAYLOAD);
    });

    it("flags a tampered destination and a wrong path as MISMATCH", () => {
        const tampered = P3_DESCRIPTION.replace(
            "EQAW9YzOnhMwoB2TGVkSi5fNFphjhyStvoSKgDRx87i7_QxU",
            "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
        );
        expect(
            extractOmniProposalData(proposal(tampered, P3_PAYLOAD), "testnet")
                .verification.status,
        ).toBe("mismatch");
        const wrongPath = extractOmniProposalData(
            proposal(P3_DESCRIPTION, P3_PAYLOAD, "omni-2"),
            "testnet",
        );
        expect(wrongPath.verification.status).toBe("mismatch");
        expect(
            wrongPath.verification.checks.find((c) => c.id === "path")?.state,
        ).toBe("fail");
    });
});

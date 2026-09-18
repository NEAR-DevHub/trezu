import { describe, expect, it } from "bun:test";
import type { Proposal } from "@/lib/proposals-api";
import { hasOmniMarker, parseEnvelope } from "./envelope";
import { evmSigningPayloadHex, parseEvmUnsignedTx } from "./evm/sighash";
import { decodeSignActions } from "./sign-actions";
import { extractOmniProposalData, verifyOmniProposal } from "./verify";

/**
 * Proposal 10 on testing-treasury-frolik.sputnik-dao.near (NEAR mainnet), as
 * returned by `get_proposal`. The MPC payload in the sign action is the
 * keccak256 of the EIP-1559 signing RLP of `unsigned_tx`.
 */
const PROPOSAL_10_UNSIGNED_TX = {
    chain_id: 42161,
    gas_limit: "102182",
    input: "0x31f57d2200000000000000000000000025118290e6a5f4139381d072181157035864099d",
    max_fee_per_gas: "100000000",
    max_priority_fee_per_gas: "0",
    nonce: 3,
    to: "0xd025b38762B4A4E36F0Cde483b86CB13ea00D989",
    value: "0",
};

const PROPOSAL_10_PAYLOAD =
    "b49a0a0051a71e12cbabdd8d47fbbb73bff1e642bee7111d3ebb2f0b0af42b19";

function envelopeDescription(
    overrides: Record<string, unknown> = {},
    unsignedTxOverrides: Record<string, unknown> = {},
): string {
    return JSON.stringify({
        omni: 1,
        intent: "log metedata",
        family: "evm",
        chain: "arb",
        path: "omni-1",
        unsigned_tx: { ...PROPOSAL_10_UNSIGNED_TX, ...unsignedTxOverrides },
        meta: { builder_version: "0.1.1" },
        ...overrides,
    });
}

function signArgs(
    path = "omni-1",
    payload = PROPOSAL_10_PAYLOAD,
    domainId = 0,
    scheme: "Ecdsa" | "Eddsa" = "Ecdsa",
): string {
    return btoa(
        JSON.stringify({
            request: {
                path,
                payload_v2: { [scheme]: payload },
                domain_id: domainId,
            },
        }),
    );
}

function proposal(
    description: string,
    actions: Array<{ method_name?: string; args: string }> = [
        { args: signArgs() },
    ],
    receiverId = "v1.signer",
): Proposal {
    return {
        id: 10,
        proposer: "frolik.near",
        description,
        kind: {
            FunctionCall: {
                receiver_id: receiverId,
                actions: actions.map((a) => ({
                    method_name: a.method_name ?? "sign",
                    args: a.args,
                    deposit: "1",
                    gas: "30000000000000",
                })),
            },
        },
        status: "Approved",
        vote_counts: {},
        votes: { "frolik.near": "Approve" },
        submission_time: "1789054171328327490",
        last_actions_log: null,
    };
}

describe("evm signing payload", () => {
    it("recomputes the proposal 10 payload byte-for-byte", () => {
        const parsed = parseEvmUnsignedTx(PROPOSAL_10_UNSIGNED_TX);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error("unreachable");
        expect(parsed.tx.value).toBe(0n);
        expect(parsed.tx.gasLimit).toBe(102182n);
        expect(evmSigningPayloadHex(parsed.tx)).toBe(PROPOSAL_10_PAYLOAD);
    });

    it("rejects the legacy byte-array serde form", () => {
        const parsed = parseEvmUnsignedTx({
            ...PROPOSAL_10_UNSIGNED_TX,
            to: [1, 2, 3],
            input: [],
        });
        expect(parsed.ok).toBe(false);
        if (parsed.ok) throw new Error("unreachable");
        expect(parsed.reason).toBe("unsupported-shape");
    });

    it("rejects non-decimal amount fields with the field name", () => {
        for (const [key, bad] of [
            ["value", "0x10"],
            ["value", "-1"],
            ["value", ""],
            ["value", " 1"],
            ["value", "1e3"],
            ["gas_limit", "1.5"],
            ["max_fee_per_gas", null],
            ["max_priority_fee_per_gas", true],
            ["nonce", "3"],
            ["chain_id", -1],
        ] as Array<[string, unknown]>) {
            const parsed = parseEvmUnsignedTx({
                ...PROPOSAL_10_UNSIGNED_TX,
                [key]: bad,
            });
            if (key === "nonce" && bad === "3") {
                // decimal strings are accepted for every integer field
                expect(parsed.ok).toBe(true);
                continue;
            }
            expect(parsed.ok).toBe(false);
            if (parsed.ok) throw new Error("unreachable");
            expect(parsed.reason).toBe("invalid-field");
            expect(parsed.detail).toBe(key);
        }
    });

    it("reports contract creation (empty to) as unsupported, never throws", () => {
        const parsed = parseEvmUnsignedTx({
            ...PROPOSAL_10_UNSIGNED_TX,
            to: "",
        });
        expect(parsed.ok).toBe(false);
        if (parsed.ok) throw new Error("unreachable");
        expect(parsed.reason).toBe("contract-creation");
        const data = extractOmniProposalData(
            proposal(envelopeDescription({}, { to: "" })),
            "mainnet",
        );
        expect(data.verification.status).toBe("unverified");
        expect(data.verification.unverifiedReason).toBe("contract-creation");
    });

    it("rejects a malformed address and non-hex input", () => {
        const badTo = parseEvmUnsignedTx({
            ...PROPOSAL_10_UNSIGNED_TX,
            to: "0x1234",
        });
        expect(badTo.ok).toBe(false);
        if (badTo.ok) throw new Error("unreachable");
        expect(badTo.detail).toBe("to");

        const badInput = parseEvmUnsignedTx({
            ...PROPOSAL_10_UNSIGNED_TX,
            input: "0xzz",
        });
        expect(badInput.ok).toBe(false);
        if (badInput.ok) throw new Error("unreachable");
        expect(badInput.detail).toBe("input");
    });
});

describe("envelope parsing", () => {
    it("parses the proposal 10 description", () => {
        const result = parseEnvelope(envelopeDescription());
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("unreachable");
        expect(result.envelope.chain).toBe("arb");
        expect(result.envelope.path).toBe("omni-1");
        expect(result.envelope.meta.builder_version).toBe("0.1.1");
    });

    it("detects the marker without validating the rest", () => {
        expect(hasOmniMarker(envelopeDescription())).toBe(true);
        expect(hasOmniMarker('{"omni":1}')).toBe(true);
        expect(hasOmniMarker("* Proposal Action: confidential")).toBe(false);
        expect(hasOmniMarker('{"proposal action":"confidential"}')).toBe(false);
        expect(hasOmniMarker("")).toBe(false);
        expect(hasOmniMarker("not json {")).toBe(false);
    });

    it("reports invalid JSON, missing fields and oversize envelopes", () => {
        const notJson = parseEnvelope("{omni: 1");
        expect(notJson.ok).toBe(false);
        if (notJson.ok) throw new Error("unreachable");
        expect(notJson.reason).toBe("not-json");

        const missing = parseEnvelope('{"omni":1,"intent":"x"}');
        expect(missing.ok).toBe(false);
        if (missing.ok) throw new Error("unreachable");
        expect(missing.reason).toBe("missing-fields");
        expect(missing.missing).toEqual([
            "family",
            "chain",
            "path",
            "unsigned_tx",
        ]);

        const huge = parseEnvelope(
            envelopeDescription({ intent: "x".repeat(17 * 1024) }),
        );
        expect(huge.ok).toBe(false);
        if (huge.ok) throw new Error("unreachable");
        expect(huge.reason).toBe("too-large");
    });
});

/**
 * Proposal 0 on omni-e2e.sputnik-v2.testnet (NEAR testnet), fetched via
 * get_proposal on 2026-09-15. A plain 0.0001 ETH transfer on Arbitrum
 * Sepolia (empty calldata), approved and broadcast as
 * 0xf72b84430f92f89d992ef95d116400c8b20b9d7c0ccb7bfabce331a867c2af64.
 */
const TESTNET_PROPOSAL_0: Proposal = {
    id: 0,
    proposer: "omni-e2e-1789512353.testnet",
    description:
        '{"omni":1,"intent":"e2e: DAO route NEAR testnet -> Arbitrum Sepolia","family":"evm","chain":"arb","path":"omni-1","unsigned_tx":{"chain_id":421614,"gas_limit":"27939","input":"0x","max_fee_per_gas":"1236260000","max_priority_fee_per_gas":"0","nonce":0,"to":"0x04a129676cDe2510C4FD19C2759eb5B81952e676","value":"100000000000000"},"meta":{"builder_version":"0.1.1"}}',
    kind: {
        FunctionCall: {
            receiver_id: "v1.signer-prod.testnet",
            actions: [
                {
                    method_name: "sign",
                    args: "eyJyZXF1ZXN0Ijp7InBhdGgiOiJvbW5pLTEiLCJwYXlsb2FkX3YyIjp7IkVjZHNhIjoiMWJjMDdmZjljM2FlMTEzNWY2M2ZiZDZkZjM0YWMzNGEwYzVkMzRkYTA3OThkZTZkOGE3MTZkNDlhYTE2ZmM2OCJ9LCJkb21haW5faWQiOjB9fQ==",
                    deposit: "1",
                    gas: "30000000000000",
                },
            ],
        },
    },
    status: "Approved",
    vote_counts: { council: [1, 0, 0] },
    votes: { "omni-e2e-1789512353.testnet": "Approve" },
    submission_time: "1789513804989898655",
    last_actions_log: null,
};

describe("verifyOmniProposal", () => {
    it("verifies testnet proposal 0 (Arbitrum Sepolia, empty calldata) on testnet only", () => {
        const data = extractOmniProposalData(TESTNET_PROPOSAL_0, "testnet");
        expect(data.verification.status).toBe("verified");
        expect(data.verification.recomputedPayloadsHex).toEqual([
            "1bc07ff9c3ae1135f63fbd6df34ac34a0c5d34da0798de6d8a716d49aa16fc68",
        ]);
        expect(data.parsed.ok).toBe(true);
        if (!data.parsed.ok) throw new Error("unreachable");
        const tx = parseEvmUnsignedTx(data.parsed.envelope.unsigned_tx);
        if (!tx.ok) throw new Error("unreachable");
        expect(tx.tx.value).toBe(100000000000000n);
        expect(tx.tx.input).toBe("0x");

        // The same proposal read as mainnet fails receiver and chain-id checks.
        const asMainnet = extractOmniProposalData(
            TESTNET_PROPOSAL_0,
            "mainnet",
        );
        expect(asMainnet.verification.status).toBe("mismatch");
        expect(asMainnet.verification.notPlainSignRequest).toBe(true);
        expect(
            asMainnet.verification.checks.find((c) => c.id === "chain-id")
                ?.state,
        ).toBe("fail");
    });

    it("verifies proposal 10", () => {
        const data = extractOmniProposalData(
            proposal(envelopeDescription()),
            "mainnet",
        );
        expect(data.verification.status).toBe("verified");
        expect(data.verification.notPlainSignRequest).toBe(false);
        expect(
            data.verification.checks.map((c) => `${c.id}:${c.state}`),
        ).toEqual([
            "receiver:pass",
            "methods:pass",
            "path:pass",
            "domain:pass",
            "chain-id:pass",
            "payload-count:pass",
            "payload-bytes:pass",
        ]);
        expect(data.verification.recomputedPayloadsHex).toEqual([
            PROPOSAL_10_PAYLOAD,
        ]);
    });

    it("flags a tampered calldata byte as a payload mismatch", () => {
        const tampered = envelopeDescription(
            {},
            {
                input: PROPOSAL_10_UNSIGNED_TX.input.replace(/9d$/, "9e"),
            },
        );
        const data = extractOmniProposalData(proposal(tampered), "mainnet");
        expect(data.verification.status).toBe("mismatch");
        const bytes = data.verification.checks.find(
            (c) => c.id === "payload-bytes",
        );
        expect(bytes?.state).toBe("fail");
        expect(bytes?.detail?.actual).toBe(PROPOSAL_10_PAYLOAD);
        expect(bytes?.detail?.expected).not.toBe(PROPOSAL_10_PAYLOAD);
    });

    it("flags a derivation path mismatch", () => {
        const data = extractOmniProposalData(
            proposal(envelopeDescription(), [{ args: signArgs("omni-2") }]),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
        const path = data.verification.checks.find((c) => c.id === "path");
        expect(path?.state).toBe("fail");
        expect(path?.detail?.expected).toBe("omni-1");
        expect(path?.detail?.actual).toBe("omni-2");
    });

    it("flags a key domain mismatch", () => {
        const data = extractOmniProposalData(
            proposal(envelopeDescription(), [
                { args: signArgs("omni-1", PROPOSAL_10_PAYLOAD, 1, "Eddsa") },
            ]),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
        expect(
            data.verification.checks.find((c) => c.id === "domain")?.state,
        ).toBe("fail");
    });

    it("flags an action count mismatch", () => {
        const data = extractOmniProposalData(
            proposal(envelopeDescription(), [
                { args: signArgs() },
                { args: signArgs() },
            ]),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
        expect(
            data.verification.checks.find((c) => c.id === "payload-count")
                ?.state,
        ).toBe("fail");
    });

    it("flags a registry chain id mismatch (arb envelope, Base chain_id)", () => {
        const data = extractOmniProposalData(
            proposal(envelopeDescription({}, { chain_id: 8453 })),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
        const chainId = data.verification.checks.find(
            (c) => c.id === "chain-id",
        );
        expect(chainId?.state).toBe("fail");
        expect(chainId?.detail?.expected).toBe(42161);
        expect(chainId?.detail?.actual).toBe("8453");
    });

    it("marks a wrong receiver as NOT a plain chain-signature request", () => {
        const data = extractOmniProposalData(
            proposal(
                envelopeDescription(),
                [{ args: signArgs() }],
                "evil.near",
            ),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
        expect(data.verification.notPlainSignRequest).toBe(true);
        expect(
            data.verification.checks.find((c) => c.id === "receiver")?.state,
        ).toBe("fail");
    });

    it("marks non-sign actions as NOT a plain chain-signature request", () => {
        const data = extractOmniProposalData(
            proposal(envelopeDescription(), [
                { args: signArgs() },
                { method_name: "ft_transfer", args: btoa("{}") },
            ]),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
        expect(data.verification.notPlainSignRequest).toBe(true);
    });

    it("uses the testnet MPC contract on testnet", () => {
        const data = extractOmniProposalData(
            proposal(
                envelopeDescription({}, { chain_id: 421614 }),
                [{ args: signArgs() }],
                "v1.signer-prod.testnet",
            ),
            "testnet",
        );
        expect(
            data.verification.checks.find((c) => c.id === "receiver")?.state,
        ).toBe("pass");
        expect(
            data.verification.checks.find((c) => c.id === "chain-id")?.state,
        ).toBe("pass");
    });

    it("renders an unknown family as UNVERIFIED, not a crash", () => {
        const data = extractOmniProposalData(
            proposal(
                envelopeDescription({ family: "zec", chain: "zcash" }, {}),
                [{ args: signArgs() }],
            ),
            "mainnet",
        );
        expect(data.verification.status).toBe("unverified");
        expect(data.verification.unverifiedReason).toBe("unsupported-family");
        expect(data.verification.proposalPayloadsHex).toEqual([
            PROPOSAL_10_PAYLOAD,
        ]);
    });

    it("renders an unknown chain key as UNVERIFIED", () => {
        const data = extractOmniProposalData(
            proposal(envelopeDescription({ chain: "optimism" })),
            "mainnet",
        );
        expect(data.verification.status).toBe("unverified");
        expect(data.verification.unverifiedReason).toBe("unknown-chain");
        // Payload still matched: the unsigned_tx is internally consistent.
        expect(
            data.verification.checks.find((c) => c.id === "payload-bytes")
                ?.state,
        ).toBe("pass");
    });

    it("renders an unparseable unsigned_tx as UNVERIFIED with the payload shown", () => {
        const eddsa = "ab".repeat(32);
        const data = extractOmniProposalData(
            proposal(
                envelopeDescription(
                    { family: "utxo", chain: "btc" },
                    { tx: {} },
                ),
                [{ args: signArgs("omni-1", eddsa, 0, "Ecdsa") }],
            ),
            "mainnet",
        );
        expect(data.verification.status).toBe("unverified");
        expect(data.verification.unverifiedReason).toBe("unsupported-shape");
        expect(data.verification.proposalPayloadsHex).toEqual([eddsa]);
        expect(
            data.verification.checks.find((c) => c.id === "domain")?.state,
        ).toBe("pass");
    });

    it("renders the legacy byte-array unsigned_tx as UNVERIFIED", () => {
        const data = extractOmniProposalData(
            proposal(envelopeDescription({}, { to: [1, 2, 3], input: [] })),
            "mainnet",
        );
        expect(data.verification.status).toBe("unverified");
        expect(data.verification.unverifiedReason).toBe("unsupported-shape");
    });

    it("handles invalid JSON and a huge description without throwing", () => {
        const broken = extractOmniProposalData(
            proposal('{"omni":1, broken'),
            "mainnet",
        );
        expect(broken.verification.status).toBe("unverified");
        expect(broken.verification.unverifiedReason).toBe("envelope");
        expect(broken.parsed.ok).toBe(false);

        const huge = extractOmniProposalData(
            proposal(envelopeDescription({ intent: "y".repeat(20_000) })),
            "mainnet",
        );
        expect(huge.verification.status).toBe("unverified");
        if (huge.parsed.ok) throw new Error("unreachable");
        expect(huge.parsed.reason).toBe("too-large");
    });

    it("accepts a 0x-prefixed or upper-case payload and rejects odd-length or short hex", () => {
        const prefixed = extractOmniProposalData(
            proposal(envelopeDescription(), [
                {
                    args: signArgs(
                        "omni-1",
                        `0x${PROPOSAL_10_PAYLOAD.toUpperCase()}`,
                    ),
                },
            ]),
            "mainnet",
        );
        expect(prefixed.verification.status).toBe("verified");

        const short = extractOmniProposalData(
            proposal(envelopeDescription(), [
                { args: signArgs("omni-1", PROPOSAL_10_PAYLOAD.slice(2)) },
            ]),
            "mainnet",
        );
        expect(short.verification.status).toBe("mismatch");
        expect(short.actions[0].payloadHex).toHaveLength(62);

        const odd = decodeSignActions([
            {
                method_name: "sign",
                args: signArgs("omni-1", "abc"),
                deposit: "1",
                gas: "1",
            },
        ]);
        expect(odd[0].payloadHex).toBeNull();
    });

    it("verifies a non-ASCII derivation path (UTF-8 safe base64 decode)", () => {
        const path = "казна-🏦-1";
        const args = new TextEncoder().encode(
            JSON.stringify({
                request: {
                    path,
                    payload_v2: { Ecdsa: PROPOSAL_10_PAYLOAD },
                    domain_id: 0,
                },
            }),
        );
        const base64 = btoa(String.fromCharCode(...args));
        const data = extractOmniProposalData(
            proposal(envelopeDescription({ path }), [{ args: base64 }]),
            "mainnet",
        );
        expect(data.actions[0].path).toBe(path);
        expect(
            data.verification.checks.find((c) => c.id === "path")?.state,
        ).toBe("pass");
        expect(data.verification.status).toBe("verified");
    });

    it("treats an unknown envelope version as UNVERIFIED without applying v1 rules", () => {
        const data = extractOmniProposalData(
            proposal(envelopeDescription({ omni: 2 })),
            "mainnet",
        );
        expect(data.parsed.ok).toBe(true);
        expect(data.verification.status).toBe("unverified");
        expect(data.verification.unverifiedReason).toBe(
            "unsupported-envelope-version",
        );
        expect(data.verification.unverifiedDetail).toBe("2");
        expect(
            data.verification.checks
                .filter((c) => c.id !== "receiver" && c.id !== "methods")
                .every((c) => c.state === "skip"),
        ).toBe(true);
        // A bad receiver still wins over the version problem.
        const evil = extractOmniProposalData(
            proposal(
                envelopeDescription({ omni: 2 }),
                [{ args: signArgs() }],
                "evil.near",
            ),
            "mainnet",
        );
        expect(evil.verification.status).toBe("mismatch");
    });

    it("hashes `to` case-insensitively (lowercase and wrong-case checksum)", () => {
        const lower = PROPOSAL_10_UNSIGNED_TX.to.toLowerCase();
        // Flip the case of the last hex letters so the EIP-55 checksum is wrong.
        const wrongCase = PROPOSAL_10_UNSIGNED_TX.to.replace(/D989$/, "d989");
        expect(wrongCase).not.toBe(PROPOSAL_10_UNSIGNED_TX.to);
        for (const to of [lower, wrongCase]) {
            const parsed = parseEvmUnsignedTx({
                ...PROPOSAL_10_UNSIGNED_TX,
                to,
            });
            expect(parsed.ok).toBe(true);
            if (!parsed.ok) throw new Error("unreachable");
            expect(evmSigningPayloadHex(parsed.tx)).toBe(PROPOSAL_10_PAYLOAD);
            // Display form is always the checksummed address.
            expect(parsed.tx.to).toBe(
                PROPOSAL_10_UNSIGNED_TX.to as `0x${string}`,
            );
            const data = extractOmniProposalData(
                proposal(envelopeDescription({}, { to })),
                "mainnet",
            );
            expect(data.verification.status).toBe("verified");
        }
    });

    it("tolerates malformed sign args", () => {
        const actions = decodeSignActions([
            {
                method_name: "sign",
                args: "%%%not-base64%%%",
                deposit: "1",
                gas: "1",
            },
        ]);
        expect(actions[0].argsDecodeError).toBe(true);
        expect(actions[0].payloadHex).toBeNull();
        const result = verifyOmniProposal(
            "v1.signer",
            actions,
            parseEnvelope(envelopeDescription()),
            "mainnet",
        );
        expect(result.status).toBe("mismatch");
    });
});

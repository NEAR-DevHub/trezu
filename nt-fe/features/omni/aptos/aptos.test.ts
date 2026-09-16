import { describe, expect, it } from "bun:test";
import type { Proposal } from "@/lib/proposals-api";
import { bytesToHex } from "../bcs";
import { extractOmniProposalData } from "../verify";
import { decodeAptosTx } from "./decode";
import {
    APTOS_RAW_TRANSACTION_SALT_HASH_HEX,
    aptosPayloadsFromEnvelope,
    aptosSigningPayloadHex,
    encodeAptosRawTransaction,
    formatAptosTypeTag,
    parseAptosTypeTag,
    parseAptosUnsignedTx,
} from "./recompute";

/**
 * Mainnet vectors from testing-treasury-frolik.sputnik-dao.near, proposals
 * 6 and 7 (both VERIFIED by `omni proposal review`). Receiver v1.signer,
 * path omni-1, domain 1.
 */
const P6_DESCRIPTION =
    '{"omni":1,"intent":"calling log_metadata on aptos","family":"aptos","chain":"aptos","path":"omni-1","unsigned_tx":{"sender_public_key":"8bfb6698b0005ed7e0ca9cecbc39380b18ebd6fb52c973f5b40ddcf5fc720cde","tx":{"chain_id":1,"expiration_timestamp_secs":"1790253336","gas_unit_price":"150","max_gas_amount":"8010","payload":{"EntryFunction":{"args":["0xc9a5d270bb8bb47e7bb34377ceb529db2878e4a7b521b5b8a984b35f8feaa8e2"],"function":"log_metadata","module":{"address":"0xe4ec15f237e5a8c7daa7a34ece28e2bd2c079360763f181bf65862ec148b914a","name":"omni_bridge"},"ty_args":[]}},"sender":"0x97bc559ecc97a4df7bbb4f7a58848d85c648d7e505ab027d9f3e1601bd35aab7","sequence_number":"0"}},"meta":{"builder_version":"0.1.0"}}';
const P6_PAYLOAD =
    "b5e97db07fa0bd0e5598aa3643a9bc6f6693bddc1a9fec9e674a461eaa00b19397bc559ecc97a4df7bbb4f7a58848d85c648d7e505ab027d9f3e1601bd35aab7000000000000000002e4ec15f237e5a8c7daa7a34ece28e2bd2c079360763f181bf65862ec148b914a0b6f6d6e695f6272696467650c6c6f675f6d65746164617461000120c9a5d270bb8bb47e7bb34377ceb529db2878e4a7b521b5b8a984b35f8feaa8e24a1f00000000000096000000000000001819b56a0000000001";

const P7_DESCRIPTION =
    '{"omni":1,"intent":"sending tokens back to aptos","family":"aptos","chain":"aptos","path":"omni-1","unsigned_tx":{"sender_public_key":"8bfb6698b0005ed7e0ca9cecbc39380b18ebd6fb52c973f5b40ddcf5fc720cde","tx":{"chain_id":1,"expiration_timestamp_secs":"1790253701","gas_unit_price":"150","max_gas_amount":"8010","payload":{"EntryFunction":{"args":["0xd8ccdb46922efc8b7fb8aa1eaffa02f0ec6d4d6efcd58b5097b4dc67655e9b49","0xc09ee60500000000"],"function":"transfer","module":{"address":"0x0000000000000000000000000000000000000000000000000000000000000001","name":"aptos_account"},"ty_args":[]}},"sender":"0x97bc559ecc97a4df7bbb4f7a58848d85c648d7e505ab027d9f3e1601bd35aab7","sequence_number":"1"}},"meta":{"builder_version":"0.1.0"}}';
const P7_PAYLOAD =
    "b5e97db07fa0bd0e5598aa3643a9bc6f6693bddc1a9fec9e674a461eaa00b19397bc559ecc97a4df7bbb4f7a58848d85c648d7e505ab027d9f3e1601bd35aab701000000000000000200000000000000000000000000000000000000000000000000000000000000010d6170746f735f6163636f756e74087472616e73666572000220d8ccdb46922efc8b7fb8aa1eaffa02f0ec6d4d6efcd58b5097b4dc67655e9b4908c09ee605000000004a1f0000000000009600000000000000851ab56a0000000001";

function signArgs(path: string, payload: string): string {
    return btoa(
        JSON.stringify({
            request: { path, payload_v2: { Eddsa: payload }, domain_id: 1 },
        }),
    );
}

function proposal(
    id: number,
    description: string,
    payload: string,
    path = "omni-1",
): Proposal {
    return {
        id,
        proposer: "frolik.near",
        description,
        kind: {
            FunctionCall: {
                receiver_id: "v1.signer",
                actions: [
                    {
                        method_name: "sign",
                        args: signArgs(path, payload),
                        deposit: "1",
                        gas: "30000000000000",
                    },
                ],
            },
        },
        status: "Approved",
        vote_counts: {},
        votes: {},
        submission_time: "1790000000000000000",
        last_actions_log: null,
    };
}

function unsignedTx(description: string): unknown {
    return JSON.parse(description).unsigned_tx;
}

describe("aptos signing payload", () => {
    it("uses the sha3_256 salt prefix", () => {
        expect(P6_PAYLOAD.startsWith(APTOS_RAW_TRANSACTION_SALT_HASH_HEX)).toBe(
            true,
        );
        expect(aptosSigningPayloadHex).toBeDefined();
    });

    it("recomputes proposal 6 (custom module, one address arg) byte-for-byte", () => {
        const parsed = parseAptosUnsignedTx(unsignedTx(P6_DESCRIPTION));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error("unreachable");
        expect(aptosSigningPayloadHex(parsed.tx)).toBe(P6_PAYLOAD);
        expect(bytesToHex(encodeAptosRawTransaction(parsed.tx))).toBe(
            P6_PAYLOAD.slice(64),
        );
    });

    it("recomputes proposal 7 (0x1::aptos_account::transfer) byte-for-byte", () => {
        const result = aptosPayloadsFromEnvelope(unsignedTx(P7_DESCRIPTION));
        expect(result).toEqual({ ok: true, payloadsHex: [P7_PAYLOAD] });
    });

    it("accepts byte-array args and numeric u64 fields (older envelopes)", () => {
        const raw = JSON.parse(P7_DESCRIPTION).unsigned_tx;
        raw.tx.payload.EntryFunction.args =
            raw.tx.payload.EntryFunction.args.map((hex: string) =>
                Array.from(Buffer.from(hex.slice(2), "hex")),
            );
        raw.tx.sequence_number = 1;
        raw.tx.max_gas_amount = 8010;
        const result = aptosPayloadsFromEnvelope(raw);
        expect(result).toEqual({ ok: true, payloadsHex: [P7_PAYLOAD] });
    });

    it("rejects Script / Multisig payloads and missing fields as unsupported-shape", () => {
        const raw = JSON.parse(P7_DESCRIPTION).unsigned_tx;
        raw.tx.payload = { Script: { code: "0x00", ty_args: [], args: [] } };
        const script = aptosPayloadsFromEnvelope(raw);
        expect(script.ok).toBe(false);
        if (script.ok) throw new Error("unreachable");
        expect(script.reason).toBe("unsupported-shape");
        expect(script.detail).toBe("unsupported payload kind Script");

        const missing = aptosPayloadsFromEnvelope({ tx: { sender: "0x1" } });
        expect(missing.ok).toBe(false);
        if (missing.ok) throw new Error("unreachable");
        expect(missing.reason).toBe("unsupported-shape");
        expect(missing.detail).toBe("missing field tx.sequence_number");

        const badArg = JSON.parse(P7_DESCRIPTION).unsigned_tx;
        badArg.tx.payload.EntryFunction.args[1] = "0xzz";
        const invalid = aptosPayloadsFromEnvelope(badArg);
        expect(invalid.ok).toBe(false);
        if (invalid.ok) throw new Error("unreachable");
        expect(invalid.reason).toBe("invalid-field");
        expect(invalid.detail).toBe("tx.payload.EntryFunction.args[1]");
    });

    it("encodes and formats type tags", () => {
        const tag = parseAptosTypeTag(
            {
                Vector: {
                    Struct: {
                        address: "0x1",
                        module: "coin",
                        name: "Coin",
                        type_args: [
                            {
                                Struct: {
                                    address: "0x1",
                                    module: "aptos_coin",
                                    name: "AptosCoin",
                                    type_args: [],
                                },
                            },
                        ],
                    },
                },
            },
            "t",
        );
        if ("error" in tag) throw new Error(tag.error);
        expect(formatAptosTypeTag(tag)).toBe(
            "vector<0x1::coin::Coin<0x1::aptos_coin::AptosCoin>>",
        );
        expect(parseAptosTypeTag("U256", "t")).toEqual({ kind: "U256" });
        expect(parseAptosTypeTag("Nope", "t")).toEqual({
            error: "t: unknown type tag Nope",
        });
    });
});

describe("aptos proposals end to end", () => {
    it("verifies proposals 6 and 7 on mainnet", () => {
        for (const [id, description, payload] of [
            [6, P6_DESCRIPTION, P6_PAYLOAD],
            [7, P7_DESCRIPTION, P7_PAYLOAD],
        ] as const) {
            const data = extractOmniProposalData(
                proposal(id, description, payload),
                "mainnet",
            );
            expect(data.verification.status).toBe("verified");
            expect(data.verification.recomputedPayloadsHex).toEqual([payload]);
        }
    });

    it("flags a single tampered byte (recipient) as MISMATCH", () => {
        const tampered = P7_DESCRIPTION.replace("655e9b49", "655e9b4a");
        expect(tampered).not.toBe(P7_DESCRIPTION);
        const data = extractOmniProposalData(
            proposal(7, tampered, P7_PAYLOAD),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
        const bytes = data.verification.checks.find(
            (c) => c.id === "payload-bytes",
        );
        expect(bytes?.state).toBe("fail");
        expect(bytes?.detail?.actual).toBe(P7_PAYLOAD);
        expect(bytes?.detail?.expected).not.toBe(P7_PAYLOAD);
    });

    it("flags a tampered amount as MISMATCH", () => {
        const tampered = P7_DESCRIPTION.replace(
            '"0xc09ee60500000000"',
            '"0xc09ee60600000000"',
        );
        const data = extractOmniProposalData(
            proposal(7, tampered, P7_PAYLOAD),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
    });

    it("flags a testnet chain_id inside a mainnet proposal as MISMATCH (registry check)", () => {
        const raw = JSON.parse(P7_DESCRIPTION);
        raw.unsigned_tx.tx.chain_id = 2;
        const description = JSON.stringify(raw);
        const data = extractOmniProposalData(
            proposal(7, description, P7_PAYLOAD),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
        const chainId = data.verification.checks.find(
            (c) => c.id === "chain-id",
        );
        expect(chainId?.state).toBe("fail");
        expect(chainId?.detail?.expected).toBe(1);
        expect(chainId?.detail?.actual).toBe("2");
        // The untampered vector passes the same check.
        const ok = extractOmniProposalData(
            proposal(7, P7_DESCRIPTION, P7_PAYLOAD),
            "mainnet",
        );
        expect(
            ok.verification.checks.find((c) => c.id === "chain-id")?.state,
        ).toBe("pass");
    });

    it("flags a wrong derivation path as MISMATCH", () => {
        const data = extractOmniProposalData(
            proposal(7, P7_DESCRIPTION, P7_PAYLOAD, "omni-2"),
            "mainnet",
        );
        expect(data.verification.status).toBe("mismatch");
        expect(
            data.verification.checks.find((c) => c.id === "path")?.state,
        ).toBe("fail");
    });

    it("decodes 0x1::aptos_account::transfer as an APT transfer", () => {
        const parsed = parseAptosUnsignedTx(unsignedTx(P7_DESCRIPTION));
        if (!parsed.ok) throw new Error("unreachable");
        const decoded = decodeAptosTx(parsed.tx);
        expect(decoded.functionId).toBe("0x1::aptos_account::transfer");
        expect(decoded.known).toEqual({
            kind: "apt-transfer",
            to: "0xd8ccdb46922efc8b7fb8aa1eaffa02f0ec6d4d6efcd58b5097b4dc67655e9b49",
            octas: 99000000n,
        });
        expect(decoded.argDetails).toEqual([
            {
                type: "address",
                value: "0xd8ccdb46922efc8b7fb8aa1eaffa02f0ec6d4d6efcd58b5097b4dc67655e9b49",
            },
            { type: "u64", value: "99000000", note: "0.99 APT" },
        ]);
        expect(decoded.maxGasOctas).toBe(8010n * 150n);
        expect(decoded.sequenceNumber).toBe(1n);

        const custom = parseAptosUnsignedTx(unsignedTx(P6_DESCRIPTION));
        if (!custom.ok) throw new Error("unreachable");
        const decodedCustom = decodeAptosTx(custom.tx);
        expect(decodedCustom.functionId).toBe(
            "0xe4ec15f237e5a8c7daa7a34ece28e2bd2c079360763f181bf65862ec148b914a::omni_bridge::log_metadata",
        );
        expect(decodedCustom.known).toBeNull();
        expect(decodedCustom.args).toHaveLength(1);
        expect(decodedCustom.argDetails).toEqual([null]);
    });
});

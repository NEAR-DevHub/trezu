/**
 * Static-render smoke tests for the omni review UI. Uses react-dom/server so
 * the components are exercised with real en messages and real proposal data
 * without a browser: a thrown render, a missing i18n key or a bad ICU
 * argument fails here.
 */
import { describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import type { Proposal } from "@/lib/proposals-api";
import messages from "@/messages/en.json";
import type { Policy } from "@/types/policy";
import { extractOmniProposalData } from "../verify";
import { OmniCell } from "./omni-cell";
import { OmniChecklist } from "./omni-checklist";
import { OmniExpanded } from "./omni-expanded";
import { OmniRawSection } from "./omni-raw-section";
import { OmniStatusBanner } from "./omni-status-banner";

const PROPOSAL_10: Proposal = {
    id: 10,
    proposer: "frolik.near",
    description:
        '{"omni":1,"intent":"log metedata","family":"evm","chain":"arb","path":"omni-1","unsigned_tx":{"chain_id":42161,"gas_limit":"102182","input":"0x31f57d2200000000000000000000000025118290e6a5f4139381d072181157035864099d","max_fee_per_gas":"100000000","max_priority_fee_per_gas":"0","nonce":3,"to":"0xd025b38762B4A4E36F0Cde483b86CB13ea00D989","value":"0"},"meta":{"builder_version":"0.1.1"}}',
    kind: {
        FunctionCall: {
            receiver_id: "v1.signer",
            actions: [
                {
                    method_name: "sign",
                    args: "eyJyZXF1ZXN0Ijp7InBhdGgiOiJvbW5pLTEiLCJwYXlsb2FkX3YyIjp7IkVjZHNhIjoiYjQ5YTBhMDA1MWE3MWUxMmNiYWJkZDhkNDdmYmJiNzNiZmYxZTY0MmJlZTcxMTFkM2ViYjJmMGIwYWY0MmIxOSJ9LCJkb21haW5faWQiOjB9fQ==",
                    deposit: "1",
                    gas: "30000000000000",
                },
            ],
        },
    },
    status: "Approved",
    vote_counts: { Approver: [1, 0, 0] },
    votes: { "frolik.near": "Approve" },
    submission_time: "1789054171328327490",
    last_actions_log: null,
};

// testnet omni-e2e.sputnik-v2.testnet #5: svm legacy transfer with durable nonce.
const SVM_PAYLOAD =
    "01000205d7d18c0d34ce4f0989df790c3ebe406db209573428ad5f3cfea61cbcec3e65b505151bbe7ee0ca711291c2fcb5999b8090d29402014a61e0f488fc2e9041db501927ba24a44865e96d6a3b4c23e2a396ef877f7222510a302317fb9837f52678000000000000000000000000000000000000000000000000000000000000000006a7d517192c568ee08a845f73d29788cf035c3145b21ab344d8062ea9400000a7bb21d62cf7c428ab0181c66d849b72e0a7b6c5f41eaddea98fdad38d5351140203030104000404000000030200020c020000008096980000000000";
const PROPOSAL_SVM_5: Proposal = {
    id: 5,
    proposer: "omni-e2e.testnet",
    description:
        '{"omni":1,"intent":"SOL vector","family":"svm","chain":"solana","path":"omni-1","unsigned_tx":{"message":{"Legacy":{"account_keys":["FXTyp6DD7QcSLumbkiJ86uCGirNUETaWoSkhQ3Bx88JQ","LqhzpZza29cAGHrSZGaorXNSt7fXG9MxT7wx9Wcuoyy","2hCKz5TNpxtZR6wpS8qZqSbh1pW59akjp54hHtj3akYX","11111111111111111111111111111111","SysvarRecentB1ockHashes11111111111111111111"],"header":{"num_readonly_signed_accounts":0,"num_readonly_unsigned_accounts":2,"num_required_signatures":1},"instructions":[{"accounts":[1,4,0],"data":"0x04000000","program_id_index":3},{"accounts":[0,2],"data":"0x020000008096980000000000","program_id_index":3}],"recent_blockhash":"CHkazskSfCWyqZdH7BGuU9MrNFvGccYEHLS2GH9QUZeB"}}},"meta":{"builder_version":"0.1.1"}}',
    kind: {
        FunctionCall: {
            receiver_id: "v1.signer-prod.testnet",
            actions: [
                {
                    method_name: "sign",
                    args: btoa(
                        JSON.stringify({
                            request: {
                                path: "omni-1",
                                payload_v2: { Eddsa: SVM_PAYLOAD },
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
    submission_time: "1789054171328327490",
    last_actions_log: null,
};

const POLICY = {
    proposal_period: "604800000000000",
    roles: [],
} as unknown as Policy;

function render(node: React.ReactNode): string {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, enabled: false } },
    });
    return renderToStaticMarkup(
        <QueryClientProvider client={client}>
            <NextIntlClientProvider
                locale="en"
                messages={messages}
                onError={(error) => {
                    if (error.code === "ENVIRONMENT_FALLBACK") return;
                    throw error;
                }}
            >
                {node}
            </NextIntlClientProvider>
        </QueryClientProvider>,
    );
}

/**
 * Minimal tag walker: returns every element carrying
 * `data-testid="omni-payload-hex"` with its tag, class list and the class
 * lists of its open ancestors (root first).
 */
function payloadElements(html: string) {
    const out: Array<{ tag: string; className: string; ancestors: string[] }> =
        [];
    const stack: Array<{ tag: string; className: string }> = [];
    const voidTags = new Set([
        "path",
        "svg",
        "circle",
        "line",
        "polyline",
        "br",
        "input",
    ]);
    const re = /<(\/)?([a-zA-Z][\w-]*)([^>]*?)(\/)?>/g;
    for (const m of html.matchAll(re)) {
        const [, closing, tag, attrs, selfClosing] = m;
        if (closing) {
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i]?.tag === tag) {
                    stack.splice(i);
                    break;
                }
            }
            continue;
        }
        const className = attrs?.match(/class="([^"]*)"/)?.[1] ?? "";
        if (attrs?.includes('data-testid="omni-payload-hex"')) {
            out.push({
                tag,
                className,
                ancestors: stack.map((s) => s.className),
            });
        }
        if (!selfClosing && !voidTags.has(tag)) stack.push({ tag, className });
    }
    return out;
}

function tamper(proposal: Proposal, description: string): Proposal {
    return { ...proposal, description };
}

describe("omni components render", () => {
    it("renders proposal 10 as VERIFIED in the list cell", () => {
        const data = extractOmniProposalData(PROPOSAL_10, "mainnet");
        const html = render(<OmniCell data={data} />);
        expect(html).toContain("omni-dot-verified");
        expect(html).toContain("log metedata");
        expect(html).toContain("Arbitrum One");
        expect(html).toContain("to 0xd025…D989");
    });

    it("renders the VERIFIED banner and full checklist", () => {
        const data = extractOmniProposalData(PROPOSAL_10, "mainnet");
        const banner = render(
            <OmniStatusBanner
                verification={data.verification}
                dao="testing-treasury-frolik.sputnik-dao.near"
                proposalId={10}
                network="mainnet"
            />,
        );
        expect(banner).toContain("omni-status-verified");
        expect(banner).toContain("VERIFIED");

        const checklist = render(
            <OmniChecklist checks={data.verification.checks} />,
        );
        expect(checklist).toContain(
            "Receiver is the MPC signer contract (v1.signer)",
        );
        expect(checklist).toContain("1 action, all plain sign calls");
        expect(checklist).toContain("Chain matches the omni registry (arb)");
        expect(checklist).toContain("byte-for-byte");
    });

    it("renders the full expanded view with EVM details and broadcast hint", () => {
        const data = extractOmniProposalData(PROPOSAL_10, "mainnet");
        const html = render(
            <OmniExpanded
                proposal={PROPOSAL_10}
                data={data}
                policy={POLICY}
                treasuryId="testing-treasury-frolik.sputnik-dao.near"
                isPending={false}
                isExecuted={true}
            />,
        );
        expect(html).toContain("omni-expanded");
        expect(html).toContain("Arbitrum One · chain id 42161");
        expect(html).toContain("0xd025b38762B4A4E36F0Cde483b86CB13ea00D989");
        expect(html).toContain("0x31f57d22");
        expect(html).toContain("Assumes nonce 3");
        // gas_limit * max_fee_per_gas = 102182 * 1e8 wei = 0.0000102182 ETH
        expect(html).toContain("0.0000102182 ETH");
        expect(html).toContain(
            "omni transaction broadcast &lt;NEAR-TX-HASH&gt; &lt;voter-account&gt; network-config mainnet",
        );
        expect(html).toContain(
            "b49a0a0051a71e12cbabdd8d47fbbb73bff1e642bee7111d3ebb2f0b0af42b19",
        );
    });

    it("renders a MISMATCH banner with both hashes for tampered calldata", () => {
        const tampered = tamper(
            PROPOSAL_10,
            PROPOSAL_10.description.replace("864099d", "864099e"),
        );
        const data = extractOmniProposalData(tampered, "mainnet");
        expect(data.verification.status).toBe("mismatch");
        const html = render(
            <OmniExpanded
                proposal={tampered}
                data={data}
                policy={POLICY}
                treasuryId="testing-treasury-frolik.sputnik-dao.near"
                isPending={true}
                isExecuted={false}
            />,
        );
        expect(html).toContain("omni-status-mismatch");
        expect(html).toContain("MISMATCH / DO NOT APPROVE");
        expect(html).toContain("proposal signs");
        expect(html).toContain("envelope needs");
        expect(html).toContain(
            "b49a0a0051a71e12cbabdd8d47fbbb73bff1e642bee7111d3ebb2f0b0af42b19",
        );
        const compact = render(
            <OmniStatusBanner
                verification={data.verification}
                dao="dao.near"
                proposalId={10}
                network="mainnet"
                compact
            />,
        );
        expect(compact).toContain('role="alert"');
    });

    it("renders UNVERIFIED with the CLI hint for a non-EVM family", () => {
        const svm = tamper(
            PROPOSAL_10,
            JSON.stringify({
                omni: 1,
                intent: "Send 0.001 SOL",
                family: "svm",
                chain: "solana",
                path: "omni-1",
                unsigned_tx: {
                    signatures: [],
                    message: {
                        Legacy: {
                            header: {
                                num_required_signatures: 1,
                                num_readonly_signed_accounts: 0,
                                num_readonly_unsigned_accounts: 1,
                            },
                            account_keys: [
                                "ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw",
                                "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
                                "11111111111111111111111111111111",
                            ],
                            recent_blockhash:
                                "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn",
                            instructions: [
                                {
                                    program_id_index: 2,
                                    accounts: [0, 1],
                                    data: "0x0200000040420f0000000000",
                                },
                            ],
                        },
                    },
                },
                meta: { builder_version: "0.1.1" },
            }),
        );
        const data = extractOmniProposalData(svm, "mainnet");
        // Domain check fails (proposal uses Ecdsa/domain 0), so this is a
        // mismatch AND non-verifiable; render must handle both.
        const html = render(
            <OmniExpanded
                proposal={svm}
                data={data}
                policy={POLICY}
                treasuryId="dao.near"
                isPending={true}
                isExecuted={false}
            />,
        );
        expect(html).toContain("Fee payer");
        expect(html).toContain("ARS1ayzvH2xtaRo1BLW95FsthhqN3NAA1e9Pcm186Fmw");
        expect(html).toContain("1 instruction");

        // A family without a browser recompute (sui) with the right domain
        // is a clean UNVERIFIED with the CLI hint.
        const eddsaArgs = btoa(
            JSON.stringify({
                request: {
                    path: "omni-1",
                    payload_v2: { Eddsa: "ab".repeat(32) },
                    domain_id: 1,
                },
            }),
        );
        const clean: Proposal = {
            ...svm,
            description: JSON.stringify({
                omni: 1,
                intent: "sui placeholder",
                family: "sui",
                chain: "sui",
                path: "omni-1",
                unsigned_tx: { tx: {} },
                meta: { builder_version: "0.1.1" },
            }),
            kind: {
                FunctionCall: {
                    receiver_id: "v1.signer",
                    actions: [
                        {
                            method_name: "sign",
                            args: eddsaArgs,
                            deposit: "1",
                            gas: "30000000000000",
                        },
                    ],
                },
            },
        };
        const cleanData = extractOmniProposalData(clean, "mainnet");
        expect(cleanData.verification.status).toBe("unverified");
        const cleanHtml = render(
            <OmniStatusBanner
                verification={cleanData.verification}
                dao="dao.near"
                proposalId={12}
                network="mainnet"
            />,
        );
        expect(cleanHtml).toContain("UNVERIFIED");
        expect(cleanHtml).toContain(
            "omni proposal review dao.near 12 network-config mainnet",
        );
    });

    it("renders an aptos transfer as VERIFIED with the decoded action", () => {
        const aptos = tamper(
            PROPOSAL_10,
            '{"omni":1,"intent":"sending tokens back to aptos","family":"aptos","chain":"aptos","path":"omni-1","unsigned_tx":{"sender_public_key":"8bfb6698b0005ed7e0ca9cecbc39380b18ebd6fb52c973f5b40ddcf5fc720cde","tx":{"chain_id":1,"expiration_timestamp_secs":"1790253701","gas_unit_price":"150","max_gas_amount":"8010","payload":{"EntryFunction":{"args":["0xd8ccdb46922efc8b7fb8aa1eaffa02f0ec6d4d6efcd58b5097b4dc67655e9b49","0xc09ee60500000000"],"function":"transfer","module":{"address":"0x0000000000000000000000000000000000000000000000000000000000000001","name":"aptos_account"},"ty_args":[]}},"sender":"0x97bc559ecc97a4df7bbb4f7a58848d85c648d7e505ab027d9f3e1601bd35aab7","sequence_number":"1"}},"meta":{"builder_version":"0.1.0"}}',
        );
        const payload =
            "b5e97db07fa0bd0e5598aa3643a9bc6f6693bddc1a9fec9e674a461eaa00b19397bc559ecc97a4df7bbb4f7a58848d85c648d7e505ab027d9f3e1601bd35aab701000000000000000200000000000000000000000000000000000000000000000000000000000000010d6170746f735f6163636f756e74087472616e73666572000220d8ccdb46922efc8b7fb8aa1eaffa02f0ec6d4d6efcd58b5097b4dc67655e9b4908c09ee605000000004a1f0000000000009600000000000000851ab56a0000000001";
        const proposal: Proposal = {
            ...aptos,
            id: 7,
            kind: {
                FunctionCall: {
                    receiver_id: "v1.signer",
                    actions: [
                        {
                            method_name: "sign",
                            args: btoa(
                                JSON.stringify({
                                    request: {
                                        path: "omni-1",
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
        };
        const data = extractOmniProposalData(proposal, "mainnet");
        expect(data.verification.status).toBe("verified");
        const html = render(
            <OmniExpanded
                proposal={proposal}
                data={data}
                policy={POLICY}
                treasuryId="testing-treasury-frolik.sputnik-dao.near"
                isPending={true}
                isExecuted={false}
            />,
        );
        expect(html).toContain("omni-status-verified");
        expect(html).toContain(
            "Transfer 0.99 APT to 0xd8ccdb46922efc8b7fb8aa1eaffa02f0ec6d4d6efcd58b5097b4dc67655e9b49",
        );
        expect(html).toContain("0x1::aptos_account::transfer");
        expect(html).toContain("0.012015 APT");
        expect(html).toContain("Assumes sequence number 1");
        // per-argument decode agrees with the Action line
        expect(html).toContain("u64 99000000 (0.99 APT)");
        expect(html).toContain("wrap-anywhere");
        expect(html).not.toContain('whitespace-pre"');
    });

    it("renders a TON transfer as VERIFIED with both address forms", () => {
        const description =
            '{"omni":1,"intent":"TON vector for trezu UI: do not approve","family":"ton","chain":"ton","path":"omni-1","unsigned_tx":{"deploy":true,"messages":[{"body":null,"bounce":false,"dest":"EQAW9YzOnhMwoB2TGVkSi5fNFphjhyStvoSKgDRx87i7_QxU","mode":3,"value":"10000000"}],"public_key":[215,209,140,13,52,206,79,9,137,223,121,12,62,190,64,109,178,9,87,52,40,173,95,60,254,166,28,188,236,62,101,181],"seqno":0,"valid_until":1790724975,"wallet_id":2147483645,"wallet_version":"V5R1","workchain":0},"meta":{"builder_version":"0.1.1"}}';
        const proposal: Proposal = {
            ...PROPOSAL_10,
            id: 3,
            description,
            status: "InProgress",
            kind: {
                FunctionCall: {
                    receiver_id: "v1.signer-prod.testnet",
                    actions: [
                        {
                            method_name: "sign",
                            args: btoa(
                                JSON.stringify({
                                    request: {
                                        path: "omni-1",
                                        payload_v2: {
                                            Eddsa: "8083b17a5e67c2456cbaea70c6cbe1a67f8801d4e3f7676b8fc25fda94fac1ec",
                                        },
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
        };
        const data = extractOmniProposalData(proposal, "testnet");
        expect(data.verification.status).toBe("verified");
        const html = render(
            <OmniExpanded
                proposal={proposal}
                data={data}
                policy={POLICY}
                treasuryId="omni-e2e.sputnik-v2.testnet"
                isPending={true}
                isExecuted={false}
            />,
        );
        expect(html).toContain("omni-status-verified");
        expect(html).toContain("0.01 TON");
        expect(html).toContain(
            "kQAW9YzOnhMwoB2TGVkSi5fNFphjhyStvoSKgDRx87i7_bfe",
        ); // bounceable testnet form
        expect(html).toContain(
            "0QAW9YzOnhMwoB2TGVkSi5fNFphjhyStvoSKgDRx87i7_eob",
        ); // non-bounceable testnet form
        expect(html).toContain("V5R1");
        expect(html).toContain("wallet id 2147483645");
    });

    it("renders the SOL durable-nonce transfer as VERIFIED", () => {
        const description =
            '{"omni":1,"intent":"SOL vector for trezu UI: do not approve","family":"svm","chain":"solana","path":"omni-1","unsigned_tx":{"message":{"Legacy":{"account_keys":["FXTyp6DD7QcSLumbkiJ86uCGirNUETaWoSkhQ3Bx88JQ","LqhzpZza29cAGHrSZGaorXNSt7fXG9MxT7wx9Wcuoyy","2hCKz5TNpxtZR6wpS8qZqSbh1pW59akjp54hHtj3akYX","11111111111111111111111111111111","SysvarRecentB1ockHashes11111111111111111111"],"header":{"num_readonly_signed_accounts":0,"num_readonly_unsigned_accounts":2,"num_required_signatures":1},"instructions":[{"accounts":[1,4,0],"data":"0x04000000","program_id_index":3},{"accounts":[0,2],"data":"0x020000008096980000000000","program_id_index":3}],"recent_blockhash":"CHkazskSfCWyqZdH7BGuU9MrNFvGccYEHLS2GH9QUZeB"}}},"meta":{"builder_version":"0.1.1"}}';
        const payload =
            "01000205d7d18c0d34ce4f0989df790c3ebe406db209573428ad5f3cfea61cbcec3e65b505151bbe7ee0ca711291c2fcb5999b8090d29402014a61e0f488fc2e9041db501927ba24a44865e96d6a3b4c23e2a396ef877f7222510a302317fb9837f52678000000000000000000000000000000000000000000000000000000000000000006a7d517192c568ee08a845f73d29788cf035c3145b21ab344d8062ea9400000a7bb21d62cf7c428ab0181c66d849b72e0a7b6c5f41eaddea98fdad38d5351140203030104000404000000030200020c020000008096980000000000";
        const proposal: Proposal = {
            ...PROPOSAL_10,
            id: 5,
            description,
            status: "InProgress",
            kind: {
                FunctionCall: {
                    receiver_id: "v1.signer-prod.testnet",
                    actions: [
                        {
                            method_name: "sign",
                            args: btoa(
                                JSON.stringify({
                                    request: {
                                        path: "omni-1",
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
        };
        const data = extractOmniProposalData(proposal, "testnet");
        expect(data.verification.status).toBe("verified");
        const html = render(
            <OmniExpanded
                proposal={proposal}
                data={data}
                policy={POLICY}
                treasuryId="omni-e2e.sputnik-v2.testnet"
                isPending={true}
                isExecuted={false}
            />,
        );
        expect(html).toContain("omni-status-verified");
        expect(html).toContain("Durable nonce advance");
        expect(html).toContain(
            "Transfer 0.01 SOL from FXTyp6DD7QcSLumbkiJ86uCGirNUETaWoSkhQ3Bx88JQ to 2hCKz5TNpxtZR6wpS8qZqSbh1pW59akjp54hHtj3akYX",
        );
        expect(html).toContain("2 instructions");
    });

    it("renders the SUI transfer as VERIFIED", () => {
        const description =
            '{"omni":1,"intent":"SUI vector for trezu UI: do not approve","family":"sui","chain":"sui","path":"omni-1","unsigned_tx":{"sender_public_key":"d7d18c0d34ce4f0989df790c3ebe406db209573428ad5f3cfea61cbcec3e65b5","tx":{"expiration":"None","gas_data":{"budget":10000000,"owner":"0x0672aee8395afe7e242a304966a46755f1271ed175b2a829257aa7703e334acc","payment":[{"digest":"6paeDqevY5BtkVBmjiJQxawzJUeWJ8Pi5swbGuo9mWGk","object_id":"0xd4d1616cdcc44482d118116d01c24f39df099ca4aac42c3fe13fd0b10cddbe11","version":349181949}],"price":1000},"kind":{"ProgrammableTransaction":{"commands":[{"SplitCoins":{"amounts":[{"Input":0}],"coin":"GasCoin"}},{"TransferObjects":{"address":{"Input":1},"objects":[{"Result":0}]}}],"inputs":[{"Pure":"0x8096980000000000"},{"Pure":"0xd367c7ff1a7d38c2217f8e73c03fb023c7e6ac88a32fd771fd9bf5e223b8e7b8"}]}},"sender":"0x0672aee8395afe7e242a304966a46755f1271ed175b2a829257aa7703e334acc"}},"meta":{"builder_version":"0.1.1"}}';
        const proposal: Proposal = {
            ...PROPOSAL_10,
            id: 6,
            description,
            status: "InProgress",
            kind: {
                FunctionCall: {
                    receiver_id: "v1.signer-prod.testnet",
                    actions: [
                        {
                            method_name: "sign",
                            args: btoa(
                                JSON.stringify({
                                    request: {
                                        path: "omni-1",
                                        payload_v2: {
                                            Eddsa: "53f148af874d09713464469e3c2e19038997a1f21bfdb423ea04b65a938db7e7",
                                        },
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
        };
        const data = extractOmniProposalData(proposal, "testnet");
        expect(data.verification.status).toBe("verified");
        const html = render(
            <OmniExpanded
                proposal={proposal}
                data={data}
                policy={POLICY}
                treasuryId="omni-e2e.sputnik-v2.testnet"
                isPending={true}
                isExecuted={false}
            />,
        );
        expect(html).toContain("omni-status-verified");
        expect(html).toContain(
            "Transfer 0.01 SUI to 0xd367c7ff1a7d38c2217f8e73c03fb023c7e6ac88a32fd771fd9bf5e223b8e7b8",
        );
        expect(html).toContain("SplitCoins GasCoin -&gt; [10000000 MIST]");
        expect(html).toContain("gas price 1000 MIST");
    });

    it("renders the BTC transfer as VERIFIED with change and fee", () => {
        const description =
            '{"omni":1,"intent":"BTC vector for trezu UI: do not approve","family":"utxo","chain":"btc","path":"omni-1","unsigned_tx":{"input_values":[192831],"sender_public_key":"0305890e47132c6e360100cb7d50473895778555fb543a42a790d3b618cade9b38","tx":{"inputs":[{"sequence":4294967293,"txid":"a7c11e4b58018150f94a22497abb0add471cde29ae2e83ac347a5725c8b8c0c5","vout":1}],"lock_time":0,"outputs":[{"script_pubkey":"0x00141088442812b585b82757b8210196428777ec0f73","value_sats":50000},{"script_pubkey":"0x001430a0f9876d272c1c6108688118a5a73033050acf","value_sats":142616}],"version":2}},"meta":{"builder_version":"0.1.1"}}';
        const proposal: Proposal = {
            ...PROPOSAL_10,
            id: 4,
            description,
            status: "InProgress",
            kind: {
                FunctionCall: {
                    receiver_id: "v1.signer-prod.testnet",
                    actions: [
                        {
                            method_name: "sign",
                            args: btoa(
                                JSON.stringify({
                                    request: {
                                        path: "omni-1",
                                        payload_v2: {
                                            Ecdsa: "ff539417b96929dce995fbf4358ba029012eac669ca47d2044b57f1d90d1d625",
                                        },
                                        domain_id: 0,
                                    },
                                }),
                            ),
                            deposit: "1",
                            gas: "30000000000000",
                        },
                    ],
                },
            },
        };
        const data = extractOmniProposalData(proposal, "testnet");
        expect(data.verification.status).toBe("verified");
        const html = render(
            <OmniExpanded
                proposal={proposal}
                data={data}
                policy={POLICY}
                treasuryId="omni-e2e.sputnik-v2.testnet"
                isPending={true}
                isExecuted={false}
            />,
        );
        expect(html).toContain("omni-status-verified");
        expect(html).toContain("tb1qzzyyg2qjkkzmsf6hhqssr9jzsam7crmnfmnxhj");
        expect(html).toContain("tb1qxzs0npmdyukpccggdzq33fd8xqes2zk009e3np");
        expect(html).toContain(">change<");
        expect(html).toContain("0.00000215 BTC");
        expect(html).toContain("sat/vB");
    });

    it("survives broken, oversize and non-envelope descriptions", () => {
        for (const description of [
            '{"omni":1, broken',
            `{"omni":1,"intent":"${"x".repeat(20_000)}"}`,
            '{"omni":1}',
            '{"omni":"one","family":"zec"}',
        ]) {
            const proposal = tamper(PROPOSAL_10, description);
            const data = extractOmniProposalData(proposal, "mainnet");
            const html = render(
                <OmniExpanded
                    proposal={proposal}
                    data={data}
                    policy={POLICY}
                    treasuryId="dao.near"
                    isPending={true}
                    isExecuted={false}
                />,
            );
            expect(html).toContain("omni-expanded");
            expect(render(<OmniCell data={data} />)).toContain("omni-dot-");
        }
    });
    /**
     * Regression: the expanded view is rendered inside a table cell that sets
     * `white-space: nowrap`, which inherits and turns a long payload hex into a
     * single clipped line (`break-all` alone does nothing under nowrap). Every
     * payload element must opt back into wrapping explicitly, and nothing
     * between it and the section may reintroduce clipping.
     */
    it("renders payload hex as wrapping block code with no clipping ancestor", () => {
        const data = extractOmniProposalData(PROPOSAL_SVM_5, "testnet");
        expect(data.verification.status).toBe("verified");

        const checklist = render(
            <OmniChecklist
                checks={data.verification.checks}
                matchedPayloadsHex={data.verification.proposalPayloadsHex}
            />,
        );
        const raw = render(
            <OmniRawSection
                data={data}
                rawDescription={PROPOSAL_SVM_5.description}
                defaultOpen
            />,
        );

        for (const html of [checklist, raw]) {
            expect(html).toContain(SVM_PAYLOAD);
            const elements = payloadElements(html);
            expect(elements.length).toBeGreaterThan(0);
            for (const { tag, className, ancestors } of elements) {
                expect(tag).toBe("code");
                expect(className).toContain("block");
                expect(className).toContain("whitespace-pre-wrap");
                expect(className).toContain("break-all");
                for (const ancestor of ancestors) {
                    expect(ancestor).not.toMatch(
                        /\b(truncate|whitespace-nowrap|overflow-x-auto)\b/,
                    );
                }
            }
        }

        // The whole expanded view resets the inherited nowrap at its root.
        const expanded = render(
            <OmniExpanded
                proposal={PROPOSAL_SVM_5}
                data={data}
                policy={POLICY}
                treasuryId="omni-e2e.sputnik-v2.testnet"
                isPending={true}
                isExecuted={false}
            />,
        );
        expect(expanded).toMatch(
            /<div class="[^"]*\bwhitespace-normal\b[^"]*" data-testid="omni-expanded"/,
        );
    });
});

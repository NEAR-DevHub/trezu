import { GenerateIntentResponse } from "@/lib/api";
import { encodeToMarkdown, jsonToBase64 } from "@/lib/utils";
import { V1_SIGNER_CONTRACT, V1_SIGNER_GAS } from "../constants";

/**
 * Build a DAO proposal that calls v1.signer to sign an intent payload hash.
 *
 * The proposal is deliberately opaque — it signs a hash, not the readable intent.
 * This ensures the on-chain proposal does not reveal transfer amounts or tokens.
 *
 * The payload hash is computed by the backend (single source of truth) and
 * covers either a single transfer or a merged multi-recipient message.
 */
function buildSignHashProposal(params: {
    payloadHash: string;
    treasuryId: string;
}) {
    const description = encodeToMarkdown({
        proposal_action: "confidential",
        notes: "Confidential proposal via private intents. Details are hidden for privacy.",
    });
    return {
        proposal: {
            description,
            kind: {
                FunctionCall: {
                    receiver_id: V1_SIGNER_CONTRACT,
                    actions: [
                        {
                            method_name: "sign",
                            args: jsonToBase64({
                                request: {
                                    path: params.treasuryId,
                                    payload_v2: { Eddsa: params.payloadHash },
                                    domain_id: 1,
                                },
                            }),
                            deposit: "1",
                            gas: V1_SIGNER_GAS,
                        },
                    ],
                },
            },
        },
    };
}

interface ConfidentialProposalParams {
    intentResponse: GenerateIntentResponse;
    treasuryId: string;
}

export function buildConfidentialProposal(params: ConfidentialProposalParams) {
    return buildSignHashProposal({
        payloadHash: params.intentResponse.payloadHash,
        treasuryId: params.treasuryId,
    });
}

interface ConfidentialBulkProposalParams {
    payloadHash: string;
    treasuryId: string;
}

/**
 * Bulk variant — same v1.signer sign shape and opaque description as
 * `buildConfidentialProposal`. The backend's `intent_type` column distinguishes
 * single vs bulk without leaking recipient count on-chain.
 */
export function buildConfidentialBulkProposal(
    params: ConfidentialBulkProposalParams,
) {
    return buildSignHashProposal({
        payloadHash: params.payloadHash,
        treasuryId: params.treasuryId,
    });
}

import { GenerateIntentResponse } from "@/lib/api";
import { encodeToMarkdown, jsonToBase64 } from "@/lib/utils";
import { V1_SIGNER_CONTRACT, V1_SIGNER_GAS } from "../constants";

interface ConfidentialProposalParams {
    intentResponse: GenerateIntentResponse;
    treasuryId: string;
}

/**
 * Build a DAO proposal that calls v1.signer to sign the intent hash.
 *
 * The proposal is deliberately opaque — it signs a hash, not the readable intent.
 * This ensures the on-chain proposal does not reveal transfer amounts or tokens.
 *
 * The payload hash is computed by the backend (single source of truth) and returned
 * in the generate-intent response as `payloadHash`.
 */
export function buildConfidentialProposal(params: ConfidentialProposalParams) {
    const { intentResponse, treasuryId } = params;

    // Opaque description — does NOT reveal amounts or tokens
    const description = encodeToMarkdown({
        proposal_action: "confidential",
        notes: "Confidential proposal via private intents. Details are hidden for privacy.",
        correlationId: intentResponse.correlationId,
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
                                    path: treasuryId,
                                    payload_v2: {
                                        Eddsa: intentResponse.payloadHash,
                                    },
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

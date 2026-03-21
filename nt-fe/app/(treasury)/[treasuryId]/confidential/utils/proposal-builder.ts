import { GenerateIntentResponse } from "@/lib/api";
import { encodeToMarkdown, jsonToBase64 } from "@/lib/utils";
import { V1_SIGNER_CONTRACT, V1_SIGNER_GAS } from "../constants";

interface ConfidentialProposalParams {
    intentResponse: GenerateIntentResponse;
    treasuryId: string;
    proposalBond: string;
}

/**
 * Compute the NEP-413 hash of an intent payload.
 *
 * This is the 32-byte SHA-256 hash that v1.signer (MPC) signs.
 * The hash is over: tag (4 bytes LE) + borsh(NEP413Payload).
 *
 * NEP413Payload borsh layout:
 *   message: String (u32 len + utf8 bytes)
 *   nonce: [u8; 32] (fixed, no length prefix)
 *   recipient: String (u32 len + utf8 bytes)
 *   callback_url: Option<String> (0 byte for None)
 */
async function computeNep413Hash(
    message: string,
    nonceBase64: string,
    recipient: string,
): Promise<Uint8Array> {
    // NEP-413 tag: (1 << 31) + 413 = 2147484061
    const tag = new Uint8Array(4);
    new DataView(tag.buffer).setUint32(0, (1 << 31) + 413, true);

    const messageBytes = new TextEncoder().encode(message);
    const nonceBytes = Uint8Array.from(atob(nonceBase64), (c) =>
        c.charCodeAt(0),
    );
    const recipientBytes = new TextEncoder().encode(recipient);

    // Build borsh-serialized payload
    const parts: Uint8Array[] = [];

    // Tag
    parts.push(tag);

    // Borsh String: message (u32 len + utf8 bytes)
    const msgLen = new Uint8Array(4);
    new DataView(msgLen.buffer).setUint32(0, messageBytes.length, true);
    parts.push(msgLen);
    parts.push(messageBytes);

    // Borsh [u8; 32]: nonce (fixed-size, no length prefix)
    parts.push(nonceBytes);

    // Borsh String: recipient (u32 len + utf8 bytes)
    const recipLen = new Uint8Array(4);
    new DataView(recipLen.buffer).setUint32(0, recipientBytes.length, true);
    parts.push(recipLen);
    parts.push(recipientBytes);

    // Borsh Option<String>: callback_url = None
    parts.push(new Uint8Array([0]));

    // Concatenate
    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
        combined.set(part, offset);
        offset += part.length;
    }

    // SHA-256 hash
    const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
    return new Uint8Array(hashBuffer);
}

/**
 * Build a DAO proposal that calls v1.signer to sign the intent hash.
 *
 * The proposal is deliberately opaque — it signs a hash, not the readable intent.
 * This ensures the on-chain proposal does not reveal transfer amounts or tokens.
 */
export async function buildConfidentialProposal(
    params: ConfidentialProposalParams,
) {
    const { intentResponse, treasuryId, proposalBond } = params;
    const { payload } = intentResponse.intent;

    // Compute the NEP-413 hash (what v1.signer will sign)
    const payloadHash = await computeNep413Hash(
        payload.message,
        payload.nonce,
        payload.recipient,
    );

    // Opaque description — does NOT reveal amounts or tokens
    const description = encodeToMarkdown({
        proposal_action: "confidential-transfer",
        notes: "Confidential transfer via private intents. Details are hidden for privacy.",
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
                                    payload: Array.from(payloadHash),
                                    path: treasuryId,
                                    key_version: 0,
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

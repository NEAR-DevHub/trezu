import type { FunctionCallKind, TransferKind } from "@/lib/proposals-api";
import type { Token } from "@/components/token-input";
import { default_near_token } from "@/constants/token";
import { FT_TRANSFER_GAS } from "@/lib/near-ft-gas";
import { jsonToBase64 } from "@/lib/utils";

// ─── Proposal builders ────────────────────────────────────────────────────────
//
// Allowlisted token contracts are registered by the backend at approval time.
// A token outside that list gets a `storage_deposit` action on the proposal
// itself (`buildDirectFtTransferCallKind` plus `prependStorageDeposits`).
// Intents kinds are built via the `*Kind` helpers in @/lib/near-proposal-builders.

/**
 * Builds a Transfer kind for a direct NEAR or NEAR FT payment.
 * Native NEAR uses token_id="" as per the DAO contract convention.
 */
export function buildDirectTransferKind(
    address: string,
    token: Token,
    parsedAmount: string,
    isConfidential: boolean,
): TransferKind {
    const isNEAR = token.address === default_near_token(isConfidential).address;
    return {
        Transfer: {
            token_id: isNEAR ? "" : token.address,
            receiver_id: address,
            amount: parsedAmount,
            msg: null,
        },
    };
}

/**
 * Direct FT payment as a FunctionCall, so a `storage_deposit` for an
 * unregistered recipient can sit in front of `ft_transfer` on the same
 * token contract. Used when the sponsor will not pay that registration.
 */
export function buildDirectFtTransferCallKind(
    address: string,
    tokenAddress: string,
    parsedAmount: string,
): FunctionCallKind {
    return {
        FunctionCall: {
            receiver_id: tokenAddress,
            actions: [
                {
                    method_name: "ft_transfer",
                    args: jsonToBase64({
                        receiver_id: address,
                        amount: parsedAmount,
                    }),
                    deposit: "1",
                    gas: FT_TRANSFER_GAS,
                },
            ],
        },
    };
}

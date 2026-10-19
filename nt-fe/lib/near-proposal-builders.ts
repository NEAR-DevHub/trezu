import type { FunctionCallAction, FunctionCallKind } from "@/lib/proposals-api";
import {
    FT_TRANSFER_GAS,
    STORAGE_DEPOSIT_AMOUNT,
    STORAGE_DEPOSIT_GAS,
} from "@/lib/near-ft-gas";
import {
    getBatchStorageDepositIsRegistered,
    isSponsorStorageAllowed,
} from "@/lib/api";
import { isValidNearAddressFormat } from "@/lib/near-validation";
import { decodeArgs, jsonToBase64 } from "@/lib/utils";
import { NEAR_NETWORK_ID, WRAP_NEAR_TOKEN_ID } from "@/constants/network-ids";
import Big from "@/lib/big";

export function buildIntentsTransferProposal(
    tokenAddress: string,
    depositAddress: string,
    amountIn: string,
): FunctionCallKind {
    return {
        FunctionCall: {
            receiver_id: "intents.near",
            actions: [
                {
                    method_name: "mt_transfer",
                    args: jsonToBase64({
                        receiver_id: depositAddress,
                        amount: amountIn,
                        token_id: tokenAddress,
                    }),
                    deposit: "1",
                    gas: FT_TRANSFER_GAS,
                },
            ],
        },
    };
}

export function buildNativeNearIntentsKind(
    depositAddress: string,
    amountIn: string,
): FunctionCallKind {
    return {
        FunctionCall: {
            receiver_id: WRAP_NEAR_TOKEN_ID,
            actions: [
                {
                    method_name: "near_deposit",
                    args: jsonToBase64({}),
                    deposit: amountIn,
                    gas: STORAGE_DEPOSIT_GAS,
                },
                {
                    method_name: "ft_transfer",
                    args: jsonToBase64({
                        receiver_id: depositAddress,
                        amount: amountIn,
                    }),
                    deposit: "1",
                    gas: FT_TRANSFER_GAS,
                },
            ],
        },
    };
}

/** DAO-paid NEP-141 registration. The token contract refunds this when the account is already registered. */
export function storageDepositAction(accountId: string): FunctionCallAction {
    return {
        method_name: "storage_deposit",
        args: jsonToBase64({
            account_id: accountId,
            registration_only: true,
        }),
        deposit: STORAGE_DEPOSIT_AMOUNT,
        gas: STORAGE_DEPOSIT_GAS,
    };
}

/**
 * Prepend `storage_deposit` actions onto a FunctionCall whose receiver is the
 * token contract. Same-proposal ordering is required: a separate proposal's
 * cross-contract call is not finished before the transfer starts.
 */
export function prependStorageDeposits(
    kind: FunctionCallKind,
    accountIds: string[],
): FunctionCallKind {
    if (accountIds.length === 0) return kind;
    return {
        FunctionCall: {
            receiver_id: kind.FunctionCall.receiver_id,
            actions: [
                ...accountIds.map(storageDepositAction),
                ...kind.FunctionCall.actions,
            ],
        },
    };
}

/**
 * Accounts the proposal must register itself. Empty when the sponsor pays
 * (token is allowlisted) or every account is already registered.
 * A failed allowlist or registration check is treated as "not sponsored",
 * so the treasury pays rather than the relayer calling an unknown contract.
 */
export async function accountsNeedingProposalStorageDeposit(
    tokenId: string,
    accountIds: string[],
): Promise<string[]> {
    const unique = [
        ...new Set(
            accountIds.filter((accountId) =>
                isValidNearAddressFormat(accountId),
            ),
        ),
    ];
    if (unique.length === 0) return [];
    if (await isSponsorStorageAllowed(tokenId)) return [];

    const statuses = await getBatchStorageDepositIsRegistered(
        unique.map((accountId) => ({ accountId, tokenId })),
    );
    const registered = new Set(
        statuses
            .filter((status) => status.isRegistered)
            .map((status) => status.accountId),
    );
    return unique.filter((accountId) => !registered.has(accountId));
}

export function buildNearFtIntentsKind(
    tokenAddress: string,
    depositAddress: string,
    amountIn: string,
): FunctionCallKind {
    return {
        FunctionCall: {
            receiver_id: tokenAddress,
            actions: [
                {
                    method_name: "ft_transfer",
                    args: jsonToBase64({
                        receiver_id: depositAddress,
                        amount: amountIn,
                    }),
                    deposit: "1",
                    gas: FT_TRANSFER_GAS,
                },
            ],
        },
    };
}

export interface IntentsDepositCall {
    residency: "Near" | "Ft" | "Intents";
    /** Display token id: `near`, the NEP-141 contract, or the intents token id. */
    tokenId: string;
    depositAddress: string;
    amountRaw: string;
}

function parseTransferArgs(
    args: string,
): { depositAddress: string; amountRaw: string; tokenId?: string } | null {
    const decoded = decodeArgs(args);
    if (!decoded || typeof decoded !== "object") return null;
    const { receiver_id, amount, token_id } = decoded as Record<
        string,
        unknown
    >;
    if (typeof receiver_id !== "string" || receiver_id.length === 0) {
        return null;
    }
    if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) return null;
    if (Big(amount).lte(0)) return null;
    return {
        depositAddress: receiver_id,
        amountRaw: amount,
        tokenId: typeof token_id === "string" ? token_id : undefined,
    };
}

/**
 * Decode and validate a public-to-confidential move call — exactly the
 * shapes the builders above produce (wrap-and-transfer, single `ft_transfer`,
 * single `mt_transfer`), with decodable args, a receiver, a positive amount
 * and (for wrap) `near_deposit` == the transferred amount. Used to validate
 * the proposer-controlled `public-to-confidential` marker; anything else is
 * not a move.
 */
export function parseIntentsDepositKind(
    kind: unknown,
): IntentsDepositCall | null {
    if (!kind || typeof kind !== "object" || !("FunctionCall" in kind)) {
        return null;
    }
    const { receiver_id, actions } = (kind as FunctionCallKind).FunctionCall;
    if (receiver_id === WRAP_NEAR_TOKEN_ID) {
        if (actions.length !== 2) return null;
        const [wrap, transfer] = actions;
        if (
            wrap.method_name !== "near_deposit" ||
            transfer.method_name !== "ft_transfer" ||
            transfer.deposit !== "1"
        ) {
            return null;
        }
        const parsed = parseTransferArgs(transfer.args);
        if (!parsed || wrap.deposit !== parsed.amountRaw) return null;
        return {
            residency: "Near",
            tokenId: NEAR_NETWORK_ID,
            depositAddress: parsed.depositAddress,
            amountRaw: parsed.amountRaw,
        };
    }
    if (receiver_id === "intents.near") {
        if (actions.length !== 1 || actions[0].deposit !== "1") return null;
        const action = actions[0];
        if (action.method_name !== "mt_transfer") return null;
        const parsed = parseTransferArgs(action.args);
        if (!parsed?.tokenId) return null;
        return {
            residency: "Intents",
            tokenId: parsed.tokenId,
            depositAddress: parsed.depositAddress,
            amountRaw: parsed.amountRaw,
        };
    }
    const transferIndex = actions.findIndex(
        (action) => action.method_name === "ft_transfer",
    );
    if (transferIndex < 0 || transferIndex !== actions.length - 1) return null;
    const transfer = actions[transferIndex];
    if (transfer.deposit !== "1") return null;
    const deposits = actions.slice(0, transferIndex);
    if (
        deposits.some(
            (action) =>
                action.method_name !== "storage_deposit" ||
                action.deposit !== STORAGE_DEPOSIT_AMOUNT,
        )
    ) {
        return null;
    }
    const parsed = parseTransferArgs(transfer.args);
    if (!parsed) return null;
    return {
        residency: "Ft",
        tokenId: receiver_id,
        depositAddress: parsed.depositAddress,
        amountRaw: parsed.amountRaw,
    };
}

export function isIntentsDepositKind(kind: unknown): kind is FunctionCallKind {
    return parseIntentsDepositKind(kind) !== null;
}

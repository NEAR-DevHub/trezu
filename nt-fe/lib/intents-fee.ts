import { NEAR_NETWORK_ID } from "@/constants/network-ids";
import { validateAddress } from "@/lib/address-validation";
import { formatTokenQuantity } from "@/lib/amount-format";
import { getIntentsQuote } from "@/lib/api";
import Big from "@/lib/big";
import type { BlockchainType } from "@/lib/blockchain-utils";

export type PaymentBalanceWarningType =
    | "amount_exceeds_balance"
    | "fee_not_covered";

export interface PaymentBalanceWarning {
    type: PaymentBalanceWarningType;
    formattedFee?: string;
    symbol?: string;
}

export function isIntentsToken(token: { address?: string | null }): boolean {
    return (
        !!token.address &&
        (token.address.startsWith("nep141:") ||
            token.address.startsWith("nep245:") ||
            token.address.startsWith("1cs_v1:"))
    );
}

export function isIntentsCrossChainToken(token: {
    address?: string | null;
    network?: string | null;
}): boolean {
    return (
        !!token.address &&
        (token.address.startsWith("nep141:") ||
            token.address.startsWith("nep245:") ||
            token.address.startsWith("1cs_v1:")) &&
        (token.network || "").toLowerCase() !== NEAR_NETWORK_ID
    );
}

export function isNearChainNativeToken(token: {
    address?: string | null;
    network?: string | null;
    residency?: string | null;
}): boolean {
    const address = (token.address || "").toLowerCase();
    const network = (token.network || "").toLowerCase();
    const residency = (token.residency || "").toLowerCase();

    return (
        address === NEAR_NETWORK_ID &&
        (!network || network === NEAR_NETWORK_ID) &&
        (!residency || residency === NEAR_NETWORK_ID)
    );
}

export function isNearChainFtToken(token: {
    address?: string | null;
    network?: string | null;
    residency?: string | null;
}): boolean {
    const address = (token.address || "").toLowerCase();
    const network = (token.network || "").toLowerCase();
    const residency = (token.residency || "").toLowerCase();
    const isNearNetwork = !network || network === NEAR_NETWORK_ID;
    const isNearStyleFtAddress =
        !!address &&
        address !== NEAR_NETWORK_ID &&
        !address.startsWith("nep141:") &&
        !address.startsWith("nep245:");

    return isNearNetwork && (residency === "ft" || isNearStyleFtAddress);
}

function fromAmountRaw(rawAmount: bigint | string, decimals: number): Big {
    return Big(rawAmount.toString()).div(Big(10).pow(decimals));
}

export function computeQuoteNetworkFee(
    args?: {
        amountInFormatted?: string | null;
        amountOutFormatted?: string | null;
    } | null,
): string | undefined {
    try {
        const fee = Big(args?.amountInFormatted || "0").minus(
            Big(args?.amountOutFormatted || "0"),
        );
        return fee.gt(0) ? fee.toFixed() : undefined;
    } catch {
        return undefined;
    }
}

export async function estimateIntentsNetworkFee(args: {
    token: {
        address: string;
        decimals: number;
        /** 1Click routing id on the destination network, when it differs. */
        quoteAssetId?: string;
    };
    destinationAddress: string;
    destinationBlockchain?: BlockchainType;
}): Promise<{ networkFeeRaw: bigint; networkFee: Big }> {
    if (args.destinationBlockchain) {
        const result = validateAddress(
            args.destinationAddress,
            args.destinationBlockchain,
        );
        if (!result.isValid) {
            return {
                networkFeeRaw: 0n,
                networkFee: Big(0),
            };
        }
    }

    // The bridge fee is flat per route, so any amount above the bridge floor
    // prices it. Start at one whole token and step up while 1Click says the
    // amount is below the floor.
    let amount = 10n ** BigInt(args.token.decimals);
    let networkFeeRaw: bigint | null = null;
    for (let attempt = 0; networkFeeRaw === null; attempt++) {
        try {
            const response = await getIntentsQuote({
                swapType: "EXACT_INPUT",
                slippageTolerance: 0,
                originAsset: args.token.address,
                depositType: "INTENTS",
                destinationAsset: args.token.quoteAssetId ?? args.token.address,
                amount: amount.toString(),
                refundTo: "intents.near",
                refundType: "INTENTS",
                recipient: args.destinationAddress,
                recipientType: "DESTINATION_CHAIN",
                deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                quoteWaitingTimeMs: 0,
                isPayment: true,
            });
            if (!response?.quote) throw new Error("No quote returned");
            networkFeeRaw =
                BigInt(response.quote.amountIn) -
                BigInt(response.quote.amountOut);
        } catch (error) {
            const floor = /at least (\d+)/.exec(
                error instanceof Error ? error.message : "",
            )?.[1];
            if (!floor || attempt >= 2) throw error;
            const doubledFloor = BigInt(floor) * 2n;
            amount = doubledFloor > amount * 10n ? doubledFloor : amount * 10n;
        }
    }

    return {
        networkFeeRaw,
        networkFee: fromAmountRaw(networkFeeRaw, args.token.decimals),
    };
}

/** Non-blocking balance warning for payments (amount + fee vs treasury balance). */
export function getPaymentBalanceWarning(args: {
    amount: string;
    balance: Big;
    networkFee?: Big;
    decimals: number;
    symbol: string;
    locale?: string;
}): PaymentBalanceWarning | null {
    let enteredAmount: Big;
    try {
        enteredAmount = Big(args.amount);
    } catch {
        return null;
    }

    if (!enteredAmount.gt(0)) {
        return null;
    }

    if (enteredAmount.gt(args.balance)) {
        return { type: "amount_exceeds_balance" };
    }

    if (args.networkFee?.gt(0)) {
        const totalRequired = enteredAmount.plus(args.networkFee);
        if (totalRequired.gt(args.balance)) {
            return {
                type: "fee_not_covered",
                formattedFee: formatTokenQuantity(args.networkFee, {
                    profile: "compact",
                    tokenDecimals: args.decimals,
                    locale: args.locale,
                    rounding: "up",
                }).display,
                symbol: args.symbol,
            };
        }
    }

    return null;
}

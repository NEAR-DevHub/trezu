import Big from "@/lib/big";
import { getIntentsWithdrawalFee } from "@/lib/api";
import { stripIntentsTokenPrefix } from "@/lib/token-id";

export const NETWORK_FEE_TOOLTIP_TEXT =
    "This fee is used to process the transaction on the selected chain. It is deducted from the amount you enter, so the recipient receives less.";

export interface NetworkFeeCoverageResult {
    isCovered: boolean;
    enteredAmount: Big;
    networkFee: Big;
    minimumTotal: Big;
    addMore: Big;
}

export function isIntentsToken(token: { address?: string | null }): boolean {
    return (
        !!token.address &&
        (token.address.startsWith("nep141:") ||
            token.address.startsWith("nep245:"))
    );
}

export function isIntentsCrossChainToken(token: {
    address?: string | null;
    network?: string | null;
}): boolean {
    return (
        !!token.address &&
        (token.address.startsWith("nep141:") ||
            token.address.startsWith("nep245:")) &&
        (token.network || "").toLowerCase() !== "near"
    );
}

export async function estimateIntentsNetworkFee(args: {
    tokenId: string;
    chainId: string;
    destinationAddress: string;
}): Promise<{ networkFee: Big }> {
    const normalizedToken = stripIntentsTokenPrefix(args.tokenId);
    const response = await getIntentsWithdrawalFee({
        token: normalizedToken,
        address: args.destinationAddress,
        chain: args.chainId,
    });

    const rawFee = response?.withdrawalFee ?? "0";
    const feeDecimals = response?.withdrawalFeeDecimals ?? 0;
    return {
        networkFee: Big(rawFee).div(Big(10).pow(feeDecimals)),
    };
}

export function evaluateNetworkFeeCoverage(args: {
    amount: string;
    networkFee: Big;
    decimals: number;
}): NetworkFeeCoverageResult {
    const enteredAmount = Big(args.amount);
    const minimumTotal = args.networkFee;
    const addMoreRaw = minimumTotal.minus(enteredAmount);
    const addMore = addMoreRaw.gt(0) ? addMoreRaw : Big(0);

    return {
        isCovered: enteredAmount.gte(args.networkFee),
        enteredAmount,
        networkFee: args.networkFee,
        minimumTotal,
        addMore,
    };
}

function formatFeeAmountForMessage(value: Big, decimals: number): string {
    const displayDecimals = Math.max(0, Math.min(decimals, 8));
    const smallestDisplayUnit = Big(1).div(Big(10).pow(displayDecimals));
    const formatted = value.toFixed(displayDecimals).replace(/\.?0+$/, "");

    if (formatted && formatted !== "0") {
        return formatted;
    }

    if (value.gt(0)) {
        return `<${smallestDisplayUnit.toFixed(displayDecimals)}`;
    }

    return "0";
}

export function getNetworkFeeCoverageErrorMessage(args: {
    amount: string;
    networkFee: Big;
    decimals: number;
    symbol: string;
    prefix?: string;
}): string | null {
    const feeCoverage = evaluateNetworkFeeCoverage({
        amount: args.amount,
        networkFee: args.networkFee,
        decimals: args.decimals,
    });
    if (feeCoverage.isCovered) {
        return null;
    }

    const rowPrefix = args.prefix ?? "";
    return `${rowPrefix}Amount too low for network fee (${formatFeeAmountForMessage(feeCoverage.networkFee, args.decimals)} ${args.symbol}). Add at least ${formatFeeAmountForMessage(feeCoverage.addMore, args.decimals)} ${args.symbol}.`;
}

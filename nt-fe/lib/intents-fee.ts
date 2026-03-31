import { IntentsSDK } from "@defuse-protocol/intents-sdk";
import Big from "@/lib/big";
import { validateAddress } from "@/lib/address-validation";
import type { BlockchainType } from "@/lib/blockchain-utils";

const intentsSdk = new IntentsSDK({
    referral: "",
});

export const NETWORK_FEE_TOOLTIP_TEXT =
    "This fee is used to process the transaction on the selected chain. It is deducted from the amount you enter, so the recipient receives less.";

export interface NetworkFeeCoverageResult {
    isCovered: boolean;
    enteredAmount: Big;
    networkFee: Big;
    minimumTotal: Big;
    addMore: Big;
}

export function isIntentsCrossChainToken(token: {
    address?: string | null;
    network?: string | null;
}): boolean {
    return (
        !!token.address &&
        token.address.startsWith("nep141:") &&
        (token.network || "").toLowerCase() !== "near"
    );
}

function fromAmountRaw(rawAmount: bigint | string, decimals: number): Big {
    return Big(rawAmount.toString()).div(Big(10).pow(decimals));
}

export async function estimateIntentsNetworkFee(args: {
    token: {
        address: string;
        decimals: number;
        minWithdrawalAmount?: string;
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

    const feeEstimation = await intentsSdk.estimateWithdrawalFee({
        withdrawalParams: {
            assetId: args.token.address,
            amount:
                args.token.minWithdrawalAmount &&
                BigInt(args.token.minWithdrawalAmount) > 0n
                    ? BigInt(args.token.minWithdrawalAmount)
                    : 100000000n,
            destinationAddress: args.destinationAddress,
            feeInclusive: false,
        },
    });
    const networkFeeRaw = sumNetworkFees(feeEstimation.underlyingFees);

    return {
        networkFeeRaw,
        networkFee: fromAmountRaw(networkFeeRaw, args.token.decimals),
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

export function sumNetworkFees(underlyingFees: unknown): bigint {
    if (!underlyingFees || typeof underlyingFees !== "object") {
        return 0n;
    }

    let networkFeeRaw = 0n;

    const walk = (value: unknown) => {
        if (!value || typeof value !== "object") return;

        for (const [key, nestedValue] of Object.entries(
            value as Record<string, unknown>,
        )) {
            if (typeof nestedValue === "bigint") {
                if (key.endsWith("Fee")) {
                    networkFeeRaw += nestedValue;
                }
                continue;
            }

            walk(nestedValue);
        }
    };

    walk(underlyingFees);
    return networkFeeRaw;
}

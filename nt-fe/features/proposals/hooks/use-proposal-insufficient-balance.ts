"use client";

import { useMemo } from "react";
import Big from "@/lib/big";
import { Proposal } from "@/lib/proposals-api";
import { useAssets } from "@/hooks/use-assets";
import { getProposalRequiredFunds } from "../utils/proposal-utils";
import { formatBalance } from "@/lib/utils";
import { availableBalance } from "@/lib/balance";

export interface InsufficientBalanceInfo {
    hasInsufficientBalance: boolean;
    tokenSymbol?: string;
    type?: "bond" | "balance" | "no-asset";
    tokenNetwork?: string;
    differenceDisplay?: string;
}

/**
 * Hook to check if a proposal requires more funds than available in treasury
 * @param proposal The proposal to check
 * @param treasuryId The treasury ID to fetch balance for
 * @returns Object with insufficient balance info and loading state
 */
export function useProposalInsufficientBalance(
    proposal: Proposal | null | undefined,
    treasuryId: string | null | undefined,
): {
    data: InsufficientBalanceInfo;
    isLoading: boolean;
} {
    const requiredFunds = useMemo(() => {
        if (!proposal) return null;
        return getProposalRequiredFunds(proposal, treasuryId ?? undefined);
    }, [proposal]);

    const { data: assets, isLoading: isAssetsLoading } = useAssets(treasuryId);

    const insufficientBalanceInfo = useMemo((): InsufficientBalanceInfo => {
        if (assets && requiredFunds) {
            const matchingAssets = assets.tokens.filter(
                (t) =>
                    t.contractId === requiredFunds.tokenId ||
                    (requiredFunds.tokenId.toLowerCase() === "near" &&
                        t.contractId == null &&
                        t.residency === "Near"),
            );
            if (matchingAssets.length === 0) {
                return {
                    hasInsufficientBalance: true,
                    type: "no-asset",
                };
            }

            const spendableAssets = matchingAssets.filter(
                (asset) =>
                    !asset.lockupInstanceId && asset.residency !== "Lockup",
            );
            const assetsToCheck =
                spendableAssets.length > 0 ? spendableAssets : matchingAssets;
            const primaryAsset = assetsToCheck[0];

            const requiredBig = Big(requiredFunds.amount || "0");
            const availableBig = assetsToCheck.reduce(
                (sum, asset) => sum.add(availableBalance(asset.balance)),
                Big(0),
            );

            if (requiredBig.gt(availableBig)) {
                return {
                    hasInsufficientBalance: true,
                    tokenSymbol: primaryAsset.symbol,
                    type: "balance",
                    tokenNetwork: primaryAsset.network,
                    differenceDisplay: formatBalance(
                        requiredBig.sub(availableBig).toString(),
                        primaryAsset.decimals || 24,
                    ),
                };
            }
        }

        return { hasInsufficientBalance: false };
    }, [requiredFunds, assets]);

    return {
        data: insufficientBalanceInfo,
        isLoading: isAssetsLoading,
    };
}

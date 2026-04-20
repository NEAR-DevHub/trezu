"use client";

import { useMemo } from "react";
import Big from "@/lib/big";
import { Proposal } from "@/lib/proposals-api";
import { useAssets } from "@/hooks/use-assets";
import { getProposalRequiredFunds } from "../utils/proposal-utils";
import { availableBalance } from "@/lib/balance";

/**
 * Hook to check which proposals in a list have insufficient treasury balance for approval.
 * Returns a Set of proposal IDs that cannot be approved due to insufficient balance.
 */
export function useProposalsInsufficientBalance(
    proposals: Proposal[],
    treasuryId: string | null | undefined,
): {
    insufficientBalanceIds: Set<number>;
    isLoading: boolean;
} {
    const { data: assets, isLoading } = useAssets(treasuryId);

    const insufficientBalanceIds = useMemo(() => {
        const ids = new Set<number>();
        if (!assets) return ids;

        for (const proposal of proposals) {
            const requiredFunds = getProposalRequiredFunds(
                proposal,
                treasuryId ?? undefined,
            );
            if (!requiredFunds) continue;

            const token = assets.tokens.find(
                (t) =>
                    t.contractId === requiredFunds.tokenId ||
                    (requiredFunds.tokenId.toLowerCase() === "near" &&
                        t.contractId == null &&
                        t.residency === "Near"),
            );
            const required = Big(requiredFunds.amount || "0");
            const available = token ? availableBalance(token.balance) : Big(0);
            if (required.gt(available)) {
                ids.add(proposal.id);
            }
        }
        return ids;
    }, [proposals, assets]);

    return { insufficientBalanceIds, isLoading };
}

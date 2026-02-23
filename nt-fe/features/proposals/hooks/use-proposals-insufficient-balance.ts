"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import Big from "@/lib/big";
import { Proposal } from "@/lib/proposals-api";
import { getTokenBalance, getTokenMetadata } from "@/lib/api";
import { getProposalRequiredFunds } from "../utils/proposal-utils";

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
    const requiredFundsPerProposal = useMemo(
        () =>
            proposals.map((p) => ({
                proposalId: p.id,
                requiredFunds: getProposalRequiredFunds(p),
            })),
        [proposals],
    );

    // Collect unique token IDs that need to be fetched
    const uniqueTokenIds = useMemo(() => {
        const ids = new Set<string>();
        for (const { requiredFunds } of requiredFundsPerProposal) {
            if (requiredFunds?.tokenId) {
                ids.add(requiredFunds.tokenId);
            }
        }
        return Array.from(ids);
    }, [requiredFundsPerProposal]);

    // Fetch metadata for all unique tokens
    const tokenMetadataQueries = useQueries({
        queries: uniqueTokenIds.map((tokenId) => ({
            queryKey: ["tokenMetadata", tokenId],
            queryFn: () => getTokenMetadata(tokenId),
            enabled: !!tokenId,
            staleTime: 1000 * 60 * 5,
        })),
    });

    // Build a map of tokenId -> metadata (only when loaded)
    const tokenMetadataMap = useMemo(() => {
        const map = new Map<
            string,
            { symbol: string; network: string; decimals: number }
        >();
        uniqueTokenIds.forEach((tokenId, index) => {
            const query = tokenMetadataQueries[index];
            if (query.data) {
                map.set(tokenId, query.data);
            }
        });
        return map;
    }, [uniqueTokenIds, tokenMetadataQueries]);

    // Collect unique (tokenId, network) combos for balance fetching
    const uniqueBalanceKeys = useMemo(() => {
        const seen = new Set<string>();
        const keys: { tokenId: string; network: string }[] = [];
        for (const tokenId of uniqueTokenIds) {
            const meta = tokenMetadataMap.get(tokenId);
            if (meta) {
                const key = `${tokenId}:${meta.network}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    keys.push({ tokenId, network: meta.network });
                }
            }
        }
        return keys;
    }, [uniqueTokenIds, tokenMetadataMap]);

    // Fetch balances for all unique token/network combos
    const balanceQueries = useQueries({
        queries: uniqueBalanceKeys.map(({ tokenId, network }) => ({
            queryKey: ["tokenBalance", treasuryId, tokenId],
            queryFn: () => getTokenBalance(treasuryId!, tokenId, network),
            enabled: !!treasuryId && !!tokenId && !!network,
            staleTime: 1000 * 5,
            refetchInterval: 1000 * 5,
        })),
    });

    // Build a map of tokenId -> balance
    const balanceMap = useMemo(() => {
        const map = new Map<string, string>();
        uniqueBalanceKeys.forEach(({ tokenId }, index) => {
            const query = balanceQueries[index];
            if (query.data?.balance !== undefined) {
                map.set(tokenId, query.data.balance);
            }
        });
        return map;
    }, [uniqueBalanceKeys, balanceQueries]);

    const isLoading =
        tokenMetadataQueries.some((q) => q.isLoading) ||
        balanceQueries.some((q) => q.isLoading);

    const insufficientBalanceIds = useMemo(() => {
        const ids = new Set<number>();
        for (const { proposalId, requiredFunds } of requiredFundsPerProposal) {
            if (!requiredFunds) continue;
            const balance = balanceMap.get(requiredFunds.tokenId);
            if (balance === undefined) continue;
            const required = Big(requiredFunds.amount || "0");
            const available = Big(balance || "0");
            if (required.gt(available)) {
                ids.add(proposalId);
            }
        }
        return ids;
    }, [requiredFundsPerProposal, balanceMap]);

    return { insufficientBalanceIds, isLoading };
}

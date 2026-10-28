"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDepositAddress } from "@/lib/bridge-api";

export type ConfidentialBridgeAddressState = {
    address: string | null;
    memo: string | null;
    hasFetched: boolean;
};

const IDLE: ConfidentialBridgeAddressState = {
    address: null,
    memo: null,
    hasFetched: false,
};

/**
 * Resolve the chain deposit address for a confidential quote id.
 * Quote id is not a DAO — POST deposit-address only runs the bridge lookup.
 *
 * With `treasuryId` + `tokenId` (reusable address share links) the lookup
 * runs for the treasury instead: the backend serves its cached reusable
 * address set for the chain, which needs no quote and no membership.
 */
export function useConfidentialBridgeAddress(options: {
    enabled: boolean;
    quoteDepositAddress: string | null | undefined;
    bridgeChainId: string | null | undefined;
    treasuryId?: string | null;
    tokenId?: string | null;
}): ConfidentialBridgeAddressState {
    const { enabled, quoteDepositAddress, bridgeChainId, treasuryId, tokenId } =
        options;
    const lookupAccount = treasuryId || quoteDepositAddress;

    const query = useQuery({
        queryKey: [
            "confidential-bridge-deposit-address",
            lookupAccount,
            bridgeChainId,
            treasuryId ? tokenId : null,
        ],
        queryFn: async () => {
            const result = await fetchDepositAddress(
                lookupAccount!,
                bridgeChainId!,
                treasuryId ? (tokenId ?? undefined) : undefined,
            );
            return {
                address: result?.address ?? null,
                memo: result?.memo ?? null,
            };
        },
        enabled: enabled && !!lookupAccount && !!bridgeChainId,
        staleTime: 1000 * 60 * 5,
        retry: 1,
    });

    if (!enabled || !lookupAccount || !bridgeChainId) {
        return IDLE;
    }

    if (!query.isFetched && !query.isError) {
        return IDLE;
    }

    return {
        address: query.data?.address ?? null,
        memo: query.data?.memo ?? null,
        hasFetched: true,
    };
}

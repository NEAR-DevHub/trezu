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
 * Resolve the chain funding address of a confidential treasury's reusable
 * deposit set for `tokenId` on `bridgeChainId`. The backend serves the
 * cached set, which needs no quote and no membership.
 */
export function useConfidentialBridgeAddress(options: {
    enabled: boolean;
    bridgeChainId: string | null | undefined;
    treasuryId: string | null | undefined;
    tokenId: string | null | undefined;
}): ConfidentialBridgeAddressState {
    const { enabled, bridgeChainId, treasuryId, tokenId } = options;

    const query = useQuery({
        queryKey: [
            "confidential-bridge-deposit-address",
            treasuryId,
            bridgeChainId,
            tokenId,
        ],
        queryFn: async () => {
            const result = await fetchDepositAddress(
                treasuryId!,
                bridgeChainId!,
                tokenId ?? undefined,
            );
            return {
                address: result?.address ?? null,
                memo: result?.memo ?? null,
            };
        },
        enabled: enabled && !!treasuryId && !!bridgeChainId,
        staleTime: 1000 * 60 * 5,
        retry: 1,
    });

    if (!enabled || !treasuryId || !bridgeChainId) {
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

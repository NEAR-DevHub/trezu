"use client";

import { useQuery } from "@tanstack/react-query";
import {
    estimateIntentsNetworkFee,
    isIntentsCrossChainToken,
} from "@/lib/intents-fee";

interface IntentsFeeToken {
    address: string;
    network: string;
    chainId?: string;
}

interface UseIntentsWithdrawalFeeParams {
    token: IntentsFeeToken | null | undefined;
    destinationAddress: string | null | undefined;
}

export interface IntentsWithdrawalFeeData {
    networkFee: string;
}

export function useIntentsWithdrawalFee({
    token,
    destinationAddress,
}: UseIntentsWithdrawalFeeParams) {
    const isCrossChainIntents = !!token && isIntentsCrossChainToken(token);
    const normalizedDestinationAddress = destinationAddress?.trim() ?? "";

    const shouldEstimate =
        isCrossChainIntents &&
        normalizedDestinationAddress.length > 0 &&
        !!token?.chainId;

    const query = useQuery({
        queryKey: [
            "intentsWithdrawalFee",
            token?.address,
            token?.network,
            token?.chainId,
            normalizedDestinationAddress,
        ],
        queryFn: async (): Promise<IntentsWithdrawalFeeData> => {
            if (!token) {
                throw new Error("Token is required");
            }

            const { networkFee } = await estimateIntentsNetworkFee({
                tokenId: token.address,
                chainId: token.chainId!,
                destinationAddress: normalizedDestinationAddress,
            });

            return {
                networkFee: networkFee.toString(),
            };
        },
        enabled: shouldEstimate,
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
    });

    return {
        ...query,
        shouldEstimate,
        isIntentsCrossChainToken: isCrossChainIntents,
    };
}

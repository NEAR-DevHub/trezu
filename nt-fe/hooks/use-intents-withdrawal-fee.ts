"use client";

import { useQuery } from "@tanstack/react-query";
import {
    estimateIntentsNetworkFee,
    isIntentsCrossChainToken,
} from "@/lib/intents-fee";
import { getBlockchainType } from "@/lib/blockchain-utils";

interface IntentsFeeToken {
    address: string;
    network: string;
    decimals: number;
    minWithdrawalAmount?: string;
}

interface UseIntentsWithdrawalFeeParams {
    token: IntentsFeeToken | null | undefined;
    destinationAddress: string | null | undefined;
}

export interface IntentsWithdrawalFeeData {
    networkFeeRaw: string;
    networkFee: string;
}

export function useIntentsWithdrawalFee({
    token,
    destinationAddress,
}: UseIntentsWithdrawalFeeParams) {
    const isCrossChainIntents = !!token && isIntentsCrossChainToken(token);

    const shouldEstimate = isCrossChainIntents && !!destinationAddress;

    const query = useQuery({
        queryKey: [
            "intentsWithdrawalFee",
            token?.address,
            token?.network,
            token?.decimals,
            token?.minWithdrawalAmount,
            destinationAddress,
        ],
        queryFn: async (): Promise<IntentsWithdrawalFeeData> => {
            if (!token) {
                throw new Error("Token is required");
            }

            const { networkFeeRaw, networkFee } =
                await estimateIntentsNetworkFee({
                    token: {
                        address: token.address,
                        decimals: token.decimals,
                        minWithdrawalAmount: token.minWithdrawalAmount,
                    },
                    destinationAddress: destinationAddress!,
                    destinationBlockchain: getBlockchainType(token.network),
                });

            return {
                networkFeeRaw: networkFeeRaw.toString(),
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

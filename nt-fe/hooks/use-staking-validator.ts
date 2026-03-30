"use client";

import { useQuery } from "@tanstack/react-query";
import {
    getStakingValidatorDetails,
    type StakingValidatorDetails,
} from "@/lib/api";

/**
 * Query hook to get staking validator metadata (APY + fee) for a pool.
 * Data is cached long-term by backend.
 */
export function useStakingValidator(poolId: string | null | undefined) {
    return useQuery<StakingValidatorDetails | null>({
        queryKey: ["stakingValidatorDetails", poolId],
        queryFn: () => getStakingValidatorDetails(poolId!),
        enabled: !!poolId,
        staleTime: 1000 * 60 * 60 * 6,
    });
}

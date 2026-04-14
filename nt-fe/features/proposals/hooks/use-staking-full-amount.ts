import { useAssets } from "@/hooks/use-assets";
import { useTreasuryPolicy } from "@/hooks/use-treasury-queries";
import { useQuery } from "@tanstack/react-query";
import { Proposal, getProposalStakingAmount } from "@/lib/proposals-api";
import { StakingData } from "../types/index";

/**
 * Resolve the actual NEAR amount for a "full amount" staking proposal
 * (unstake_all / withdraw_all / withdraw_all_from_staking_pool).
 *
 * - InProgress proposals: read the live pool balance from `useAssets`.
 * - Executed (non-InProgress) proposals: call the backend staking-amount
 *   endpoint, which resolves the execution block and queries the pool's
 *   `get_account` at block-1 via archival RPC.
 */
export function useStakingFullAmount(
    data: StakingData,
    proposal: Proposal,
    treasuryId: string | null | undefined,
): { amount: string | null; isLoading: boolean } {
    const isFull = data.isFullAmount;
    const isInProgress = proposal.status === "InProgress";

    // --- In-progress: current pool balance ---
    const { data: assets, isLoading: assetsLoading } = useAssets(treasuryId, {
        enabled: isFull && isInProgress && !!treasuryId,
    });

    // --- Executed: backend staking-amount lookup ---
    const { data: policy } = useTreasuryPolicy(
        isFull && !isInProgress ? treasuryId : null,
    );
    const { data: resolved, isLoading: resolvedLoading } = useQuery({
        queryKey: [
            "proposal-staking-amount",
            treasuryId,
            proposal.id,
            proposal.status,
        ],
        queryFn: () => getProposalStakingAmount(treasuryId!, proposal, policy!),
        enabled: isFull && !isInProgress && !!treasuryId && !!policy,
        staleTime: 1000 * 60 * 60,
    });

    if (!isFull) return { amount: null, isLoading: false };

    if (isInProgress) {
        if (!assets) return { amount: null, isLoading: assetsLoading };
        return {
            amount: resolveFromAssets(assets.tokens, data),
            isLoading: assetsLoading,
        };
    }

    return {
        amount: resolved?.amount ?? null,
        isLoading: resolvedLoading,
    };
}

function resolveFromAssets(
    tokens: ReturnType<typeof useAssets>["data"] extends infer T
        ? T extends { tokens: infer U }
            ? U
            : never
        : never,
    data: StakingData,
): string | null {
    const isUnstake = data.action === "unstake_all";
    const isWithdraw =
        data.action === "withdraw_all" ||
        data.action === "withdraw_all_from_staking_pool";

    if (data.isLockup) {
        const vested = tokens.find((t) => t.balance.type === "Vested");
        if (!vested || vested.balance.type !== "Vested") return null;
        const lockup = vested.balance.lockup;
        if (isUnstake) return lockup.staked.toString();
        if (isWithdraw) return lockup.unstakedBalance.toString();
        return null;
    }

    const staked = tokens.find((t) => t.balance.type === "Staked");
    if (!staked || staked.balance.type !== "Staked") return null;
    const pool = staked.balance.staking.pools.find(
        (p) => p.poolId === data.receiver,
    );
    if (!pool) return null;
    if (isUnstake) return pool.stakedBalance.toString();
    if (isWithdraw) return pool.unstakedBalance.toString();
    return null;
}

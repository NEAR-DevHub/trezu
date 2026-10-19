"use client";

import { useSwapStatus } from "@/hooks/use-proposals";
import { useTreasury } from "@/hooks/use-treasury";
import type { Proposal } from "@/lib/proposals-api";
import type { Policy } from "@/types/policy";
import {
    getProposalStatus,
    type UIProposalStatus,
} from "../utils/proposal-utils";
import {
    extractReceiptProposalData,
    isTerminalSwapStatus,
} from "../utils/receipt-utils";

/**
 * The status a request shows. An approved intents-routed request stays
 * "Processing" until its 1Click swap settles, then becomes "Executed" or
 * "Failed".
 *
 * The outcome comes from the backend's persisted `swap_status`, the same
 * value it buckets the request into the Failed tab with, so the status and
 * the tab never disagree. A settled persisted outcome is final and needs no
 * request. While it is still in flight the live swap-status query keeps
 * running: the backend stops refreshing old quotes on its own, so this is
 * the refresh path for a request whose stored status went stale, and the
 * live answer wins over it (the backend records a settled one). `undefined`
 * means a live query the status depends on has not resolved, or it failed:
 * the request may already be settled, so callers show a skeleton instead of
 * "Executed". A 404 returns null from `getSwapStatus` and still falls back
 * to the on-chain outcome.
 */
export function useProposalStatus(
    proposal: Proposal,
    policy: Policy,
): UIProposalStatus | undefined {
    const { treasuryId } = useTreasury();
    const isApproved = proposal.status === "Approved";
    const persistedStatus = isApproved
        ? (proposal.swap_status ?? undefined)
        : undefined;
    const isSettled = isTerminalSwapStatus(persistedStatus);
    const depositAddress =
        isApproved && !isSettled
            ? extractReceiptProposalData(proposal, treasuryId)?.depositAddress
            : undefined;
    const {
        data: swapStatus,
        isPending,
        isError,
    } = useSwapStatus(
        depositAddress,
        undefined,
        isApproved && !isSettled,
        treasuryId,
    );

    if (isSettled) {
        return getProposalStatus(proposal, policy, persistedStatus);
    }
    if (persistedStatus) {
        // Until the live query answers (or when it fails) the stored
        // in-flight status stands; it is never worse than a skeleton.
        return getProposalStatus(
            proposal,
            policy,
            swapStatus?.status ?? persistedStatus,
        );
    }

    // A 404 is returned as null and falls through to the on-chain outcome.
    // A network or server error must not: data is missing, and treating that
    // as Executed would open Receipt for a swap we never confirmed.
    if (depositAddress && (isPending || isError)) return undefined;

    return getProposalStatus(proposal, policy, swapStatus?.status);
}

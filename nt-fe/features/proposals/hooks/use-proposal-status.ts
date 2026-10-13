"use client";

import { useSwapStatus } from "@/hooks/use-proposals";
import { useTreasury } from "@/hooks/use-treasury";
import type { Proposal } from "@/lib/proposals-api";
import type { Policy } from "@/types/policy";
import {
    getProposalStatus,
    type UIProposalStatus,
} from "../utils/proposal-utils";
import { extractReceiptProposalData } from "../utils/receipt-utils";

/**
 * The status a request shows. An approved intents-routed request stays
 * "Processing" until its 1Click swap settles, then becomes "Executed" or
 * "Failed". Shares the swap-status query with the rest of the details views,
 * so it adds no requests of its own. `undefined` means the swap query has
 * not resolved, or it failed. The request may already be settled, so callers
 * show a skeleton instead of "Executed". A 404 returns null from
 * `getSwapStatus` and still falls back to the on-chain outcome.
 */
export function useProposalStatus(
    proposal: Proposal,
    policy: Policy,
): UIProposalStatus | undefined {
    const { treasuryId } = useTreasury();
    const isApproved = proposal.status === "Approved";
    const depositAddress = isApproved
        ? extractReceiptProposalData(proposal, treasuryId)?.depositAddress
        : undefined;
    const {
        data: swapStatus,
        isPending,
        isError,
    } = useSwapStatus(depositAddress, undefined, isApproved, treasuryId);

    // A 404 is returned as null and falls through to the on-chain outcome.
    // A network or server error must not: data is missing, and treating that
    // as Executed would open Receipt for a swap we never confirmed.
    if (depositAddress && (isPending || isError)) return undefined;

    return getProposalStatus(proposal, policy, swapStatus?.status);
}

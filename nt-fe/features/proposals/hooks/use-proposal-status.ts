"use client";

import { useSwapStatus } from "@/hooks/use-proposals";
import { useTreasury } from "@/hooks/use-treasury";
import type { Proposal } from "@/lib/proposals-api";
import type { Policy } from "@/types/policy";
import { getProposalStatus } from "../utils/proposal-utils";
import { extractReceiptProposalData } from "../utils/receipt-utils";

/**
 * The status a request shows. An approved intents-routed request stays
 * "Processing" until its 1Click swap settles, then becomes "Executed" or
 * "Failed". Shares the swap-status query with the rest of the details views,
 * so it adds no requests of its own.
 */
export function useProposalStatus(proposal: Proposal, policy: Policy) {
    const { treasuryId } = useTreasury();
    const isApproved = proposal.status === "Approved";
    const depositAddress = isApproved
        ? extractReceiptProposalData(proposal, treasuryId)?.depositAddress
        : undefined;
    const { data: swapStatus } = useSwapStatus(
        depositAddress,
        undefined,
        isApproved,
        treasuryId,
    );

    return getProposalStatus(proposal, policy, swapStatus?.status);
}

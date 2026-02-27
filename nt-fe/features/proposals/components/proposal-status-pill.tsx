"use client";

import { cn } from "@/lib/utils";
import { UIProposalStatus, getProposalStatus } from "../utils/proposal-utils";
import { Tooltip } from "@/components/tooltip";
import { Proposal } from "@/lib/proposals-api";
import { Policy } from "@/types/policy";
import { getApproversAndThreshold } from "@/lib/config-utils";
import { useProposalTransaction } from "@/hooks/use-proposals";
import { useTreasury } from "@/hooks/use-treasury";
import Link from "next/link";

interface StatusPillProps {
    status: UIProposalStatus | "Paid" | "Approved";
    className?: string;
}

export function getStatusColor(
    status: UIProposalStatus | "Paid" | "Approved",
): string {
    switch (status) {
        case "Approved":
        case "Executed":
        case "Paid":
            return "bg-general-success-background-faded text-general-success-foreground";
        case "Failed":
            return "bg-general-warning-background-faded text-general-warning-foreground";
        case "Rejected":
        case "Removed":
            return "bg-general-destructive-background-faded text-general-destructive-foreground";
        case "Pending":
            return "bg-general-orange-background-faded text-general-orange-foreground";
        case "Expired":
            return "bg-secondary text-secondary-foreground";
        default:
            return "bg-muted text-muted-foreground";
    }
}

export function getStatusLabel(
    status: UIProposalStatus | "Paid" | "Approved",
): string {
    switch (status) {
        case "Approved":
        case "Paid":
        case "Executed":
            return "Executed";
        case "Pending":
            return "Pending";
        default:
            return status;
    }
}

export function StatusPill({ status, className }: StatusPillProps) {
    return (
        <span
            className={cn(
                "inline-flex px-2 py-1 rounded-md text-xs font-medium",
                getStatusColor(status),
                className,
            )}
        >
            {getStatusLabel(status)}
        </span>
    );
}

function getStatusTooltip(
    status: UIProposalStatus,
    approveCount: number,
    rejectCount: number,
    requiredVotes: number,
    nearblocksUrl?: string,
): React.ReactNode | undefined {
    switch (status) {
        case "Pending":
            return "This request is still pending and has not yet reached the required number of votes for execution.";
        case "Executed":
            return `Executed after ${approveCount} of ${requiredVotes} members approved the request.`;
        case "Rejected":
            return `Rejected after ${rejectCount} of ${requiredVotes} members voted to reject the request.`;
        case "Expired":
            return "Expired as it did not receive enough votes to execute.";
        case "Failed": {
            if (nearblocksUrl) {
                return (
                    <span>
                        The request failed to complete. Check the transaction
                        details{" "}
                        <Link
                            href={nearblocksUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                        >
                            here.
                        </Link>
                    </span>
                );
            }
            return "The request failed to complete. Check the transaction details here.";
        }
        default:
            return undefined;
    }
}

interface ProposalStatusPillProps {
    proposal: Proposal;
    policy: Policy;
    className?: string;
}

/**
 * Status pill with dynamic tooltips derived from the proposal and policy.
 * Shows actual vote counts and, for Failed proposals, a transaction link.
 */
export function ProposalStatusPill({
    proposal,
    policy,
    className,
}: ProposalStatusPillProps) {
    const { treasuryId } = useTreasury();
    const status = getProposalStatus(proposal, policy);

    const isFailed = status === "Failed";

    const { data: transaction } = useProposalTransaction(
        treasuryId,
        proposal,
        policy,
        isFailed,
    );

    const { requiredVotes } = getApproversAndThreshold(
        policy,
        "",
        proposal.kind,
        false,
    );

    const approveCount = Object.values(proposal.votes).filter(
        (v) => v === "Approve",
    ).length;
    const rejectCount = Object.values(proposal.votes).filter(
        (v) => v === "Reject",
    ).length;

    const info = getStatusTooltip(
        status,
        approveCount,
        rejectCount,
        requiredVotes,
        transaction?.nearblocks_url,
    );

    return (
        <Tooltip content={info} triggerProps={{ asChild: false }}>
            <StatusPill status={status} className={className} />
        </Tooltip>
    );
}

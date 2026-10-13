"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { UIProposalStatus } from "../utils/proposal-utils";
import { useProposalStatus } from "../hooks/use-proposal-status";
import { Tooltip } from "@/components/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Proposal } from "@/lib/proposals-api";
import { Policy } from "@/types/policy";
import { getApproversAndThreshold } from "@/lib/config-utils";
import { useProposalTransaction } from "@/hooks/use-proposals";
import { useTreasury } from "@/hooks/use-treasury";

type PillStatus = UIProposalStatus | "Paid" | "Approved";

interface StatusPillProps {
    status: PillStatus;
    className?: string;
}

export function getStatusColor(status: PillStatus): string {
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
        case "Processing":
            return "bg-general-orange-background-faded text-general-orange-foreground";
        case "Expired":
            return "bg-secondary text-secondary-foreground";
        default:
            return "bg-muted text-muted-foreground";
    }
}

function statusKey(status: PillStatus): string {
    switch (status) {
        case "Approved":
        case "Paid":
        case "Executed":
            return "executed";
        case "Pending":
            return "pending";
        case "Processing":
            return "processing";
        case "Rejected":
            return "rejected";
        case "Expired":
            return "expired";
        case "Failed":
            return "failed";
        case "Removed":
            return "removed";
        default:
            return "pending";
    }
}

export function StatusPill({ status, className }: StatusPillProps) {
    const t = useTranslations("proposals.status");
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium",
                getStatusColor(status),
                className,
            )}
        >
            {status === "Processing" && (
                <Loader2 className="size-3 animate-spin" />
            )}
            {t(statusKey(status))}
        </span>
    );
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
    const tTooltip = useTranslations("proposals.statusTooltip");
    const { treasuryId } = useTreasury();
    const status = useProposalStatus(proposal, policy);

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

    if (!status) {
        return <Skeleton className={cn("h-6 w-20 rounded-md", className)} />;
    }

    let info: React.ReactNode | undefined;
    switch (status) {
        case "Pending":
            info = tTooltip("pending");
            break;
        case "Processing":
            info = tTooltip("processing");
            break;
        case "Executed":
            info = tTooltip("executed", {
                approved: approveCount,
                required: requiredVotes,
            });
            break;
        case "Rejected":
            info = tTooltip("rejected", {
                rejected: rejectCount,
                required: requiredVotes,
            });
            break;
        case "Expired":
            info = tTooltip("expired");
            break;
        case "Failed":
            info = transaction?.nearblocks_url
                ? tTooltip.rich("failed", {
                      link: (chunks) => (
                          <Link
                              href={transaction.nearblocks_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                          >
                              {chunks}
                          </Link>
                      ),
                  })
                : tTooltip("failedPlain");
            break;
        default:
            info = undefined;
    }

    return (
        <Tooltip content={info} triggerProps={{ asChild: false }}>
            <StatusPill status={status} className={className} />
        </Tooltip>
    );
}

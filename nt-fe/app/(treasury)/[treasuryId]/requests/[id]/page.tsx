"use client";

import { use, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageComponentLayout } from "@/components/page-component-layout";
import { ExpandedView } from "@/features/proposals";
import { useProposal } from "@/hooks/use-proposals";
import { useTreasuryPolicy } from "@/hooks/use-treasury-queries";
import { useTreasury } from "@/hooks/use-treasury";
import { VoteModal } from "@/features/proposals/components/vote-modal";
import { DepositModal } from "@/app/(treasury)/[treasuryId]/dashboard/components/deposit-modal";
import { Proposal } from "@/lib/proposals-api";
import { Skeleton } from "@/components/ui/skeleton";
import { PageCard } from "@/components/card";
import { redirect } from "next/navigation";

interface RequestPageProps {
    params: Promise<{
        id: string;
    }>;
}

function RequestPageSkeleton() {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 w-full">
            <div className="w-full flex flex-col gap-4">
                <PageCard className="w-full">
                    <Skeleton className="h-8 w-48 mb-6" />
                    <Skeleton className="h-[300px] w-full" />
                </PageCard>
            </div>
            <div className="w-full">
                <PageCard className="w-full">
                    <Skeleton className="h-[200px] w-full" />
                </PageCard>
            </div>
        </div>
    );
}

export default function RequestPage({ params }: RequestPageProps) {
    const { id } = use(params);
    const { treasuryId } = useTreasury();
    const router = useRouter();
    const queryClient = useQueryClient();
    const cachedSubmissionTime = useMemo(() => {
        const cachedQueries = queryClient.getQueriesData({
            queryKey: ["proposals", treasuryId],
        });

        for (const [, queryData] of cachedQueries) {
            const proposals = (
                queryData as
                    | { proposals?: { id: number; submission_time?: string }[] }
                    | undefined
            )?.proposals;
            if (!proposals?.length) continue;

            const matchedProposal = proposals.find(
                (cachedProposal) => String(cachedProposal.id) === id,
            );
            if (matchedProposal?.submission_time) {
                return matchedProposal.submission_time;
            }
        }

        return null;
    }, [id, queryClient, treasuryId]);
    const { data: proposal, isLoading: isLoadingProposal } = useProposal(
        treasuryId,
        id,
    );
    const submissionTime = proposal?.submission_time ?? cachedSubmissionTime;
    const canLoadPolicy = !!treasuryId && !!submissionTime;
    const { data: policy, isLoading: isLoadingPolicy } = useTreasuryPolicy(
        canLoadPolicy ? treasuryId : null,
        submissionTime,
    );

    const [isVoteModalOpen, setIsVoteModalOpen] = useState(false);
    const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
    const [{ tokenSymbol, tokenNetwork }, setDepositTokenInfo] = useState<{
        tokenSymbol?: string;
        tokenNetwork?: string;
    }>({});
    const [voteInfo, setVoteInfo] = useState<{
        vote: "Approve" | "Reject" | "Remove";
        proposals: Proposal[];
    }>({ vote: "Approve", proposals: [] });

    if (isLoadingProposal || (canLoadPolicy && isLoadingPolicy)) {
        return (
            <PageComponentLayout
                title={`Request #${id}`}
                description="Details for Request"
                backButton={`/${treasuryId}/requests`}
            >
                <RequestPageSkeleton />
            </PageComponentLayout>
        );
    }

    if (!proposal) {
        redirect(`/${treasuryId}/requests`);
    }

    if (!policy) {
        redirect(`/${treasuryId}/requests`);
    }

    return (
        <PageComponentLayout
            title={`Request #${proposal?.id}`}
            description="Details for Request"
            backButton={`/${treasuryId}/requests`}
        >
            <ExpandedView
                proposal={proposal}
                policy={policy}
                hideOpenInNewTab
                onVote={(vote) => {
                    setVoteInfo({
                        vote,
                        proposals: proposal ? [proposal] : [],
                    });
                    setIsVoteModalOpen(true);
                }}
                onDeposit={(tokenSymbol, tokenNetwork) => {
                    setDepositTokenInfo({ tokenSymbol, tokenNetwork });
                    setIsDepositModalOpen(true);
                }}
            />
            <VoteModal
                isOpen={isVoteModalOpen}
                onClose={() => setIsVoteModalOpen(false)}
                proposals={voteInfo.proposals}
                vote={voteInfo.vote}
            />
            <DepositModal
                isOpen={isDepositModalOpen}
                onClose={() => setIsDepositModalOpen(false)}
                prefillTokenSymbol={tokenSymbol}
                prefillNetworkId={tokenNetwork}
            />
        </PageComponentLayout>
    );
}

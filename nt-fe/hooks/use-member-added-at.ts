import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
    MEMBER_ADDED_PROPOSAL_TYPES,
    buildMemberAddedAtMap,
} from "@/lib/member-added-at";
import { getProposals, type Proposal } from "@/lib/proposals-api";

const MEMBER_HISTORY_PAGE_SIZE = 500;

async function fetchAllMemberAddedProposals(
    treasuryId: string,
): Promise<Proposal[]> {
    const filters = {
        statuses: ["Approved" as const],
        proposal_types: [...MEMBER_ADDED_PROPOSAL_TYPES],
        sort_by: "CreationTime" as const,
        sort_direction: "asc" as const,
    };

    const collected: Proposal[] = [];
    let page = 0;
    let total = Number.POSITIVE_INFINITY;

    while (collected.length < total) {
        const response = await getProposals(treasuryId, {
            ...filters,
            page,
            page_size: MEMBER_HISTORY_PAGE_SIZE,
        });
        total = response.total;
        collected.push(...response.proposals);
        if (response.proposals.length === 0) break;
        page += 1;
    }

    return collected;
}

export function useMemberAddedAt(treasuryId: string | null | undefined) {
    const { data: proposals = [], isLoading } = useQuery({
        queryKey: ["memberAddedProposals", treasuryId],
        queryFn: () => fetchAllMemberAddedProposals(treasuryId!),
        enabled: !!treasuryId,
        staleTime: 1000 * 10,
    });

    const addedAt = useMemo(
        () => buildMemberAddedAtMap(proposals),
        [proposals],
    );

    return {
        addedAt,
        isLoading,
    };
}

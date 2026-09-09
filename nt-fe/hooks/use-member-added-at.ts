import { useQuery } from "@tanstack/react-query";
import {
    MEMBER_ADDED_PROPOSAL_TYPES,
    buildMemberAddedAtMap,
    memberAddedAtQueryKey,
} from "@/lib/member-added-at";
import { getProposals } from "@/lib/proposals-api";

const MEMBER_ADDED_AT_GC_MS = 1000 * 60 * 60 * 24;

async function fetchMemberAddedAt(treasuryId: string) {
    const response = await getProposals(treasuryId, {
        statuses: ["Approved"],
        proposal_types: [...MEMBER_ADDED_PROPOSAL_TYPES],
        sort_by: "CreationTime",
        sort_direction: "asc",
    });
    return buildMemberAddedAtMap(response.proposals);
}

export function useMemberAddedAt(treasuryId: string | null | undefined) {
    const { data: addedAt = {}, isLoading } = useQuery({
        queryKey: memberAddedAtQueryKey(treasuryId ?? ""),
        queryFn: () => fetchMemberAddedAt(treasuryId!),
        enabled: !!treasuryId,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: MEMBER_ADDED_AT_GC_MS,
        refetchOnWindowFocus: false,
    });

    return {
        addedAt,
        isLoading,
    };
}

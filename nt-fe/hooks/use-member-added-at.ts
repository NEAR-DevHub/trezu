import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    MEMBER_ADDED_PROPOSAL_TYPES,
    resolveMemberAddedAtSnapshot,
    type MemberAddedAtSnapshot,
    type MemberAddedHistoryHead,
} from "@/lib/member-added-at";
import { getProposals } from "@/lib/proposals-api";

const MEMBER_HISTORY_PAGE_SIZE = 10;
const MEMBER_ADDED_AT_GC_MS = 1000 * 60 * 60 * 24;

const MEMBER_HISTORY_FILTERS = {
    statuses: ["Approved" as const],
    proposal_types: [...MEMBER_ADDED_PROPOSAL_TYPES],
    sort_by: "CreationTime" as const,
};

export function memberAddedAtQueryKey(treasuryId: string) {
    return ["memberAddedAt", treasuryId] as const;
}

async function fetchMemberAddedHistoryHead(
    treasuryId: string,
): Promise<MemberAddedHistoryHead> {
    const response = await getProposals(treasuryId, {
        ...MEMBER_HISTORY_FILTERS,
        sort_direction: "desc",
        page: 0,
        page_size: 1,
    });
    return {
        total: response.total,
        lastId: response.proposals[0]?.id ?? null,
    };
}

async function fetchAllMemberAddedProposals(treasuryId: string) {
    const collected = [];
    let page = 0;
    let total = Number.POSITIVE_INFINITY;

    while (collected.length < total) {
        const response = await getProposals(treasuryId, {
            ...MEMBER_HISTORY_FILTERS,
            sort_direction: "asc",
            page,
            page_size: MEMBER_HISTORY_PAGE_SIZE,
        });
        total = response.total;
        collected.push(...response.proposals);
        if (response.proposals.length === 0) break;
        page += 1;
    }

    return { proposals: collected, total };
}

export function useMemberAddedAt(treasuryId: string | null | undefined) {
    const queryClient = useQueryClient();
    const queryKey = memberAddedAtQueryKey(treasuryId ?? "");

    const { data, isLoading } = useQuery({
        queryKey,
        queryFn: () =>
            resolveMemberAddedAtSnapshot(
                queryClient.getQueryData<MemberAddedAtSnapshot>(queryKey),
                {
                    fetchHead: () => fetchMemberAddedHistoryHead(treasuryId!),
                    fetchAll: () => fetchAllMemberAddedProposals(treasuryId!),
                },
            ),
        enabled: !!treasuryId,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: MEMBER_ADDED_AT_GC_MS,
        refetchOnMount: "always",
        refetchOnWindowFocus: false,
    });

    return {
        addedAt: data?.addedAt ?? {},
        isLoading,
    };
}

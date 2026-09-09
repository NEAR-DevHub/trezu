import { useMemo } from "react";
import {
    MEMBER_ADDED_PROPOSAL_TYPES,
    buildMemberAddedAtMap,
} from "@/lib/member-added-at";
import { useProposals } from "@/hooks/use-proposals";

export function useMemberAddedAt(treasuryId: string | null | undefined) {
    const { data, isLoading } = useProposals(treasuryId, {
        statuses: ["Approved"],
        proposal_types: [...MEMBER_ADDED_PROPOSAL_TYPES],
        sort_by: "CreationTime",
        sort_direction: "asc",
    });
    const proposals = data?.proposals ?? [];

    const addedAt = useMemo(
        () => buildMemberAddedAtMap(proposals),
        [proposals],
    );

    return {
        addedAt,
        isLoading,
    };
}

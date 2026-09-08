"use client";

import { useMemo } from "react";
import { useProposals } from "@/hooks/use-proposals";
import { useTreasuryMembers } from "@/hooks/use-treasury-members";
import { useTreasuryPolicy } from "@/hooks/use-treasury-queries";
import { hasPermission } from "@/lib/config-utils";
import { useNear } from "@/stores/near-store";
import type { Policy, RolePermission } from "@/types/policy";

/** Group roles that can be assigned to members (excludes the "all" role). */
export function getAssignableRoles(
    policy: Policy | null | undefined,
): RolePermission[] {
    if (!policy?.roles) return [];
    return policy.roles.filter(
        (role) =>
            typeof role.kind === "object" &&
            "Group" in role.kind &&
            role.name.toLowerCase() !== "all",
    );
}

/**
 * Shared policy + permission + pending ChangePolicy state for member flows.
 */
export function useMemberPolicyGate(treasuryId: string | null | undefined) {
    const { accountId } = useNear();
    const { data: policy, isLoading: isLoadingPolicy } = useTreasuryPolicy(
        treasuryId || "",
    );
    const { members: existingMembers, isLoading: isLoadingMembers } =
        useTreasuryMembers(treasuryId);

    const { data: pendingProposals } = useProposals(treasuryId, {
        statuses: ["InProgress"],
        proposal_types: ["ChangePolicy", "ChangePolicyUpdateParameters"],
        sort_direction: "desc",
        sort_by: "CreationTime",
    });

    const pendingMemberRequestCount = pendingProposals?.proposals?.length ?? 0;
    const hasPendingMemberRequest = pendingMemberRequestCount > 0;

    const isLoading = isLoadingPolicy || isLoadingMembers;
    const isMemberDataReady = !isLoading && pendingProposals !== undefined;
    const isMemberActionsDisabled =
        !isMemberDataReady || hasPendingMemberRequest;

    const canAddMember = useMemo(() => {
        if (!policy || !accountId) return false;
        return hasPermission(policy, accountId, "policy", "AddProposal");
    }, [policy, accountId]);

    const availableRoles = useMemo(() => getAssignableRoles(policy), [policy]);

    return {
        accountId,
        policy,
        isLoadingPolicy,
        isLoadingMembers,
        isLoading,
        existingMembers,
        pendingMemberRequestCount,
        hasPendingMemberRequest,
        isMemberDataReady,
        isMemberActionsDisabled,
        canAddMember,
        availableRoles,
    };
}

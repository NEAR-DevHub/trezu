import { nanosToMs } from "@/lib/utils";
import type { Proposal, ProposalKind } from "@/lib/proposals-api";
import type { Policy, RolePermission } from "@/types/policy";

export const MEMBER_ADDED_PROPOSAL_TYPES = [
    "ChangePolicy",
    "ChangePolicyAddOrUpdateRole",
    "ChangePolicyRemoveRole",
    "AddMemberToRole",
    "RemoveMemberFromRole",
] as const;

type MemberRoles = Map<string, Set<string>>;

function groupRoleAccounts(role: RolePermission): string[] {
    if (typeof role.kind === "object" && "Group" in role.kind) {
        return role.kind.Group;
    }
    return [];
}

export function membersFromPolicy(
    policy: Pick<Policy, "roles"> | null | undefined,
): MemberRoles {
    const members: MemberRoles = new Map();
    for (const role of policy?.roles ?? []) {
        for (const accountId of groupRoleAccounts(role)) {
            const roles = members.get(accountId) ?? new Set<string>();
            roles.add(role.name);
            members.set(accountId, roles);
        }
    }
    return members;
}

function cloneMemberRoles(source: MemberRoles): MemberRoles {
    return new Map(
        [...source.entries()].map(([accountId, roles]) => [
            accountId,
            new Set(roles),
        ]),
    );
}

function addRole(
    members: MemberRoles,
    accountId: string,
    roleName: string,
): void {
    const roles = members.get(accountId) ?? new Set<string>();
    roles.add(roleName);
    members.set(accountId, roles);
}

function removeRole(
    members: MemberRoles,
    accountId: string,
    roleName: string,
): void {
    const roles = members.get(accountId);
    if (!roles) return;
    roles.delete(roleName);
    if (roles.size === 0) {
        members.delete(accountId);
    }
}

export function applyMemberProposal(
    current: MemberRoles,
    kind: ProposalKind,
): MemberRoles {
    const next = cloneMemberRoles(current);

    if ("ChangePolicy" in kind) {
        return membersFromPolicy(kind.ChangePolicy.policy as Policy);
    }

    if ("AddMemberToRole" in kind) {
        addRole(
            next,
            kind.AddMemberToRole.member_id,
            kind.AddMemberToRole.role,
        );
        return next;
    }

    if ("RemoveMemberFromRole" in kind) {
        removeRole(
            next,
            kind.RemoveMemberFromRole.member_id,
            kind.RemoveMemberFromRole.role,
        );
        return next;
    }

    if ("ChangePolicyAddOrUpdateRole" in kind) {
        const role = kind.ChangePolicyAddOrUpdateRole.role as RolePermission;
        for (const [accountId, roles] of next) {
            roles.delete(role.name);
            if (roles.size === 0) next.delete(accountId);
        }
        for (const accountId of groupRoleAccounts(role)) {
            addRole(next, accountId, role.name);
        }
        return next;
    }

    if ("ChangePolicyRemoveRole" in kind) {
        const roleName = kind.ChangePolicyRemoveRole.role;
        for (const [accountId, roles] of next) {
            roles.delete(roleName);
            if (roles.size === 0) next.delete(accountId);
        }
        return next;
    }

    return next;
}

export function memberProposalTimestampMs(
    proposal: Pick<Proposal, "submission_time" | "public_metadata">,
): number {
    const executedAt = proposal.public_metadata?.proposal_executed_at;
    if (executedAt) {
        const parsed = Date.parse(executedAt);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return nanosToMs(proposal.submission_time);
}

/**
 * First time an account goes from zero roles to any role. Later role-only
 * edits do not change the timestamp. A later re-add after a full removal does.
 *
 * Starts from an empty membership so confidential setup ChangePolicy (signer
 * → user members) stamps those users. Do not seed current policy as a
 * baseline — that already includes them and hides the add.
 */
export function buildMemberAddedAtMap(
    proposals: Array<
        Pick<Proposal, "kind" | "submission_time" | "public_metadata">
    >,
): Record<string, number> {
    const ordered = [...proposals].sort(
        (left, right) =>
            memberProposalTimestampMs(left) - memberProposalTimestampMs(right),
    );

    let current = membersFromPolicy(null);
    const addedAt: Record<string, number> = {};

    for (const proposal of ordered) {
        const next = applyMemberProposal(current, proposal.kind);
        const timestamp = memberProposalTimestampMs(proposal);

        for (const accountId of next.keys()) {
            if (!current.has(accountId)) {
                addedAt[accountId] = timestamp;
            }
        }

        current = next;
    }

    return addedAt;
}

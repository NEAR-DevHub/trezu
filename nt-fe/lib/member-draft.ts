export type MemberDraft = {
    accountId?: string;
    roles?: string[];
};

export function isEmptyMember(member: MemberDraft): boolean {
    return !member.accountId?.trim() && (member.roles?.length ?? 0) === 0;
}

export function isCompleteMember(member: MemberDraft): boolean {
    return Boolean(member.accountId?.trim()) && (member.roles?.length ?? 0) > 0;
}

export function isPartialMember(member: MemberDraft): boolean {
    return !isEmptyMember(member) && !isCompleteMember(member);
}

/** Last row is the in-progress draft; earlier complete rows are committed. */
export function getCommittedMembers<T extends MemberDraft>(members: T[]): T[] {
    if (members.length === 0) return [];
    return members.slice(0, -1);
}

export function getDraftMember<T extends MemberDraft>(
    members: T[],
): T | undefined {
    return members[members.length - 1];
}

export function canReviewMembers(members: MemberDraft[]): boolean {
    const draft = getDraftMember(members);
    if (!draft) return false;
    if (isPartialMember(draft)) return false;
    return members.some(isCompleteMember);
}

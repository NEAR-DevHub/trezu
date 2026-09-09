import { describe, expect, it } from "bun:test";
import {
    applyMemberProposal,
    buildMemberAddedAtMap,
    isMemberAddedAtSnapshotCurrent,
    memberProposalTimestampMs,
    membersFromPolicy,
    resolveMemberAddedAtSnapshot,
    type MemberAddedAtSnapshot,
    type MemberAddedHistoryEntry,
} from "./member-added-at";
import type { ProposalKind } from "./proposals-api";
import type { Policy } from "@/types/policy";

const EMPTY_VOTE = {
    weight_kind: "RoleWeight" as const,
    quorum: "0",
    threshold: [1, 2] as [number, number],
};

function groupRole(name: string, members: string[]) {
    return {
        name,
        kind: { Group: members },
        permissions: [] as string[],
        vote_policy: {},
    };
}

function policyWith(
    roles: ReturnType<typeof groupRole>[],
): Pick<Policy, "roles"> {
    return { roles };
}

function changePolicy(roles: ReturnType<typeof groupRole>[]): ProposalKind {
    return {
        ChangePolicy: {
            policy: {
                bounty_bond: "0",
                bounty_forgiveness_period: "0",
                default_vote_policy: EMPTY_VOTE,
                proposal_bond: "0",
                proposal_period: "0",
                roles,
            },
        },
    };
}

const FIRST_TS = "1700000000000000000";
const SECOND_TS = "1700003600000000000";
const THIRD_TS = "1700007200000000000";

describe("membersFromPolicy", () => {
    it("collects every Group-role account", () => {
        const members = membersFromPolicy(
            policyWith([
                groupRole("Council", ["alice.near", "bob.near"]),
                groupRole("Requestor", ["alice.near"]),
            ]),
        );

        expect([...members.get("alice.near")!].sort()).toEqual([
            "Council",
            "Requestor",
        ]);
        expect([...members.get("bob.near")!]).toEqual(["Council"]);
    });
});

describe("applyMemberProposal", () => {
    it("replaces membership from a full ChangePolicy", () => {
        const current = membersFromPolicy(
            policyWith([groupRole("Council", ["alice.near"])]),
        );
        const next = applyMemberProposal(
            current,
            changePolicy([
                groupRole("Council", ["alice.near", "bob.near"]),
                groupRole("Requestor", ["bob.near"]),
            ]),
        );

        expect(next.has("alice.near")).toBe(true);
        expect(next.has("bob.near")).toBe(true);
        expect([...next.get("bob.near")!].sort()).toEqual([
            "Council",
            "Requestor",
        ]);
    });

    it("adds a role without dropping existing ones", () => {
        const current = membersFromPolicy(
            policyWith([groupRole("Council", ["alice.near"])]),
        );
        const next = applyMemberProposal(current, {
            AddMemberToRole: { member_id: "alice.near", role: "Requestor" },
        });

        expect([...next.get("alice.near")!].sort()).toEqual([
            "Council",
            "Requestor",
        ]);
    });
});

describe("memberProposalTimestampMs", () => {
    it("prefers proposal execution time when present", () => {
        expect(
            memberProposalTimestampMs({
                submission_time: FIRST_TS,
                public_metadata: {
                    proposal_executed_at: "2024-01-15T12:00:00.000Z",
                },
            }),
        ).toBe(Date.parse("2024-01-15T12:00:00.000Z"));
    });

    it("falls back to submission time", () => {
        expect(
            memberProposalTimestampMs({
                submission_time: FIRST_TS,
            }),
        ).toBe(1_700_000_000_000);
    });
});

describe("buildMemberAddedAtMap", () => {
    it("stamps every account in the first ChangePolicy, including setup members", () => {
        const addedAt = buildMemberAddedAtMap([
            {
                submission_time: FIRST_TS,
                kind: changePolicy([
                    groupRole("Council", ["alice.near", "bob.near"]),
                ]),
            },
        ]);

        expect(addedAt["alice.near"]).toBe(1_700_000_000_000);
        expect(addedAt["bob.near"]).toBe(1_700_000_000_000);
    });

    it("ignores later role-only edits for an existing member", () => {
        const addedAt = buildMemberAddedAtMap([
            {
                submission_time: FIRST_TS,
                kind: changePolicy([
                    groupRole("Council", ["alice.near", "bob.near"]),
                ]),
            },
            {
                submission_time: SECOND_TS,
                kind: {
                    AddMemberToRole: {
                        member_id: "bob.near",
                        role: "Requestor",
                    },
                },
            },
        ]);

        expect(addedAt["bob.near"]).toBe(1_700_000_000_000);
    });

    it("uses the re-add time after a member is fully removed", () => {
        const addedAt = buildMemberAddedAtMap([
            {
                submission_time: FIRST_TS,
                kind: {
                    AddMemberToRole: {
                        member_id: "bob.near",
                        role: "Council",
                    },
                },
            },
            {
                submission_time: SECOND_TS,
                kind: {
                    RemoveMemberFromRole: {
                        member_id: "bob.near",
                        role: "Council",
                    },
                },
            },
            {
                submission_time: THIRD_TS,
                kind: {
                    AddMemberToRole: {
                        member_id: "bob.near",
                        role: "Requestor",
                    },
                },
            },
        ]);

        expect(addedAt["bob.near"]).toBe(1_700_007_200_000);
    });
});

function historyEntry(
    id: number,
    kind: ProposalKind,
    submissionTime = FIRST_TS,
): MemberAddedHistoryEntry {
    return { id, kind, submission_time: submissionTime };
}

describe("isMemberAddedAtSnapshotCurrent", () => {
    const snapshot: MemberAddedAtSnapshot = {
        addedAt: { "alice.near": 1 },
        total: 3,
        lastId: 12,
    };

    it("is current only when total and latest id match", () => {
        expect(
            isMemberAddedAtSnapshotCurrent(snapshot, { total: 3, lastId: 12 }),
        ).toBe(true);
        expect(
            isMemberAddedAtSnapshotCurrent(snapshot, { total: 4, lastId: 12 }),
        ).toBe(false);
        expect(
            isMemberAddedAtSnapshotCurrent(snapshot, { total: 3, lastId: 13 }),
        ).toBe(false);
        expect(
            isMemberAddedAtSnapshotCurrent(undefined, {
                total: 0,
                lastId: null,
            }),
        ).toBe(false);
    });
});

describe("resolveMemberAddedAtSnapshot", () => {
    const aliceAdd = historyEntry(1, {
        AddMemberToRole: { member_id: "alice.near", role: "Council" },
    });
    const snapshot: MemberAddedAtSnapshot = {
        addedAt: { "alice.near": 1_700_000_000_000 },
        total: 1,
        lastId: 1,
    };

    it("returns the cache after a head check when history is unchanged", async () => {
        let fetchAllCalls = 0;
        const resolved = await resolveMemberAddedAtSnapshot(snapshot, {
            fetchHead: async () => ({ total: 1, lastId: 1 }),
            fetchAll: async () => {
                fetchAllCalls += 1;
                return { proposals: [aliceAdd], total: 1 };
            },
        });

        expect(resolved).toBe(snapshot);
        expect(fetchAllCalls).toBe(0);
    });

    it("rebuilds from a full walk when a newer approved proposal appears", async () => {
        const bobAdd = historyEntry(
            2,
            { AddMemberToRole: { member_id: "bob.near", role: "Council" } },
            SECOND_TS,
        );
        let fetchHeadCalls = 0;
        const resolved = await resolveMemberAddedAtSnapshot(snapshot, {
            fetchHead: async () => {
                fetchHeadCalls += 1;
                return { total: 2, lastId: 2 };
            },
            fetchAll: async () => ({ proposals: [aliceAdd, bobAdd], total: 2 }),
        });

        expect(fetchHeadCalls).toBe(1);
        expect(resolved.total).toBe(2);
        expect(resolved.lastId).toBe(2);
        expect(resolved.addedAt["alice.near"]).toBe(1_700_000_000_000);
        expect(resolved.addedAt["bob.near"]).toBe(1_700_003_600_000);
    });

    it("skips the head check and walks once when there is no cache", async () => {
        let fetchHeadCalls = 0;
        const resolved = await resolveMemberAddedAtSnapshot(undefined, {
            fetchHead: async () => {
                fetchHeadCalls += 1;
                return { total: 1, lastId: 1 };
            },
            fetchAll: async () => ({ proposals: [aliceAdd], total: 1 }),
        });

        expect(fetchHeadCalls).toBe(0);
        expect(resolved.lastId).toBe(1);
        expect(resolved.addedAt["alice.near"]).toBe(1_700_000_000_000);
    });
});

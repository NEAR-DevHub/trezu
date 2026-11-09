import { describe, expect, it } from "bun:test";
import type { Policy } from "@/types/policy";
import {
    canChangePolicy,
    getApproversAndThreshold,
    getKindFromProposal,
    hasActionPermission,
    isRequestor,
    thresholdToRequiredVotes,
} from "./config-utils";
import type { ProposalKind } from "./proposals-api";

/**
 * The permission tiers behind the Request Templates gates: `canChangePolicy` (admin — delete a
 * template / flip the feature flag; a wildcard-action governance role) and `isRequestor` (may file
 * a request: `call`/`transfer` AddProposal). The two must
 * stay distinct — a proposer is not a manager and vice-versa — or the UI leaks/hides the wrong
 * affordances. These fixtures mirror the on-chain SputnikDAO policy shape nt-be returns.
 */
const ACCOUNT = "member.near";

function policyWith(
    permissions: string[],
    members: string[] = [ACCOUNT],
): Policy {
    return {
        roles: [
            {
                name: "role",
                kind: { Group: members },
                permissions,
                vote_policy: {},
            },
        ],
        default_vote_policy: {
            weight_kind: "RoleWeight",
            quorum: "0",
            threshold: [1, 2],
        },
        proposal_bond: "0",
        proposal_period: "0",
        bounty_bond: "0",
        bounty_forgiveness_period: "0",
    };
}

function kindGovernance(kind: string): string[] {
    return ["AddProposal", "VoteApprove", "VoteReject"].map(
        (action) => `${kind}:${action}`,
    );
}

describe("canChangePolicy (admin / template-delete gate)", () => {
    // Mirrors nt-be: a wildcard action (`{kind}:*`), or the kind this check asks for (`policy`)
    // with AddProposal, VoteApprove, and VoteReject together. `*` covers every kind. Two of the
    // three, the three split across kinds, or the same trio on another kind, fail.
    it("grants on wildcard-action governance roles (policy:*, config:*, *:*)", () => {
        expect(canChangePolicy(policyWith(["policy:*"]), ACCOUNT)).toBe(true);
        expect(canChangePolicy(policyWith(["config:*"]), ACCOUNT)).toBe(true);
        expect(canChangePolicy(policyWith(["*:*"]), ACCOUNT)).toBe(true);
    });

    it("grants on the synthetic *:ChangePolicy fixture (matches nt-be)", () => {
        expect(canChangePolicy(policyWith(["*:ChangePolicy"]), ACCOUNT)).toBe(
            true,
        );
    });

    it("grants when policy or * has AddProposal, VoteApprove, and VoteReject together", () => {
        expect(
            canChangePolicy(policyWith(kindGovernance("policy")), ACCOUNT),
        ).toBe(true);
        expect(canChangePolicy(policyWith(kindGovernance("*")), ACCOUNT)).toBe(
            true,
        );
    });

    it("denies a trio on a different kind, and grants that trio for its own kind", () => {
        const vote = policyWith(kindGovernance("vote"));
        expect(canChangePolicy(vote, ACCOUNT)).toBe(false);
        expect(hasActionPermission(vote, ACCOUNT, "ChangePolicy", "vote")).toBe(
            true,
        );
        expect(
            hasActionPermission(
                policyWith(kindGovernance("config")),
                ACCOUNT,
                "ChangePolicy",
                "config",
            ),
        ).toBe(true);
    });

    it("denies when the three actions are incomplete or split across kinds", () => {
        expect(
            canChangePolicy(
                policyWith(["policy:AddProposal", "policy:VoteApprove"]),
                ACCOUNT,
            ),
        ).toBe(false);
        expect(
            canChangePolicy(
                policyWith([
                    "policy:AddProposal",
                    "call:VoteApprove",
                    "config:VoteReject",
                ]),
                ACCOUNT,
            ),
        ).toBe(false);
    });

    it("denies a Requestor — AddProposal (even *:AddProposal) is not admin", () => {
        // The load-bearing case: a proposer must NOT get the admin-only delete affordance.
        expect(canChangePolicy(policyWith(["call:AddProposal"]), ACCOUNT)).toBe(
            false,
        );
        expect(
            canChangePolicy(policyWith(["transfer:AddProposal"]), ACCOUNT),
        ).toBe(false);
        expect(canChangePolicy(policyWith(["*:AddProposal"]), ACCOUNT)).toBe(
            false,
        );
    });

    it("denies a non-member and a null policy", () => {
        expect(
            canChangePolicy(
                policyWith(["*:*"], ["someone-else.near"]),
                ACCOUNT,
            ),
        ).toBe(false);
        expect(canChangePolicy(null, ACCOUNT)).toBe(false);
        expect(canChangePolicy(policyWith(["*:*"]), "")).toBe(false);
    });
});

describe("hasActionPermission — AddProposal (template authoring gate)", () => {
    // Mirrors nt-be's action-only matcher for the `AddProposal` gate. The load-bearing case
    // (Copilot #1058): a synthetic `*:ChangePolicy` admin must NOT count as an author, because
    // nt-be gates create/edit/pin on AddProposal and would 403 that policy.
    it("grants on any AddProposal-action permission", () => {
        for (const perm of [
            "call:AddProposal",
            "transfer:AddProposal",
            "*:AddProposal",
        ]) {
            expect(
                hasActionPermission(policyWith([perm]), ACCOUNT, "AddProposal"),
            ).toBe(true);
        }
    });

    it("grants on wildcard-action governance roles (policy:*, config:*, *:*)", () => {
        for (const perm of ["policy:*", "config:*", "*:*"]) {
            expect(
                hasActionPermission(policyWith([perm]), ACCOUNT, "AddProposal"),
            ).toBe(true);
        }
    });

    it("denies *:ChangePolicy — ChangePolicy is not the AddProposal action (nt-be would 403)", () => {
        expect(
            hasActionPermission(
                policyWith(["*:ChangePolicy"]),
                ACCOUNT,
                "AddProposal",
            ),
        ).toBe(false);
        expect(
            hasActionPermission(
                policyWith(["*:VoteApprove"]),
                ACCOUNT,
                "AddProposal",
            ),
        ).toBe(false);
    });

    it("denies a non-member and a null policy", () => {
        expect(
            hasActionPermission(
                policyWith(["*:*"], ["someone-else.near"]),
                ACCOUNT,
                "AddProposal",
            ),
        ).toBe(false);
        expect(hasActionPermission(null, ACCOUNT, "AddProposal")).toBe(false);
    });
});

describe("isRequestor (file-a-request gate)", () => {
    it("grants on call: or transfer:AddProposal (and the wildcard)", () => {
        expect(isRequestor(policyWith(["call:AddProposal"]), ACCOUNT)).toBe(
            true,
        );
        expect(isRequestor(policyWith(["transfer:AddProposal"]), ACCOUNT)).toBe(
            true,
        );
        expect(isRequestor(policyWith(["*:AddProposal"]), ACCOUNT)).toBe(true);
    });

    it("denies a pure manager (policy:* is not call/transfer AddProposal)", () => {
        expect(isRequestor(policyWith(["policy:*"]), ACCOUNT)).toBe(false);
    });
});

describe("thresholdToRequiredVotes (SputnikDAO WeightOrRatio::to_weight)", () => {
    it("ratio: strictly more than the ratio, capped at the group size", () => {
        expect(thresholdToRequiredVotes([1, 2], 2)).toBe(2);
        expect(thresholdToRequiredVotes([1, 2], 3)).toBe(2);
        expect(thresholdToRequiredVotes([1, 2], 5)).toBe(3);
        expect(thresholdToRequiredVotes([1, 1], 5)).toBe(5);
        expect(thresholdToRequiredVotes([1, 2], 1)).toBe(1);
    });

    it("count: parsed as a number, capped at the group size, never below 1", () => {
        expect(thresholdToRequiredVotes("2", 3)).toBe(2);
        expect(thresholdToRequiredVotes("3", 2)).toBe(2);
        expect(thresholdToRequiredVotes("0", 2)).toBe(1);
        expect(thresholdToRequiredVotes("", 2)).toBe(1);
    });
});

describe("getApproversAndThreshold (ratio default policy)", () => {
    it("matches the contract for a 1/2 ratio over two voters", () => {
        const policy = policyWith(
            ["*:VoteApprove", "*:VoteReject"],
            ["a.near", "b.near"],
        );
        const { requiredVotes, approverAccounts } = getApproversAndThreshold(
            policy,
            "a.near",
            "policy",
            false,
        );
        expect(approverAccounts).toEqual(["a.near", "b.near"]);
        expect(requiredVotes).toBe(2);
    });
});

const kind = (k: object) => k as unknown as ProposalKind;

describe("getKindFromProposal (contract policy labels)", () => {
    it("gives each ChangePolicy* variant its own label", () => {
        expect(
            getKindFromProposal(kind({ ChangePolicy: { policy: {} } })),
        ).toBe("policy");
        expect(
            getKindFromProposal(
                kind({
                    ChangePolicyUpdateParameters: { parameters: {} },
                }),
            ),
        ).toBe("policy_update_parameters");
        expect(
            getKindFromProposal(
                kind({
                    ChangePolicyAddOrUpdateRole: { role: {} },
                }),
            ),
        ).toBe("policy_add_or_update_role");
        expect(
            getKindFromProposal(
                kind({ ChangePolicyRemoveRole: { role: "x" } }),
            ),
        ).toBe("policy_remove_role");
        expect(
            getKindFromProposal(
                kind({
                    ChangePolicyUpdateDefaultVotePolicy: { vote_policy: {} },
                }),
            ),
        ).toBe("policy_update_default_vote_policy");
        expect(
            getKindFromProposal(
                kind({
                    SetStakingContract: { staking_id: "x" },
                }),
            ),
        ).toBe("set_vote_token");
    });
});

describe("getApproversAndThreshold (per-label vote policy, trezu#358)", () => {
    it("falls back to the default ratio when the role has no rule for the label", () => {
        const admins = Array.from({ length: 19 }, (_, i) => `admin${i}.near`);
        const policy = policyWith(
            ["policy:*", "policy_update_parameters:*"],
            admins,
        );
        policy.roles[0].vote_policy = {
            policy: { weight_kind: "RoleWeight", quorum: "0", threshold: "1" },
        };
        const params = kind({
            ChangePolicyUpdateParameters: { parameters: {} },
        });
        expect(
            getApproversAndThreshold(policy, admins[0], params, false)
                .requiredVotes,
        ).toBe(10);
        expect(
            getApproversAndThreshold(
                policy,
                admins[0],
                kind({ ChangePolicy: { policy: {} } }),
                false,
            ).requiredVotes,
        ).toBe(1);
    });
});

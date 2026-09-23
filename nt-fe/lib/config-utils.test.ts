import { describe, expect, it } from "bun:test";
import type { Policy } from "@/types/policy";
import {
    canChangePolicy,
    hasActionPermission,
    isRequestor,
} from "./config-utils";

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
    // Mirrors nt-be: a wildcard action (`{kind}:*`), or any proposal kind that has AddProposal,
    // VoteApprove, and VoteReject together. Two of the three, or the three split across kinds, fail.
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

    it("grants when any proposal kind has AddProposal, VoteApprove, and VoteReject together", () => {
        for (const kind of ["policy", "call", "config", "*"]) {
            const policy = policyWith(kindGovernance(kind));
            expect(canChangePolicy(policy, ACCOUNT)).toBe(true);
            // The trio satisfies every action check, not only ChangePolicy.
            expect(hasActionPermission(policy, ACCOUNT, "VoteRemove")).toBe(
                true,
            );
        }
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

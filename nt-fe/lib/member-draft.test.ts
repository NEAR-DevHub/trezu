import { describe, expect, it } from "bun:test";
import {
    canReviewMembers,
    getCommittedMembers,
    getDraftMember,
    isCompleteMember,
    isEmptyMember,
    isPartialMember,
} from "./member-draft";

describe("member draft helpers", () => {
    it("treats a blank row as empty", () => {
        expect(isEmptyMember({ accountId: "", roles: [] })).toBe(true);
        expect(isEmptyMember({ accountId: "  ", roles: [] })).toBe(true);
    });

    it("requires both an address and at least one role to be complete", () => {
        expect(
            isCompleteMember({ accountId: "alice.near", roles: ["Financial"] }),
        ).toBe(true);
        expect(isCompleteMember({ accountId: "alice.near", roles: [] })).toBe(
            false,
        );
        expect(isCompleteMember({ accountId: "", roles: ["Financial"] })).toBe(
            false,
        );
    });

    it("flags a half-filled row as partial", () => {
        expect(isPartialMember({ accountId: "alice.near", roles: [] })).toBe(
            true,
        );
        expect(isPartialMember({ accountId: "", roles: ["Requestor"] })).toBe(
            true,
        );
    });

    it("treats every row except the last as committed", () => {
        const members = [
            { accountId: "a.near", roles: ["Financial"] },
            { accountId: "b.near", roles: ["Requestor"] },
            { accountId: "", roles: [] },
        ];
        expect(getCommittedMembers(members)).toEqual([
            { accountId: "a.near", roles: ["Financial"] },
            { accountId: "b.near", roles: ["Requestor"] },
        ]);
        expect(getDraftMember(members)).toEqual({
            accountId: "",
            roles: [],
        });
    });

    it("enables review when a complete draft or committed members exist", () => {
        expect(
            canReviewMembers([
                { accountId: "alice.near", roles: ["Financial"] },
            ]),
        ).toBe(true);
        expect(
            canReviewMembers([
                { accountId: "alice.near", roles: ["Financial"] },
                { accountId: "", roles: [] },
            ]),
        ).toBe(true);
        expect(canReviewMembers([{ accountId: "", roles: [] }])).toBe(false);
        expect(canReviewMembers([{ accountId: "alice.near", roles: [] }])).toBe(
            false,
        );
    });
});

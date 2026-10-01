import { describe, expect, it } from "bun:test";
import { duplicateRecipientIndexes } from "./duplicate-recipients";

describe("duplicateRecipientIndexes", () => {
    it("flags an address that is already saved", () => {
        expect(
            duplicateRecipientIndexes(
                [{ address: "alice.near" }, { address: "bob.near" }],
                new Set(["alice.near"]),
            ),
        ).toEqual([0]);
    });

    it("flags a later row that repeats an address in the same form", () => {
        expect(
            duplicateRecipientIndexes(
                [{ address: "alice.near" }, { address: " alice.near " }],
                new Set(),
            ),
        ).toEqual([1]);
    });

    it("treats a bare near.com address as the stored nearcom: form", () => {
        expect(
            duplicateRecipientIndexes(
                [{ address: "alice.near", networks: ["near.com"] }],
                new Set(["nearcom:alice.near"]),
            ),
        ).toEqual([0]);
    });

    it("ignores blank addresses", () => {
        expect(
            duplicateRecipientIndexes(
                [{ address: "  " }, { address: "" }],
                new Set(["alice.near"]),
            ),
        ).toEqual([]);
    });
});

import { describe, expect, it } from "bun:test";
import { isDisallowedMemberAccountId } from "./member-account";

const ETH_IMPLICIT = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f";

describe("isDisallowedMemberAccountId", () => {
    it("rejects an eth-implicit 0x address", () => {
        expect(isDisallowedMemberAccountId(ETH_IMPLICIT)).toBe(true);
        expect(isDisallowedMemberAccountId(ETH_IMPLICIT.toUpperCase())).toBe(
            true,
        );
        expect(isDisallowedMemberAccountId(`  ${ETH_IMPLICIT}  `)).toBe(true);
    });

    it("allows named, implicit, and wallet-contract accounts", () => {
        expect(isDisallowedMemberAccountId("alice.near")).toBe(false);
        expect(isDisallowedMemberAccountId("0xteam.near")).toBe(false);
        expect(isDisallowedMemberAccountId("a".repeat(64))).toBe(false);
        expect(
            isDisallowedMemberAccountId(
                "0s71c7656ec7ab88b098defb751b7401b5f6d8976f",
            ),
        ).toBe(false);
    });

    it("ignores other 0x shapes", () => {
        expect(isDisallowedMemberAccountId("0x71c7")).toBe(false);
        expect(isDisallowedMemberAccountId(`0x${"ab".repeat(32)}`)).toBe(false);
    });
});

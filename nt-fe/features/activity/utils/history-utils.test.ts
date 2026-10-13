import { describe, expect, it } from "bun:test";
import { hidesIntentsExplorerLink } from "./history-utils";

describe("hidesIntentsExplorerLink", () => {
    it("hides confidential swaps with a deposit address", () => {
        expect(
            hidesIntentsExplorerLink(
                { swap: {}, quoteDepositAddress: "dep.near" },
                true,
            ),
        ).toBe(true);
    });

    it("hides fully confidential transfers with a deposit address", () => {
        expect(
            hidesIntentsExplorerLink(
                { fullyConfidential: true, quoteDepositAddress: "dep.near" },
                true,
            ),
        ).toBe(true);
    });

    it("does not hide public rows or rows without a deposit address", () => {
        expect(
            hidesIntentsExplorerLink(
                { swap: {}, quoteDepositAddress: "dep.near" },
                false,
            ),
        ).toBe(false);
        expect(
            hidesIntentsExplorerLink(
                { fullyConfidential: true, quoteDepositAddress: null },
                true,
            ),
        ).toBe(false);
    });
});

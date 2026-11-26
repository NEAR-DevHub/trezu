import { describe, expect, it } from "bun:test";
import { hasReceiveReceipt, hidesIntentsExplorerLink } from "./history-utils";

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

describe("hasReceiveReceipt", () => {
    const receive = (
        overrides: Partial<Parameters<typeof hasReceiveReceipt>[0]> = {},
    ) =>
        hasReceiveReceipt({
            id: 1,
            counterparty: "alice.near",
            signerId: "alice.near",
            receiverId: "treasury.sputnik-dao.near",
            amount: "1",
            actionKind: "PublicDeposit",
            ...overrides,
        });

    it("covers a settled receive that no request made", () => {
        expect(receive()).toBe(true);
        expect(receive({ actionKind: "ConfidentialDeposit" })).toBe(true);
    });

    it("leaves out sends, requests, swaps, rewards and unsettled rows", () => {
        expect(receive({ amount: "-1" })).toBe(false);
        expect(receive({ amount: "not a number" })).toBe(false);
        expect(receive({ proposalId: 4 })).toBe(false);
        expect(receive({ swap: { swapRole: "fulfillment" } })).toBe(false);
        expect(receive({ actionKind: "StakingReward" })).toBe(false);
        expect(
            receive({ actionKind: "FunctionCall", methodName: "act_proposal" }),
        ).toBe(false);
        expect(receive({ actionKind: "PublicDeposit:pending" })).toBe(false);
        expect(receive({ id: -7 })).toBe(false);
    });
});

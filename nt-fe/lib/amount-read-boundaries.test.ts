import { describe, expect, it } from "bun:test";
import {
    extractNearWrapSwapRequestData,
    extractPaymentRequestData,
} from "@/features/proposals/utils/proposal-extractors";
import type { Proposal } from "@/lib/proposals-api";
import { formatGas, sumIntegerStrings } from "./utils";

describe("legacy and malformed amount read boundaries", () => {
    it("normalizes historical grouped proposal network fees", () => {
        const proposal = {
            description: JSON.stringify({ networkFee: "1,234.56" }),
            kind: {
                Transfer: {
                    token_id: "usdc.near",
                    amount: "1",
                    receiver_id: "receiver.near",
                },
            },
        } as Proposal;

        expect(extractPaymentRequestData(proposal).networkFee).toBe("1234.56");
    });

    it("reads an on-chain ft_transfer without inventing a destination network", () => {
        const proposal = {
            description: "",
            kind: {
                FunctionCall: {
                    receiver_id: "shit.0xshitzu.near",
                    actions: [
                        {
                            method_name: "ft_transfer",
                            args: btoa(
                                JSON.stringify({
                                    receiver_id: "shitzu.pool.near",
                                    amount: "843326591739215991554088027730",
                                    memo: null,
                                }),
                            ),
                            deposit: "1",
                            gas: "270000000000000",
                        },
                    ],
                },
            },
        } as Proposal;

        const data = extractPaymentRequestData(proposal);
        expect(data.tokenId).toBe("shit.0xshitzu.near");
        expect(data.amount).toBe("843326591739215991554088027730");
        expect(data.receiver).toBe("shitzu.pool.near");
        expect(data.destinationAssetId).toBeUndefined();
        expect(data.nearFt).toBe(true);
    });

    it("keeps an explicit destination network on an ft_transfer", () => {
        const proposal = {
            description: JSON.stringify({ destinationNetwork: "near.com" }),
            kind: {
                FunctionCall: {
                    receiver_id: "shit.0xshitzu.near",
                    actions: [
                        {
                            method_name: "ft_transfer",
                            args: btoa(
                                JSON.stringify({
                                    receiver_id: "shitzu.pool.near",
                                    amount: "1",
                                }),
                            ),
                            deposit: "1",
                            gas: "1",
                        },
                    ],
                },
            },
        } as Proposal;

        const data = extractPaymentRequestData(proposal);
        expect(data.destinationAssetId).toBe("near.com");
        expect(data.nearFt).toBe(true);
    });

    it("keeps malformed near-wrap amounts from throwing", () => {
        const proposal = {
            description: "",
            kind: {
                FunctionCall: {
                    receiver_id: "wrap.near",
                    actions: [
                        {
                            method_name: "near_deposit",
                            args: btoa("{}"),
                            deposit: "not-an-integer",
                            gas: "1",
                        },
                    ],
                },
            },
        } as Proposal;

        const result = extractNearWrapSwapRequestData(proposal);
        expect(result.amountIn).toBe("");
        expect(result.amountOut).toBe("");
    });

    it("formats invalid gas and aggregates as unavailable", () => {
        expect(formatGas("not-gas")).toBe("—");
        expect(sumIntegerStrings(["1000", "2000"])).toBe("3000");
        expect(sumIntegerStrings(["1000", "bad"])).toBeNull();
    });
});

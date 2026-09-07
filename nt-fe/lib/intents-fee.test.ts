import { describe, expect, it } from "bun:test";
import { computeQuoteNetworkFee } from "./intents-fee";

describe("computeQuoteNetworkFee", () => {
    it("diffs grouped formatted amounts", () => {
        expect(
            computeQuoteNetworkFee({
                amountInFormatted: "1,000.25",
                amountOutFormatted: "1,000.05",
            }),
        ).toBe("0.2");
    });

    it("returns undefined when either formatted side is missing or invalid", () => {
        expect(
            computeQuoteNetworkFee({
                amountInFormatted: "1,000",
                amountOutFormatted: "not-a-number",
            }),
        ).toBeUndefined();
        expect(
            computeQuoteNetworkFee({
                amountInFormatted: "1,000",
            }),
        ).toBeUndefined();
        expect(computeQuoteNetworkFee(null)).toBeUndefined();
    });
});

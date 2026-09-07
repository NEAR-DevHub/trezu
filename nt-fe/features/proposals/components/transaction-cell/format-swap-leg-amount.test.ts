import { describe, expect, it } from "bun:test";
import { formatSwapLegAmount } from "./format-swap-leg-amount";

const USDC_DECIMALS = 6;

describe("formatSwapLegAmount", () => {
    it("formats a raw base-unit leg the same as an already-scaled decimal", () => {
        expect(
            formatSwapLegAmount({ amount: "1000000000" }, USDC_DECIMALS),
        ).toBe("1,000");
        expect(
            formatSwapLegAmount({ amount: "999990000" }, USDC_DECIMALS),
        ).toBe("999.99");
        expect(
            formatSwapLegAmount({ amountWithDecimals: "1000" }, USDC_DECIMALS),
        ).toBe("1,000");
        expect(
            formatSwapLegAmount(
                { amountWithDecimals: "999.99" },
                USDC_DECIMALS,
            ),
        ).toBe("999.99");
    });

    it("accepts a grouped persisted decimal without showing an em dash", () => {
        expect(
            formatSwapLegAmount(
                { amountWithDecimals: "1,000.25" },
                USDC_DECIMALS,
            ),
        ).toBe("1,000.25");
    });

    it("degrades invalid decimals instead of throwing", () => {
        expect(() =>
            formatSwapLegAmount({ amountWithDecimals: "not-a-number" }, 24),
        ).not.toThrow();
        expect(
            formatSwapLegAmount({ amountWithDecimals: "not-a-number" }, 24),
        ).toBe("—");
    });
});

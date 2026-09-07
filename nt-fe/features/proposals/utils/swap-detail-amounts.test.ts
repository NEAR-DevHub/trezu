import { describe, expect, it } from "bun:test";
import { resolveSwapDetailAmounts } from "./swap-detail-amounts";

const USDC_DECIMALS = 6;

function intents(amountInRaw: string, amountOutRaw: string, slippage = "0.5") {
    return resolveSwapDetailAmounts({
        isWrapConversion: false,
        amountInRaw,
        amountOutRaw,
        tokenInDecimals: USDC_DECIMALS,
        slippage,
    });
}

describe("resolveSwapDetailAmounts", () => {
    it.each([
        ["999", "999000000"],
        ["999.99", "999990000"],
        ["1000", "1000000000"],
        ["1000.01", "1000010000"],
        ["10000", "10000000000"],
    ])("keeps an Intents swap of %s USDC from throwing", (decimal, rawIn) => {
        expect(() => intents(rawIn, decimal)).not.toThrow();
        const figures = intents(rawIn, decimal);
        expect(figures.amountIn?.toFixed()).toBe(decimal);
        expect(figures.amountOut?.toFixed()).toBe(decimal);
        expect(figures.exchangeFee).not.toBeNull();
        expect(figures.minimumReceived).not.toBeNull();
    });

    it("does not feed a grouped display string into Big", () => {
        const figures = resolveSwapDetailAmounts({
            isWrapConversion: true,
            amountInRaw: "1,000",
            amountOutRaw: "1,000.5",
            tokenInDecimals: 24,
            slippage: "1",
        });
        expect(figures.amountIn?.toFixed()).toBe("1000");
        expect(figures.amountOut?.toFixed()).toBe("1000.5");
        expect(figures.minimumReceived?.toFixed()).toBe("990.495");
    });

    it("returns nulls for invalid amounts instead of throwing", () => {
        expect(() => intents("", "not-a-number")).not.toThrow();
        const figures = intents("", "not-a-number");
        expect(figures.amountIn).toBeNull();
        expect(figures.amountOut).toBeNull();
        expect(figures.rate).toBeNull();
        expect(figures.exchangeFee).toBeNull();
        expect(figures.minimumReceived).toBeNull();
    });
});

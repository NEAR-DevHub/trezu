import { describe, expect, it } from "bun:test";
import { formatQuoteErrorMessage } from "./quote-errors";
import {
    classifyExchangeError,
    isAmountBelowStockMinimum,
    isBelowStockMinimum,
} from "./utils";

describe("isBelowStockMinimum", () => {
    const quote = { amountInUsd: "50.10", amountOutUsd: "19.99" };

    it("checks only the stock side", () => {
        expect(isBelowStockMinimum(quote, { sell: false, receive: true })).toBe(
            true,
        );
        expect(isBelowStockMinimum(quote, { sell: true, receive: false })).toBe(
            false,
        );
        expect(
            isBelowStockMinimum(quote, { sell: false, receive: false }),
        ).toBe(false);
    });

    it("does not block when the USD value is missing", () => {
        expect(isBelowStockMinimum({}, { sell: true, receive: true })).toBe(
            false,
        );
    });
});

describe("isAmountBelowStockMinimum", () => {
    const stock = { sell: false, receive: true };

    it("blocks a stock swap whose typed amount is worth less than the floor", () => {
        expect(isAmountBelowStockMinimum("19.99", 1, stock)).toBe(true);
        expect(isAmountBelowStockMinimum("20", 1, stock)).toBe(false);
    });

    it("ignores non-stock swaps", () => {
        expect(
            isAmountBelowStockMinimum("1", 1, { sell: false, receive: false }),
        ).toBe(false);
    });

    it("does not block without a price or a parsable amount", () => {
        expect(isAmountBelowStockMinimum("1", undefined, stock)).toBe(false);
        expect(isAmountBelowStockMinimum("abc", 1, stock)).toBe(false);
    });
});

describe("classifyExchangeError", () => {
    it("maps liquidity failures to noRoute", () => {
        expect(classifyExchangeError("No liquidity available").code).toBe(
            "noRoute",
        );
        expect(
            classifyExchangeError("Insufficient liquidity for pair").code,
        ).toBe("noRoute");
        expect(classifyExchangeError("liquidity unavailable").code).toBe(
            "noRoute",
        );
    });

    it("maps amount-too-low with optional minimum", () => {
        const result = classifyExchangeError(
            "Amount is too low, try at least 10000",
        );
        expect(result.code).toBe("amountTooLow");
        expect(result.minAmountRaw).toBe("10000");
    });

    it("maps unknown messages through as raw", () => {
        const result = classifyExchangeError("something weird happened");
        expect(result.code).toBe("unknown");
        expect(result.raw).toBe("something weird happened");
    });
});

describe("formatQuoteErrorMessage", () => {
    const tEx = (key: string, values?: Record<string, string>) => {
        if (key === "noRoute") {
            return "No exchange found. Try a different amount or token.";
        }
        if (key === "amountTooLowWithMin") {
            return `Enter at least ${values?.min} ${values?.token}.`;
        }
        if (key === "amountTooLow") {
            return "Amount too low for swap.";
        }
        if (key === "fetchFailed") {
            return "Failed to fetch quote";
        }
        return key;
    };

    it("translates no-liquidity into noRoute copy", () => {
        expect(
            formatQuoteErrorMessage(
                new Error("No liquidity available"),
                { decimals: 18, symbol: "ETH" },
                tEx,
            ),
        ).toBe("No exchange found. Try a different amount or token.");
    });

    it("formats amountTooLow with token decimals", () => {
        expect(
            formatQuoteErrorMessage(
                new Error("Amount is too low, try at least 1000000"),
                { decimals: 6, symbol: "USDC" },
                tEx,
            ),
        ).toBe("Enter at least 1 USDC.");
    });
});

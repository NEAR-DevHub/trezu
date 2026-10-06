import { describe, expect, it } from "bun:test";
import type { SwapQuoteResponse } from "@/lib/proposals-api";
import { buildReceiptAmountModel } from "./receipt-models";

const invalidToken = {
    amountDecimal: "invalid",
    amountDisplay: "—",
    amountUsd: Number.NaN,
    symbol: "BAD",
    tokenPrice: Number.NaN,
    historicalPriceUsd: Number.POSITIVE_INFINITY,
};

describe("buildReceiptAmountModel", () => {
    it("degrades malformed receipt values without throwing", () => {
        const result = buildReceiptAmountModel({
            isExchangeReceipt: true,
            hasDepositAddress: false,
            sourceToken: invalidToken,
            destinationToken: invalidToken,
        });

        expect(result.sourceAmountDisplay).toBe("—");
        expect(result.destinationAmountDisplay).toBe("—");
        expect(result.sourceAmountUsd).toBeNull();
        expect(result.destinationAmountUsd).toBeNull();
        expect(result.rateLabel).toBeNull();
    });

    it("falls back to exact receipt values when quote displays are malformed", () => {
        const quote = {
            amountInFormatted: "1,234.56",
            amountOutFormatted: "not-a-number",
            amountInUsd: "not-a-number",
            amountOutUsd: "not-a-number",
        } as SwapQuoteResponse;
        const result = buildReceiptAmountModel({
            isExchangeReceipt: true,
            hasDepositAddress: true,
            quote,
            sourceToken: {
                ...invalidToken,
                amountDecimal: "1234.56",
                amountUsd: undefined,
                tokenPrice: 1,
            },
            destinationToken: {
                ...invalidToken,
                amountDecimal: "10.5",
                amountUsd: undefined,
                tokenPrice: 1,
            },
        });

        expect(result.sourceAmountDisplay).toBe("1,234.56");
        expect(result.destinationAmountDisplay).toBe("10.5");
        expect(result.sourceAmountUsd).toBeNull();
    });

    it("falls back to quote USD when no explicit amountUsd is provided", () => {
        const quote = {
            amountInFormatted: "100",
            amountOutFormatted: "50",
            amountInUsd: "200",
            amountOutUsd: "199",
        } as SwapQuoteResponse;
        const result = buildReceiptAmountModel({
            isExchangeReceipt: true,
            hasDepositAddress: true,
            quote,
            sourceToken: {
                amountDecimal: "100",
                amountDisplay: "100",
                symbol: "NEAR",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
            destinationToken: {
                amountDecimal: "50",
                symbol: "USDC",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
        });

        expect(result.sourceAmountUsd).toBe("$200.00");
        expect(result.destinationAmountUsd).toBe("$199.00");
        expect(result.rateLabel).toBe("1 NEAR ($2.00000) ≈ 0.5 USDC");
    });

    it("shows the transferred amount on a payment receipt with no receive quote", () => {
        const result = buildReceiptAmountModel({
            isExchangeReceipt: false,
            hasDepositAddress: false,
            quote: null,
            sourceToken: {
                amountDecimal: "1",
                amountDisplay: "1",
                symbol: "NEAR",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
            destinationToken: {
                symbol: "NEAR",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
        });

        expect(result.destinationAmountDisplay).toBe("1");
        expect(result.rateLabel).toBeNull();
    });

    it("keeps a quoted receive amount ahead of the transferred amount", () => {
        const quote = {
            amountInFormatted: "1",
            amountOutFormatted: "0.99",
            amountInUsd: "3",
            amountOutUsd: "2.97",
        } as SwapQuoteResponse;
        const result = buildReceiptAmountModel({
            isExchangeReceipt: false,
            hasDepositAddress: true,
            quote,
            sourceToken: {
                amountDecimal: "1",
                amountDisplay: "1",
                symbol: "USDC",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
            destinationToken: {
                symbol: "USDC",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
        });

        expect(result.destinationAmountDisplay).toBe("0.99");
    });

    it("does not copy the sent amount onto an exchange receive leg", () => {
        const result = buildReceiptAmountModel({
            isExchangeReceipt: true,
            hasDepositAddress: false,
            quote: null,
            sourceToken: {
                amountDecimal: "1",
                amountDisplay: "1",
                symbol: "NEAR",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
            destinationToken: {
                symbol: "USDC",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
        });

        expect(result.destinationAmountDisplay).toBe("—");
    });

    it("falls back to historical prices for on-chain receipts", () => {
        const result = buildReceiptAmountModel({
            isExchangeReceipt: false,
            hasDepositAddress: false,
            quote: null,
            sourceToken: {
                amountDecimal: "10",
                amountDisplay: "10",
                symbol: "NEAR",
                tokenPrice: null,
                historicalPriceUsd: 3,
            },
            destinationToken: {
                amountDecimal: "10",
                symbol: "NEAR",
                tokenPrice: null,
                historicalPriceUsd: 3,
            },
        });

        expect(result.sourceAmountUsd).toBe("$30.00");
        expect(result.rateLabel).toContain("1 NEAR");
    });

    it("suppresses fallbacks when an explicit amountUsd is provided", () => {
        const quote = {
            amountInFormatted: "100",
            amountOutFormatted: "50",
            amountInUsd: "200",
            amountOutUsd: "199",
        } as SwapQuoteResponse;
        const result = buildReceiptAmountModel({
            isExchangeReceipt: true,
            hasDepositAddress: true,
            quote,
            sourceToken: {
                amountDecimal: "100",
                amountDisplay: "100",
                amountUsd: null,
                symbol: "NEAR",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
            destinationToken: {
                amountDecimal: "50",
                amountUsd: 201,
                symbol: "USDC",
                tokenPrice: null,
                historicalPriceUsd: null,
            },
        });

        expect(result.sourceAmountUsd).toBeNull();
        expect(result.destinationAmountUsd).toBe("$201.00");
    });
});

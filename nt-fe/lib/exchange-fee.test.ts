import { describe, expect, it } from "bun:test";
import {
    calculateExchangeFeeAmount,
    exchangeFeeBps,
    exchangeFeePercent,
    LEGACY_EXCHANGE_FEE_BPS,
    sumAppFeesBps,
} from "./exchange-fee";

describe("sumAppFeesBps", () => {
    it("adds every fee in the list", () => {
        expect(sumAppFeesBps([{ fee: 15 }, { fee: 20 }])).toBe(35);
        expect(sumAppFeesBps([{ fee: 1 }])).toBe(1);
    });

    it("is null when there is no fee list", () => {
        expect(sumAppFeesBps(undefined)).toBeNull();
        expect(sumAppFeesBps(null)).toBeNull();
    });

    it("ignores entries without a numeric fee", () => {
        expect(sumAppFeesBps([{ fee: 15 }, {}])).toBe(15);
        expect(sumAppFeesBps([])).toBe(0);
    });
});

describe("exchangeFeeBps", () => {
    it("uses the stored total so past swaps keep the fee they paid", () => {
        expect(exchangeFeeBps({ hasAppFee: true, appFeeBps: 36 })).toBe(36);
        expect(exchangeFeeBps({ hasAppFee: true, appFeeBps: 35 })).toBe(35);
    });

    it("shows the Intents-only fee on stablecoin swaps", () => {
        expect(exchangeFeeBps({ hasAppFee: false, appFeeBps: 1 })).toBe(1);
    });

    it("hides the row when nothing was charged", () => {
        expect(exchangeFeeBps({ hasAppFee: false, appFeeBps: 0 })).toBeNull();
        expect(exchangeFeeBps({ hasAppFee: false })).toBeNull();
    });

    it("falls back to the legacy total for swaps with no stored fees", () => {
        expect(exchangeFeeBps({})).toBe(LEGACY_EXCHANGE_FEE_BPS);
        expect(exchangeFeeBps(null)).toBe(LEGACY_EXCHANGE_FEE_BPS);
        expect(exchangeFeeBps({ appFeeBps: null })).toBe(
            LEGACY_EXCHANGE_FEE_BPS,
        );
    });
});

describe("fee amount", () => {
    it("converts basis points to a percentage and an amount", () => {
        expect(exchangeFeePercent(35)).toBe(0.35);
        expect(exchangeFeePercent(1)).toBe(0.01);
        expect(calculateExchangeFeeAmount("1000", 35).toString()).toBe("3.5");
        expect(calculateExchangeFeeAmount("1000").toString()).toBe("7");
    });
});

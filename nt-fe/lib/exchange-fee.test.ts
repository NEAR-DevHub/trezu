import { describe, expect, it } from "bun:test";
import {
    calculateExchangeFeeAmount,
    quoteHasAppFee,
    shouldShowStoredExchangeFee,
} from "./exchange-fee";

describe("quoteHasAppFee", () => {
    it("is false when only the protocol fee is present", () => {
        expect(
            quoteHasAppFee({
                appFees: [
                    { fee: 1, recipient: "5880ad2b", limitOrderId: null },
                ],
            }),
        ).toBe(false);
        expect(quoteHasAppFee({ appFees: [] })).toBe(false);
        expect(quoteHasAppFee({})).toBe(false);
        expect(quoteHasAppFee(null)).toBe(false);
    });

    it("is true when injected app fees sit beside the protocol fee", () => {
        expect(
            quoteHasAppFee({
                appFees: [
                    { fee: 18, recipient: "trezu.sputnik-dao.near" },
                    { fee: 18, recipient: "5880ad2b" },
                ],
            }),
        ).toBe(true);
    });
});

describe("shouldShowStoredExchangeFee", () => {
    it("shows the fee on older proposals that never stored the flag", () => {
        expect(shouldShowStoredExchangeFee(undefined)).toBe(true);
        expect(shouldShowStoredExchangeFee(true)).toBe(true);
        expect(shouldShowStoredExchangeFee(false)).toBe(false);
    });
});

describe("calculateExchangeFeeAmount", () => {
    it("takes 0.7% of a grouped amount", () => {
        expect(calculateExchangeFeeAmount("1,000")?.toFixed()).toBe("7");
    });

    it("returns null for missing or invalid amounts instead of zero", () => {
        expect(calculateExchangeFeeAmount("not-a-number")).toBeNull();
        expect(calculateExchangeFeeAmount(null)).toBeNull();
        expect(calculateExchangeFeeAmount("0")).toBeNull();
    });
});

import { describe, expect, it } from "bun:test";
import { calculateExchangeFeeAmount } from "./exchange-fee";

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

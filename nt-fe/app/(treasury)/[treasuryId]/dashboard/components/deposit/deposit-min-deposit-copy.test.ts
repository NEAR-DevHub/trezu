import { describe, expect, test } from "bun:test";
import {
    formatWholeUsd,
    resolveMinDepositCopy,
} from "./deposit-min-deposit-copy";

describe("resolveMinDepositCopy", () => {
    test("rounds a priced minimum up to whole dollars", () => {
        expect(
            resolveMinDepositCopy({
                minDepositRaw: "3200000",
                decimals: 6,
                priceUsd: 1,
                minDepositDisplay: "3.2",
            }),
        ).toEqual({ kind: "usd", usd: 4 });
    });

    test("never shows less than $1", () => {
        expect(
            resolveMinDepositCopy({
                minDepositRaw: "50000",
                decimals: 6,
                priceUsd: 1,
                minDepositDisplay: "0.05",
            }),
        ).toEqual({ kind: "usd", usd: 1 });
    });

    test("falls back to the token amount without a price", () => {
        expect(
            resolveMinDepositCopy({
                minDepositRaw: "5000000",
                decimals: 6,
                priceUsd: null,
                minDepositDisplay: "5",
            }),
        ).toEqual({ kind: "amount", amount: "5" });
    });

    test("direct deposits without a minimum have no floor", () => {
        expect(
            resolveMinDepositCopy({
                minDepositRaw: null,
                decimals: 24,
                priceUsd: 3,
                minDepositDisplay: null,
                usdFloor: false,
            }),
        ).toEqual({ kind: "none" });
    });

    test("uses the $1 floor when no minimum is known", () => {
        expect(
            resolveMinDepositCopy({
                minDepositRaw: null,
                decimals: 6,
                priceUsd: 1,
                minDepositDisplay: null,
            }),
        ).toEqual({ kind: "usd", usd: 1 });
    });
});

describe("formatWholeUsd", () => {
    test("formats without cents", () => {
        expect(formatWholeUsd(1, "en-US")).toBe("$1");
        expect(formatWholeUsd(12, "en-US")).toBe("$12");
    });
});

import { describe, expect, test } from "bun:test";
import { resolveMinDepositCopy } from "./deposit-min-deposit-copy";

describe("resolveMinDepositCopy", () => {
    test("shows a priced minimum to the cent, rounded up", () => {
        expect(
            resolveMinDepositCopy({
                minDepositRaw: "149500",
                decimals: 6,
                priceUsd: 1,
                minDepositDisplay: "0.1495",
            }),
        ).toEqual({ kind: "usd", usd: 0.15 });
        expect(
            resolveMinDepositCopy({
                minDepositRaw: "3200000",
                decimals: 6,
                priceUsd: 1,
                minDepositDisplay: "3.2",
            }),
        ).toEqual({ kind: "usd", usd: 3.2 });
    });

    test("a minimum under a cent still reads as a cent, never zero", () => {
        expect(
            resolveMinDepositCopy({
                minDepositRaw: "4000",
                decimals: 6,
                priceUsd: 1,
                minDepositDisplay: "0.004",
            }),
        ).toEqual({ kind: "usd", usd: 0.01 });
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

import { describe, expect, test } from "bun:test";
import type { TreasuryAsset } from "@/lib/api";
import Big from "@/lib/big";
import { getBalanceHistoryTokenIds } from "./balance-history-token-ids";

function asset(overrides: Partial<TreasuryAsset>): TreasuryAsset {
    return {
        id: "near",
        residency: "Near",
        network: "near",
        chainName: "NEAR",
        symbol: "NEAR",
        decimals: 24,
        price: 1,
        name: "NEAR",
        icon: "",
        balanceUSD: 0,
        weight: 0,
        balance: { type: "Standard", total: Big(0), locked: Big(0) },
        ...overrides,
    };
}

describe("getBalanceHistoryTokenIds", () => {
    test("lockup rows map to their lockup series", () => {
        expect(
            getBalanceHistoryTokenIds(
                asset({
                    residency: "Lockup",
                    lockupAccountId: "abc123.lockup.near",
                }),
            ),
        ).toEqual(["lockup:abc123.lockup.near"]);
    });

    test("lockup rows without an account id have no series", () => {
        expect(
            getBalanceHistoryTokenIds(asset({ residency: "Lockup" })),
        ).toEqual([]);
    });

    test("staked rows map to one series per pool", () => {
        expect(
            getBalanceHistoryTokenIds(
                asset({
                    residency: "Staked",
                    balance: {
                        type: "Staked",
                        staking: {
                            stakedBalance: Big(1),
                            unstakedBalance: Big(0),
                            canWithdraw: false,
                            pools: [
                                {
                                    poolId: "astro-stakers.poolv1.near",
                                    stakedBalance: Big(1),
                                    unstakedBalance: Big(0),
                                    canWithdraw: false,
                                },
                            ],
                        },
                    },
                }),
            ),
        ).toEqual(["staking:astro-stakers.poolv1.near"]);
    });

    test("intents rows are prefixed", () => {
        expect(
            getBalanceHistoryTokenIds(
                asset({ residency: "Intents", contractId: "nep141:usdt.near" }),
            ),
        ).toEqual(["intents.near:nep141:usdt.near"]);
    });
});

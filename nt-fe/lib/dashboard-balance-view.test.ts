import { describe, expect, test } from "bun:test";
import type { TreasuryAsset } from "@/lib/api";
import Big from "@/lib/big";
import {
    getDashboardBalanceView,
    getDashboardBucketVisibility,
} from "./dashboard-balance-view";

const NEAR = Big(10).pow(24);

function lockupAsset(lockup: {
    total: number;
    unvested: number;
    staked: number;
    storageLocked: number;
}): TreasuryAsset {
    return {
        id: "near",
        residency: "Lockup",
        network: "near",
        chainName: "NEAR",
        symbol: "NEAR",
        decimals: 24,
        price: 2,
        name: "NEAR",
        icon: "",
        balanceUSD: lockup.total * 2,
        weight: 100,
        balance: {
            type: "Vested",
            lockup: {
                total: NEAR.mul(lockup.total),
                totalAllocated: NEAR.mul(lockup.total),
                unvested: NEAR.mul(lockup.unvested),
                staked: NEAR.mul(lockup.staked),
                storageLocked: NEAR.mul(lockup.storageLocked),
                unstakedBalance: Big(0),
                canWithdraw: false,
            },
        },
    };
}

describe("getDashboardBalanceView", () => {
    test("unstaked lockup balance counts as locked, not available", () => {
        // Fully vested lockup with most of it staked and ~16k NEAR not staked
        // (liquid + pending unstake + storage), like braindao-treasury.
        const view = getDashboardBalanceView([
            lockupAsset({
                total: 751_484,
                unvested: 0,
                staked: 735_155,
                storageLocked: 3,
            }),
        ]);

        expect(view.totalUsd).toBeCloseTo(751_484 * 2, 6);
        expect(view.earningUsd).toBeCloseTo(735_155 * 2, 6);
        expect(view.lockedUsd).toBeCloseTo(16_329 * 2, 6);
        expect(view.availableUsd).toBe(0);
        expect(
            view.availableUsd + view.lockedUsd + view.earningUsd,
        ).toBeCloseTo(view.totalUsd, 6);
    });

    test("buckets sum to total when unvested exceeds staked", () => {
        const view = getDashboardBalanceView([
            lockupAsset({
                total: 1_000,
                unvested: 600,
                staked: 200,
                storageLocked: 4,
            }),
        ]);

        expect(view.earningUsd).toBeCloseTo(200 * 2, 6);
        expect(view.lockedUsd).toBeCloseTo(800 * 2, 6);
        expect(view.availableUsd).toBe(0);
        expect(
            view.availableUsd + view.lockedUsd + view.earningUsd,
        ).toBeCloseTo(view.totalUsd, 6);
    });
});

describe("getDashboardBucketVisibility", () => {
    function stakedAsset(
        pools: {
            poolId: string;
            staked: number;
            unstaked: number;
        }[],
    ): TreasuryAsset {
        // Aggregate top-level staking totals from the pool rows so the
        // generated asset matches what `transformBalance` would produce for
        // a real "staked" row arriving from the backend.
        const stakedBalance = pools.reduce(
            (acc, p) => acc.add(NEAR.mul(p.staked)),
            Big(0),
        );
        const unstakedBalance = pools.reduce(
            (acc, p) => acc.add(NEAR.mul(p.unstaked)),
            Big(0),
        );
        return {
            id: "near",
            residency: "Staked",
            network: "near",
            chainName: "NEAR",
            symbol: "NEAR",
            decimals: 24,
            price: 2,
            name: "NEAR",
            icon: "",
            balanceUSD: 0,
            weight: 0,
            balance: {
                type: "Staked",
                staking: {
                    stakedBalance,
                    unstakedBalance,
                    canWithdraw: false,
                    pools: pools.map((p) => ({
                        poolId: p.poolId,
                        stakedBalance: NEAR.mul(p.staked),
                        unstakedBalance: NEAR.mul(p.unstaked),
                        canWithdraw: false,
                    })),
                },
            },
        };
    }

    test("Staked with only unstaked pool funds still shows the earning tab", () => {
        // This is the exact PR scenario: tokens are deposited into a staking
        // pool but not staked (e.g. pending withdrawal), so the only non-zero
        // field on the pool is `unstakedBalance`.
        const visibility = getDashboardBucketVisibility([
            stakedAsset([
                { poolId: "astro-stakers.poolv1.near", staked: 0, unstaked: 5 },
            ]),
        ]);

        expect(visibility.showEarning).toBe(true);
        expect(visibility.showLocked).toBe(false);
    });

    test("Staked with a positive stakedBalance still shows the earning tab", () => {
        // Regression guard: widening the predicate to include unstaked
        // balances must not drop the original positive-staked case.
        const visibility = getDashboardBucketVisibility([
            stakedAsset([
                {
                    poolId: "astro-stakers.poolv1.near",
                    staked: 10,
                    unstaked: 0,
                },
            ]),
        ]);

        expect(visibility.showEarning).toBe(true);
    });

    test("Staked with an empty pool hides the earning tab", () => {
        const visibility = getDashboardBucketVisibility([
            stakedAsset([
                {
                    poolId: "astro-stakers.poolv1.near",
                    staked: 0,
                    unstaked: 0,
                },
            ]),
        ]);

        expect(visibility.showEarning).toBe(false);
        expect(visibility.showLocked).toBe(false);
    });
});

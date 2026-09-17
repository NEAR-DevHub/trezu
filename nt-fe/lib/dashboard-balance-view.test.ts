import { describe, expect, test } from "bun:test";
import type { TreasuryAsset } from "@/lib/api";
import Big from "@/lib/big";
import { getDashboardBalanceView } from "./dashboard-balance-view";

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

import { describe, expect, it } from "bun:test";
import Big from "@/lib/big";
import { hasPoolFunds } from "./balance";

const NEAR = Big(10).pow(24);

function pool(stakedBalance: Big, unstakedBalance: Big) {
    return {
        poolId: "x",
        stakedBalance,
        unstakedBalance,
        canWithdraw: false,
    };
}

describe("hasPoolFunds", () => {
    it("returns false for an empty pool", () => {
        expect(hasPoolFunds(pool(Big(0), Big(0)))).toBe(false);
    });

    it("returns true for a pool with only a pending unstaked balance", () => {
        // This is the exact PR scenario: tokens deposited into a staking
        // pool but not staked (e.g. pending withdrawal), so the only
        // non-zero field is `unstakedBalance`.
        expect(hasPoolFunds(pool(Big(0), NEAR.mul(5)))).toBe(true);
    });

    it("returns true for a pool with both staked and unstaked balances", () => {
        expect(hasPoolFunds(pool(NEAR.mul(10), NEAR.mul(3)))).toBe(true);
    });
});

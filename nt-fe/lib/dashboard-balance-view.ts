import type { TreasuryAsset } from "@/lib/api";
import Big from "@/lib/big";

export interface DashboardBalanceView {
    totalUsd: number;
    availableUsd: number;
    lockedUsd: number;
    earningUsd: number;
}

export interface DashboardBucketVisibility {
    showLocked: boolean;
    showEarning: boolean;
}

export interface DashboardBreakdownItem {
    key: "available" | "locked" | "earning";
    label: string;
    value: number;
}

const ZERO = Big(0);

function clampNonNegative(value: Big.Big): Big.Big {
    return value.lt(ZERO) ? ZERO : value;
}

function toUsd(rawAmount: Big.Big, decimals: number, price: number): number {
    if (price <= 0) return 0;
    return rawAmount.div(Big(10).pow(decimals)).mul(price).toNumber();
}

function getTokenBucketRaw(token: TreasuryAsset): {
    availableRaw: Big.Big;
    lockedRaw: Big.Big;
    earningRaw: Big.Big;
    totalRaw: Big.Big;
} {
    let totalRaw = ZERO;
    let availableRaw = ZERO;
    let lockedRaw = ZERO;
    let earningRaw = ZERO;

    if (token.balance.type === "Standard") {
        totalRaw = token.balance.total;
        lockedRaw = token.balance.locked.gt(totalRaw)
            ? totalRaw
            : token.balance.locked;
        availableRaw = totalRaw.sub(lockedRaw);
    } else if (token.balance.type === "Staked") {
        const staked = token.balance.staking.stakedBalance;
        const unstaked = token.balance.staking.unstakedBalance;
        totalRaw = staked.add(unstaked);
        earningRaw = staked;
        availableRaw = token.balance.staking.canWithdraw ? unstaked : ZERO;
        lockedRaw = token.balance.staking.canWithdraw ? ZERO : unstaked;
    } else if (token.balance.type === "Vested") {
        const lockup = token.balance.lockup;
        const staked = lockup.staked;
        const nonStakedLocked = lockup.unvested.sub(staked);
        totalRaw = lockup.total;
        earningRaw = staked;
        lockedRaw = clampNonNegative(nonStakedLocked).add(lockup.storageLocked);
        availableRaw = clampNonNegative(
            totalRaw.sub(earningRaw).sub(lockedRaw),
        );
    }

    return { totalRaw, availableRaw, lockedRaw, earningRaw };
}

export function getDashboardBucketVisibility(
    tokens: TreasuryAsset[],
): DashboardBucketVisibility {
    let showLocked = false;
    let showEarning = false;

    for (const token of tokens) {
        const { lockedRaw, earningRaw } = getTokenBucketRaw(token);
        showLocked = showLocked || lockedRaw.gt(0);
        // Earning is shown when there is active staking principal either:
        // - in staking pools (Staked balances), or
        // - in lockup staking (Vested balances with staked > 0).
        if (token.balance.type === "Staked") {
            const hasPoolStaked = token.balance.staking.pools.some((pool) =>
                pool.stakedBalance.gt(0),
            );
            showEarning = showEarning || (earningRaw.gt(0) && hasPoolStaked);
        } else if (token.balance.type === "Vested") {
            showEarning = showEarning || earningRaw.gt(0);
        }
    }

    return { showLocked, showEarning };
}

export function getDashboardBreakdownItems(
    tokens: TreasuryAsset[],
): DashboardBreakdownItem[] {
    const balanceView = getDashboardBalanceView(tokens);
    const visibility = getDashboardBucketVisibility(tokens);

    const items: DashboardBreakdownItem[] = [
        {
            key: "available",
            label: "Available",
            value: balanceView.availableUsd,
        },
    ];
    if (visibility.showLocked) {
        items.push({
            key: "locked",
            label: "Locked",
            value: balanceView.lockedUsd,
        });
    }
    if (visibility.showEarning) {
        items.push({
            key: "earning",
            label: "Earning",
            value: balanceView.earningUsd,
        });
    }
    return items;
}

export function getDashboardBalanceView(
    tokens: TreasuryAsset[],
): DashboardBalanceView {
    let totalUsd = 0;
    let availableUsd = 0;
    let lockedUsd = 0;
    let earningUsd = 0;

    for (const token of tokens) {
        const { totalRaw, availableRaw, lockedRaw, earningRaw } =
            getTokenBucketRaw(token);

        totalUsd += toUsd(totalRaw, token.decimals, token.price);
        availableUsd += toUsd(availableRaw, token.decimals, token.price);
        lockedUsd += toUsd(lockedRaw, token.decimals, token.price);
        earningUsd += toUsd(earningRaw, token.decimals, token.price);
    }

    return {
        totalUsd,
        availableUsd,
        lockedUsd,
        earningUsd,
    };
}

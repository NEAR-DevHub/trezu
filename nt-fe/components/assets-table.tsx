"use client";

import {
    ArrowLeftRight,
    ArrowUpDown,
    ArrowUpRight,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    Info,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { AuthButton } from "@/components/auth-button";
import { Button } from "@/components/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { AggregatedAsset } from "@/hooks/use-assets";
import { useTreasury } from "@/hooks/use-treasury";
import type { TreasuryAsset } from "@/lib/api";
import { availableBalance, lockedBalance } from "@/lib/balance";
import Big from "@/lib/big";
import { getDashboardBucketVisibility } from "@/lib/dashboard-balance-view";
import {
    cn,
    formatBalance,
    formatCurrency,
    formatSmartAmount,
} from "@/lib/utils";
import { EarningPoolDetailsModal } from "./earning-pool-details-modal";
import { LockupDetailsModal } from "./lockup-details-modal";
import { BalanceCell, NetworkDisplay } from "./token-display";

type ViewMode = "available" | "locked" | "earning";
type SortDirection = "asc" | "desc";
type NetworkAsset = AggregatedAsset["networks"][number];
type SortKey =
    | "token"
    | "balance"
    | "price"
    | "weight"
    | "locked"
    | "unlocked"
    | "totalAllocated"
    | "earningTotal"
    | "withdrawable";

interface Props {
    aggregatedTokens: AggregatedAsset[];
}

interface AssetMetrics {
    availableUsd: number;
    lockedUsd: number;
    earningUsd: number;
    hasAvailable: boolean;
    hasLocked: boolean;
    hasEarning: boolean;
}

const DEFAULT_DECIMALS = 24;
const SORT_BUTTON_CLASS =
    "inline-flex items-center gap-1 hover:text-foreground hover:bg-transparent px-1! uppercase text-xxs";
const SORT_BUTTON_LEFT_CLASS =
    "flex items-center gap-1 hover:text-foreground hover:bg-transparent px-1! uppercase text-xxs";

function toUsd(rawAmount: Big.Big, decimals: number, price: number): number {
    if (price <= 0) return 0;
    return rawAmount.div(Big(10).pow(decimals)).mul(price).toNumber();
}

function networkAvailableRaw(asset: NetworkAsset): Big.Big {
    if (asset.residency === "Staked") return Big(0);
    if (asset.balance.type === "Vested") {
        const staked = asset.balance.lockup.staked;
        const nonStakedLocked = asset.balance.lockup.unvested.sub(staked);
        const locked = nonStakedLocked.gt(0)
            ? nonStakedLocked.add(asset.balance.lockup.storageLocked)
            : asset.balance.lockup.storageLocked;
        const available = asset.balance.lockup.total.sub(staked).sub(locked);
        return available.gt(0) ? available : Big(0);
    }
    return availableBalance(asset.balance);
}

function networkAvailableRawForAvailableView(asset: NetworkAsset): Big.Big {
    if (asset.residency === "Staked" || asset.residency === "Lockup") {
        return Big(0);
    }
    return availableBalance(asset.balance);
}

function networkLockedRaw(asset: NetworkAsset): Big.Big {
    if (asset.residency === "Staked") return Big(0);
    if (asset.balance.type === "Vested") {
        const nonStakedLocked = asset.balance.lockup.unvested.sub(
            asset.balance.lockup.staked,
        );
        const clampedNonStakedLocked = nonStakedLocked.gt(0)
            ? nonStakedLocked
            : Big(0);
        return clampedNonStakedLocked.add(asset.balance.lockup.storageLocked);
    }
    return lockedBalance(asset.balance);
}

function networkEarningRaw(asset: NetworkAsset): Big.Big {
    if (asset.balance.type === "Staked") {
        return asset.balance.staking.stakedBalance;
    }
    if (asset.balance.type === "Vested") {
        return asset.balance.lockup.staked;
    }
    return Big(0);
}

function getAssetMetrics(asset: AggregatedAsset): AssetMetrics {
    let availableUsd = 0;
    let lockedUsd = 0;
    let earningUsd = 0;
    let hasAvailable = false;
    let hasLocked = false;
    let hasEarning = false;

    for (const network of asset.networks) {
        const availableRaw = networkAvailableRaw(network);
        const lockedRaw = networkLockedRaw(network);
        const earningRaw = networkEarningRaw(network);
        const availableForAvailableViewRaw =
            networkAvailableRawForAvailableView(network);

        availableUsd += toUsd(
            availableForAvailableViewRaw,
            network.decimals,
            network.price,
        );
        lockedUsd += toUsd(lockedRaw, network.decimals, network.price);
        earningUsd += toUsd(earningRaw, network.decimals, network.price);

        hasAvailable = hasAvailable || availableForAvailableViewRaw.gt(0);
        hasLocked = hasLocked || lockedRaw.gt(0);
        hasEarning = hasEarning || earningRaw.gt(0);
    }

    return {
        availableUsd,
        lockedUsd,
        earningUsd,
        hasAvailable,
        hasLocked,
        hasEarning,
    };
}

function displayAmount(rawAmount: Big.Big, decimals: number): Big.Big {
    return Big(formatBalance(rawAmount, decimals, decimals));
}

function defaultSortForView(view: ViewMode): {
    key: SortKey;
    dir: SortDirection;
} {
    if (view === "available") return { key: "balance", dir: "desc" };
    if (view === "locked") return { key: "locked", dir: "desc" };
    return { key: "earningTotal", dir: "desc" };
}

function isSortKeySupportedForView(key: SortKey, view: ViewMode): boolean {
    if (key === "token" || key === "price") return true;
    if (view === "available") return key === "balance" || key === "weight";
    if (view === "locked") {
        return (
            key === "locked" || key === "unlocked" || key === "totalAllocated"
        );
    }
    return key === "earningTotal" || key === "withdrawable";
}

function networkRowKey(
    assetId: string,
    view: ViewMode,
    network: NetworkAsset,
): string {
    return [
        assetId,
        view,
        network.residency,
        network.lockupInstanceId ?? "no-session",
        network.contractId ?? "no-contract",
        network.network,
        network.id,
    ].join(":");
}

interface AvailableExpandedRowsProps {
    asset: AggregatedAsset;
    availableNetworks: NetworkAsset[];
    treasuryId: string | null;
    onNavigate: (href: string) => void;
}

interface MergedAvailableNetwork {
    network: NetworkAsset;
    availableRaw: Big.Big;
    isLockupUnlocked: boolean;
}

function buildAvailableSourceKey(
    network: NetworkAsset,
    isLockupUnlocked: boolean,
): string {
    return [
        network.network,
        isLockupUnlocked ? "lockup-unlocked" : network.residency,
        network.contractId ?? network.id,
    ].join(":");
}

function mergeAvailableNetworks(
    availableNetworks: NetworkAsset[],
): MergedAvailableNetwork[] {
    const bySource = new Map<string, MergedAvailableNetwork>();

    for (const network of availableNetworks) {
        const isLockupUnlocked = !!network.lockupInstanceId;
        const sourceKey = buildAvailableSourceKey(network, isLockupUnlocked);
        const availableRaw = networkAvailableRawForAvailableView(network);
        const existing = bySource.get(sourceKey);

        if (existing) {
            existing.availableRaw = existing.availableRaw.add(availableRaw);
        } else {
            bySource.set(sourceKey, {
                network,
                availableRaw,
                isLockupUnlocked,
            });
        }
    }

    return Array.from(bySource.values());
}

function AvailableExpandedRows({
    asset,
    availableNetworks,
    treasuryId,
    onNavigate,
}: AvailableExpandedRowsProps) {
    // Merge same source token rows, but keep lockup-unlocked amounts separate
    // from regular FT wallet balances so they can be shown as "Unlocked Token".
    const mergedAvailableNetworks = useMemo(
        () => mergeAvailableNetworks(availableNetworks),
        [availableNetworks],
    );

    return (
        <>
            <TableRow className="bg-muted/30 uppercase text-muted-foreground font-medium hover:bg-muted/30">
                <TableCell className="p-2 pl-16 text-xxs">Source</TableCell>
                <TableCell className="p-2 text-xxs text-right">
                    Balance
                </TableCell>
                <TableCell colSpan={3} />
            </TableRow>
            {mergedAvailableNetworks.map(
                ({ network, availableRaw, isLockupUnlocked }) => {
                    const tokenParam = encodeURIComponent(
                        JSON.stringify({
                            symbol: network.symbol,
                            address: network.id,
                            network: network.network,
                            decimals: network.decimals,
                            icon: network.icon,
                            name: network.name,
                        }),
                    );
                    return (
                        <TableRow
                            key={networkRowKey(asset.id, "available", network)}
                            className="bg-muted/30 group"
                        >
                            <TableCell className="p-4 pl-16">
                                <NetworkDisplay
                                    asset={network}
                                    subLabel={
                                        isLockupUnlocked
                                            ? "Unlocked Token"
                                            : undefined
                                    }
                                />
                            </TableCell>
                            <TableCell className="p-4 text-right">
                                <BalanceCell
                                    balance={displayAmount(
                                        availableRaw,
                                        network.decimals,
                                    )}
                                    symbol={network.symbol}
                                    balanceUSD={toUsd(
                                        availableRaw,
                                        network.decimals,
                                        network.price,
                                    )}
                                />
                            </TableCell>
                            <TableCell className="p-4">
                                {!isLockupUnlocked && (
                                    <div className="flex gap-1 justify-end">
                                        <AuthButton
                                            permissionKind="transfer"
                                            permissionAction="AddProposal"
                                            variant="ghost"
                                            size="icon"
                                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                            tooltipContent="Send"
                                            onClick={() =>
                                                onNavigate(
                                                    `/${treasuryId}/payments?token=${tokenParam}`,
                                                )
                                            }
                                        >
                                            <ArrowUpRight className="size-4 text-primary" />
                                        </AuthButton>
                                        <AuthButton
                                            permissionKind="call"
                                            permissionAction="AddProposal"
                                            variant="ghost"
                                            size="icon"
                                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                            tooltipContent="Exchange"
                                            onClick={() =>
                                                onNavigate(
                                                    `/${treasuryId}/exchange?sellToken=${tokenParam}`,
                                                )
                                            }
                                        >
                                            <ArrowLeftRight className="size-4 text-primary" />
                                        </AuthButton>
                                    </div>
                                )}
                            </TableCell>
                            <TableCell />
                            <TableCell />
                        </TableRow>
                    );
                },
            )}
        </>
    );
}

interface LockedExpandedRowsProps {
    asset: AggregatedAsset;
    lockedNetworks: NetworkAsset[];
    ftLockupInstanceCount: number;
    onSelectLockup: (network: TreasuryAsset) => void;
}

function LockedExpandedRows({
    asset,
    lockedNetworks,
    ftLockupInstanceCount,
    onSelectLockup,
}: LockedExpandedRowsProps) {
    return (
        <>
            <TableRow className="bg-muted/30 uppercase text-muted-foreground font-medium hover:bg-muted/30">
                <TableCell className="p-2 pl-16 text-xxs">
                    {lockedNetworks.length === 1 ? "Investor" : "Investors"}
                </TableCell>
                <TableCell colSpan={5} />
            </TableRow>
            {lockedNetworks.map((network) => {
                const lockedRawNetwork = networkLockedRaw(network);
                const unlockedRawNetwork = networkAvailableRaw(network);
                const totalAllocated = lockedRawNetwork.add(unlockedRawNetwork);
                return (
                    <TableRow
                        key={networkRowKey(asset.id, "locked", network)}
                        className="bg-muted/30 cursor-pointer hover:bg-muted/50"
                        onClick={() => onSelectLockup(network)}
                    >
                        <TableCell className="p-4 pl-16">
                            <div className="space-y-1">
                                <div className="flex items-center gap-3">
                                    {network.icon ? (
                                        <img
                                            src={network.icon}
                                            alt={network.symbol}
                                            className="size-6 rounded-full"
                                        />
                                    ) : (
                                        <div className="size-6 rounded-full bg-gradient-cyan-blue flex items-center justify-center text-white text-xs font-semibold">
                                            {network.symbol
                                                .charAt(0)
                                                .toUpperCase()}
                                        </div>
                                    )}
                                    <div className="flex flex-col text-left">
                                        <span className="font-semibold">
                                            {network.symbol}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            Locked Token
                                            {ftLockupInstanceCount > 1 &&
                                                network.lockupInstanceId && (
                                                    <span>
                                                        {" "}
                                                        -{" "}
                                                        {network.lockupInstanceId.replace(
                                                            ".ft-lockup.near",
                                                            "",
                                                        )}
                                                    </span>
                                                )}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </TableCell>
                        <TableCell className="p-4 text-right">
                            <BalanceCell
                                balance={displayAmount(
                                    lockedRawNetwork,
                                    network.decimals,
                                )}
                                symbol={network.symbol}
                                balanceUSD={toUsd(
                                    lockedRawNetwork,
                                    network.decimals,
                                    network.price,
                                )}
                            />
                        </TableCell>
                        <TableCell className="p-4 text-right">
                            <BalanceCell
                                balance={displayAmount(
                                    unlockedRawNetwork,
                                    network.decimals,
                                )}
                                symbol={network.symbol}
                                balanceUSD={toUsd(
                                    unlockedRawNetwork,
                                    network.decimals,
                                    network.price,
                                )}
                            />
                        </TableCell>
                        <TableCell />
                        <TableCell className="p-4 text-right">
                            <BalanceCell
                                balance={displayAmount(
                                    totalAllocated,
                                    network.decimals,
                                )}
                                symbol={network.symbol}
                                balanceUSD={toUsd(
                                    totalAllocated,
                                    network.decimals,
                                    network.price,
                                )}
                            />
                        </TableCell>
                        <TableCell />
                    </TableRow>
                );
            })}
        </>
    );
}

interface EarningExpandedRowsProps {
    asset: AggregatedAsset;
    earningNetworks: NetworkAsset[];
    onSelectPool: (network: TreasuryAsset, poolId: string) => void;
}

function EarningExpandedRows({
    asset,
    earningNetworks,
    onSelectPool,
}: EarningExpandedRowsProps) {
    return (
        <>
            <TableRow className="bg-muted/30 uppercase text-muted-foreground font-medium hover:bg-muted/30">
                <TableCell className="p-2 pl-16 text-xxs">
                    Pool Breakdown
                </TableCell>
                <TableCell colSpan={4} />
            </TableRow>
            {earningNetworks.flatMap((network, networkIdx) => {
                if (network.balance.type === "Staked") {
                    return network.balance.staking.pools.map(
                        (pool, poolIdx) => {
                            const poolTotal = pool.stakedBalance.add(
                                pool.unstakedBalance,
                            );
                            const poolWithdraw = pool.canWithdraw
                                ? pool.unstakedBalance
                                : Big(0);
                            return (
                                <TableRow
                                    key={`${asset.id}-earning-${networkIdx}-${poolIdx}`}
                                    className="bg-muted/30 cursor-pointer hover:bg-muted/50"
                                    onClick={() =>
                                        onSelectPool(network, pool.poolId)
                                    }
                                >
                                    <TableCell className="p-4 pl-16">
                                        <div className="font-medium text-sm">
                                            {pool.poolId}
                                        </div>
                                    </TableCell>
                                    <TableCell className="p-4 text-right">
                                        <BalanceCell
                                            balance={displayAmount(
                                                poolTotal,
                                                network.decimals,
                                            )}
                                            symbol={network.symbol}
                                            balanceUSD={toUsd(
                                                poolTotal,
                                                network.decimals,
                                                network.price,
                                            )}
                                        />
                                    </TableCell>
                                    <TableCell />
                                    <TableCell className="p-4 text-right">
                                        <BalanceCell
                                            balance={displayAmount(
                                                poolWithdraw,
                                                network.decimals,
                                            )}
                                            symbol={network.symbol}
                                            balanceUSD={toUsd(
                                                poolWithdraw,
                                                network.decimals,
                                                network.price,
                                            )}
                                        />
                                    </TableCell>
                                    <TableCell />
                                </TableRow>
                            );
                        },
                    );
                }

                if (
                    network.balance.type === "Vested" &&
                    network.balance.lockup.staked.gt(0)
                ) {
                    // Lockup staking exposes a single logical pool via stakingPoolId.
                    const lockupPoolId =
                        network.balance.lockup.stakingPoolId ??
                        "Lockup staking pool";
                    const poolTotal = network.balance.lockup.staked.add(
                        network.balance.lockup.unstakedBalance,
                    );
                    const poolWithdraw = network.balance.lockup.canWithdraw
                        ? network.balance.lockup.unstakedBalance
                        : Big(0);
                    return [
                        <TableRow
                            key={`${asset.id}-earning-lockup-${networkIdx}`}
                            className="bg-muted/30 cursor-pointer hover:bg-muted/50"
                            onClick={() => onSelectPool(network, lockupPoolId)}
                        >
                            <TableCell className="p-4 pl-16">
                                <div className="font-medium text-sm">
                                    {lockupPoolId}
                                </div>
                            </TableCell>
                            <TableCell className="p-4 text-right">
                                <BalanceCell
                                    balance={displayAmount(
                                        poolTotal,
                                        network.decimals,
                                    )}
                                    symbol={network.symbol}
                                    balanceUSD={toUsd(
                                        poolTotal,
                                        network.decimals,
                                        network.price,
                                    )}
                                />
                            </TableCell>
                            <TableCell />
                            <TableCell className="p-4 text-right">
                                <BalanceCell
                                    balance={displayAmount(
                                        poolWithdraw,
                                        network.decimals,
                                    )}
                                    symbol={network.symbol}
                                    balanceUSD={toUsd(
                                        poolWithdraw,
                                        network.decimals,
                                        network.price,
                                    )}
                                />
                            </TableCell>
                            <TableCell />
                        </TableRow>,
                    ];
                }

                return [];
            })}
        </>
    );
}

export function AssetsTable({ aggregatedTokens }: Props) {
    const { treasuryId } = useTreasury();
    const router = useRouter();
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [selectedStakingNetwork, setSelectedStakingNetwork] =
        useState<TreasuryAsset | null>(null);
    const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
    const [isStakingModalOpen, setIsStakingModalOpen] = useState(false);
    const [selectedLockupNetwork, setSelectedLockupNetwork] =
        useState<TreasuryAsset | null>(null);
    const [isLockupModalOpen, setIsLockupModalOpen] = useState(false);
    const [sortState, setSortState] = useState<{
        key: SortKey;
        dir: SortDirection;
    }>({ key: "balance", dir: "desc" });
    const metricsById = useMemo(
        () =>
            new Map(
                aggregatedTokens.map((asset) => [
                    asset.id,
                    getAssetMetrics(asset),
                ]),
            ),
        [aggregatedTokens],
    );

    const totals = useMemo(() => {
        let availableUsd = 0;
        let lockedUsd = 0;
        let earningUsd = 0;
        for (const asset of aggregatedTokens) {
            const metrics = metricsById.get(asset.id);
            if (!metrics) continue;
            availableUsd += metrics.availableUsd;
            lockedUsd += metrics.lockedUsd;
            earningUsd += metrics.earningUsd;
        }
        return { availableUsd, lockedUsd, earningUsd };
    }, [aggregatedTokens, metricsById]);

    const bucketVisibility = useMemo(
        () =>
            getDashboardBucketVisibility(
                aggregatedTokens.flatMap(
                    (asset) => asset.networks,
                ) as TreasuryAsset[],
            ),
        [aggregatedTokens],
    );
    const showLocked = bucketVisibility.showLocked;
    const showEarning = bucketVisibility.showEarning;
    const hasLockedOrEarning = showLocked || showEarning;
    const visibleViews: Array<[ViewMode, string, number]> = [
        ["available", "Available", totals.availableUsd],
    ];
    if (showLocked) {
        visibleViews.push(["locked", "Locked", totals.lockedUsd]);
    }
    if (showEarning) {
        visibleViews.push(["earning", "Earning", totals.earningUsd]);
    }
    const [activeView, setActiveView] = useState<ViewMode>("available");
    const view: ViewMode =
        hasLockedOrEarning && visibleViews.some(([id]) => id === activeView)
            ? activeView
            : "available";
    const activeSort = useMemo(() => {
        if (isSortKeySupportedForView(sortState.key, view)) return sortState;
        return defaultSortForView(view);
    }, [sortState, view]);

    const viewAssets = useMemo(() => {
        const filtered = aggregatedTokens.filter((asset) => {
            const metrics = metricsById.get(asset.id);
            if (!metrics) return false;
            if (view === "available") return metrics.hasAvailable;
            if (view === "locked") return metrics.hasLocked;
            return metrics.hasEarning;
        });

        const totalForView = filtered.reduce((sum, asset) => {
            const metrics = metricsById.get(asset.id);
            if (!metrics) return sum;
            if (view === "available") return sum + metrics.availableUsd;
            if (view === "locked") return sum + metrics.lockedUsd;
            return sum + metrics.earningUsd;
        }, 0);

        return filtered
            .map((asset) => {
                const metrics = metricsById.get(asset.id);
                if (!metrics) {
                    return {
                        asset,
                        metrics: getAssetMetrics(asset),
                        weight: 0,
                        sortValues: {
                            token: asset.id.toLowerCase(),
                            balance: 0,
                            price: asset.price,
                            weight: 0,
                            locked: 0,
                            unlocked: 0,
                            totalAllocated: 0,
                            earningTotal: 0,
                            withdrawable: 0,
                        },
                    };
                }
                const valueUsd =
                    view === "available"
                        ? metrics.availableUsd
                        : view === "locked"
                          ? metrics.lockedUsd
                          : metrics.earningUsd;

                const lockedNetworks = asset.networks.filter((n) => {
                    if (n.residency === "Staked") return false;
                    return (
                        networkLockedRaw(n).gt(0) ||
                        (n.residency === "Lockup" &&
                            networkAvailableRaw(n).gt(0))
                    );
                });
                const unlockedUsd = lockedNetworks.reduce(
                    (sum, n) =>
                        sum +
                        toUsd(networkAvailableRaw(n), n.decimals, n.price),
                    0,
                );

                const withdrawableUsd = asset.networks
                    .filter((n) => n.residency === "Staked")
                    .reduce(
                        (sum, n) =>
                            sum +
                            toUsd(
                                availableBalance(n.balance),
                                n.decimals,
                                n.price,
                            ),
                        0,
                    );

                return {
                    asset,
                    metrics,
                    weight:
                        totalForView > 0 ? (valueUsd / totalForView) * 100 : 0,
                    sortValues: {
                        token: asset.id.toLowerCase(),
                        balance: metrics.availableUsd,
                        price: asset.price,
                        weight:
                            totalForView > 0
                                ? (valueUsd / totalForView) * 100
                                : 0,
                        locked: metrics.lockedUsd,
                        unlocked: unlockedUsd,
                        totalAllocated: metrics.lockedUsd + unlockedUsd,
                        earningTotal: metrics.earningUsd,
                        withdrawable: withdrawableUsd,
                    },
                };
            })
            .sort((a, b) => {
                const key = activeSort.key;
                const dir = activeSort.dir === "asc" ? 1 : -1;
                if (key === "token") {
                    return (
                        a.sortValues.token.localeCompare(b.sortValues.token) *
                        dir
                    );
                }
                return (a.sortValues[key] - b.sortValues[key]) * dir;
            });
    }, [aggregatedTokens, metricsById, view, activeSort]);

    const toggleSort = (key: SortKey) => {
        setSortState((prev) => {
            if (prev.key === key) {
                return {
                    key,
                    dir: prev.dir === "desc" ? "asc" : "desc",
                };
            }
            return {
                key,
                dir: key === "token" ? "asc" : "desc",
            };
        });
    };
    const renderSortIcon = (key: SortKey) => {
        if (activeSort.key !== key) return <ArrowUpDown className="size-3" />;
        return activeSort.dir === "desc" ? (
            <ChevronDown className="size-3" />
        ) : (
            <ChevronUp className="size-3" />
        );
    };
    const renderSortableHead = (
        key: SortKey,
        label: string,
        options?: {
            headClassName?: string;
            buttonClassName?: string;
        },
    ) => (
        <TableHead
            className={cn(
                "uppercase text-xxs text-muted-foreground",
                options?.headClassName,
            )}
        >
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => toggleSort(key)}
                className={cn(SORT_BUTTON_CLASS, options?.buttonClassName)}
            >
                {label} {renderSortIcon(key)}
            </Button>
        </TableHead>
    );

    if (aggregatedTokens.length === 0) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                No assets found.
            </div>
        );
    }

    return (
        <div className="overflow-hidden">
            {hasLockedOrEarning && (
                <div
                    className={cn(
                        "grid",
                        visibleViews.length === 2
                            ? "grid-cols-2"
                            : "grid-cols-3",
                    )}
                >
                    {visibleViews.map(([id, label, value]) => (
                        <Button
                            type="button"
                            variant="ghost"
                            key={id}
                            onClick={() => setActiveView(id)}
                            className={cn(
                                "h-auto rounded-none text-left border-r border-border/70 border-b-2 border-b-transparent justify-start items-start flex-col hover:bg-transparent",
                                activeView === id && "border-b-foreground",
                            )}
                        >
                            <p
                                className={cn(
                                    "text-xs",
                                    activeView === id
                                        ? "text-foreground"
                                        : "text-muted-foreground",
                                )}
                            >
                                {label}
                            </p>
                            <p
                                className={cn(
                                    "text-lg leading-[1.1] font-medium",
                                    activeView === id
                                        ? "text-foreground"
                                        : "text-muted-foreground",
                                )}
                            >
                                {formatCurrency(value)}
                            </p>
                        </Button>
                    ))}
                </div>
            )}

            <Table>
                <TableHeader className="bg-transparent border-t-0">
                    <TableRow className="hover:bg-transparent">
                        {renderSortableHead("token", "Token", {
                            headClassName: "pl-4",
                            buttonClassName: SORT_BUTTON_LEFT_CLASS,
                        })}
                        {view === "available" && (
                            <>
                                {renderSortableHead("balance", "Balance", {
                                    headClassName: "text-right",
                                    buttonClassName: "ml-auto",
                                })}
                                {renderSortableHead("price", "Coin Price", {
                                    headClassName: "text-right",
                                    buttonClassName: "ml-auto",
                                })}
                                {renderSortableHead("weight", "Weight", {
                                    headClassName: "text-right",
                                    buttonClassName: "ml-auto",
                                })}
                            </>
                        )}
                        {view === "locked" && (
                            <>
                                {renderSortableHead("locked", "Locked", {
                                    headClassName: "text-right",
                                    buttonClassName: "ml-auto",
                                })}
                                {renderSortableHead("unlocked", "Unlocked", {
                                    headClassName: "text-right",
                                    buttonClassName: "ml-auto",
                                })}
                                {renderSortableHead("price", "Coin Price", {
                                    headClassName: "text-right",
                                    buttonClassName: "ml-auto",
                                })}
                                {renderSortableHead(
                                    "totalAllocated",
                                    "Total Allocated",
                                    {
                                        headClassName: "text-right",
                                        buttonClassName: "ml-auto",
                                    },
                                )}
                            </>
                        )}
                        {view === "earning" && (
                            <>
                                {renderSortableHead(
                                    "earningTotal",
                                    "Total Balance",
                                    {
                                        headClassName: "text-right",
                                        buttonClassName: "ml-auto",
                                    },
                                )}
                                {renderSortableHead("price", "Coin Price", {
                                    headClassName: "text-right",
                                    buttonClassName: "ml-auto",
                                })}
                                {renderSortableHead(
                                    "withdrawable",
                                    "Available To Withdraw",
                                    {
                                        headClassName: "text-right",
                                        buttonClassName: "ml-auto",
                                    },
                                )}
                            </>
                        )}
                        <TableHead className="w-10" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {viewAssets.map(({ asset, weight }) => {
                        const isExpanded = !!expanded[asset.id];
                        const primaryDecimals =
                            asset.networks[0]?.decimals ?? DEFAULT_DECIMALS;
                        const availableNetworks = asset.networks.filter(
                            (n) =>
                                n.residency !== "Staked" &&
                                networkAvailableRawForAvailableView(n).gt(0),
                        );
                        const lockedNetworks = asset.networks.filter((n) => {
                            if (n.residency === "Staked") return false;
                            return (
                                networkLockedRaw(n).gt(0) ||
                                (n.residency === "Lockup" &&
                                    networkAvailableRaw(n).gt(0))
                            );
                        });
                        const ftLockupInstanceCount = lockedNetworks.filter(
                            (n) => !!n.lockupInstanceId,
                        ).length;
                        const earningNetworks = asset.networks.filter(
                            (n) =>
                                ((n.residency === "Staked" &&
                                    n.balance.type === "Staked" &&
                                    n.balance.staking.pools.some((pool) =>
                                        pool.stakedBalance.gt(0),
                                    )) ||
                                    (n.balance.type === "Vested" &&
                                        n.balance.lockup.staked.gt(0))) &&
                                networkEarningRaw(n).gt(0),
                        );
                        const earningFromLockedRaw = lockedNetworks.reduce(
                            (sum, n) =>
                                n.balance.type === "Vested"
                                    ? sum.add(n.balance.lockup.staked)
                                    : sum,
                            Big(0),
                        );
                        const allocatedLockedRaw = lockedNetworks.reduce(
                            (sum, n) =>
                                sum.add(
                                    networkLockedRaw(n).add(
                                        networkAvailableRaw(n),
                                    ),
                                ),
                            Big(0),
                        );
                        const hasLockedEarningNotice =
                            view === "locked" && earningFromLockedRaw.gt(0);
                        const isFullLockedInEarning =
                            allocatedLockedRaw.gt(0) &&
                            earningFromLockedRaw.gte(allocatedLockedRaw);

                        const availableRaw = availableNetworks.reduce(
                            (sum, n) =>
                                sum.add(networkAvailableRawForAvailableView(n)),
                            Big(0),
                        );
                        const availableUsd = availableNetworks.reduce(
                            (sum, n) =>
                                sum +
                                toUsd(
                                    networkAvailableRawForAvailableView(n),
                                    n.decimals,
                                    n.price,
                                ),
                            0,
                        );

                        const lockedRaw = lockedNetworks.reduce(
                            (sum, n) => sum.add(networkLockedRaw(n)),
                            Big(0),
                        );
                        const unlockedRaw = lockedNetworks.reduce(
                            (sum, n) => sum.add(networkAvailableRaw(n)),
                            Big(0),
                        );
                        const totalAllocatedRaw = lockedRaw.add(unlockedRaw);
                        const lockedUsd = lockedNetworks.reduce(
                            (sum, n) =>
                                sum +
                                toUsd(networkLockedRaw(n), n.decimals, n.price),
                            0,
                        );
                        const unlockedUsd = lockedNetworks.reduce(
                            (sum, n) =>
                                sum +
                                toUsd(
                                    networkAvailableRaw(n),
                                    n.decimals,
                                    n.price,
                                ),
                            0,
                        );
                        const totalAllocatedUsd = lockedUsd + unlockedUsd;

                        const earningRaw = earningNetworks.reduce(
                            (sum, n) => sum.add(networkEarningRaw(n)),
                            Big(0),
                        );
                        const earningWithdrawRaw = earningNetworks.reduce(
                            (sum, n) =>
                                n.balance.type === "Vested"
                                    ? sum.add(
                                          n.balance.lockup.canWithdraw
                                              ? n.balance.lockup.unstakedBalance
                                              : Big(0),
                                      )
                                    : sum.add(availableBalance(n.balance)),
                            Big(0),
                        );
                        const earningUsd = earningNetworks.reduce(
                            (sum, n) =>
                                sum +
                                toUsd(
                                    networkEarningRaw(n),
                                    n.decimals,
                                    n.price,
                                ),
                            0,
                        );
                        const earningWithdrawUsd = earningNetworks.reduce(
                            (sum, n) =>
                                sum +
                                toUsd(
                                    n.balance.type === "Vested"
                                        ? n.balance.lockup.canWithdraw
                                            ? n.balance.lockup.unstakedBalance
                                            : Big(0)
                                        : availableBalance(n.balance),
                                    n.decimals,
                                    n.price,
                                ),
                            0,
                        );

                        return (
                            <Fragment key={asset.id}>
                                <TableRow
                                    className="cursor-pointer"
                                    onClick={() =>
                                        setExpanded((prev) => ({
                                            ...prev,
                                            [asset.id]: !prev[asset.id],
                                        }))
                                    }
                                >
                                    <TableCell className="p-4 pl-4">
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={asset.icon}
                                                alt={asset.name}
                                                className="h-10 w-10 rounded-full"
                                            />
                                            <div>
                                                <p className="font-semibold">
                                                    {asset.id}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {asset.name}
                                                </p>
                                            </div>
                                        </div>
                                    </TableCell>

                                    {view === "available" && (
                                        <>
                                            <TableCell className="p-4 text-right">
                                                <BalanceCell
                                                    balance={displayAmount(
                                                        availableRaw,
                                                        primaryDecimals,
                                                    )}
                                                    symbol={asset.id}
                                                    balanceUSD={availableUsd}
                                                />
                                            </TableCell>
                                            <TableCell className="p-4 text-right font-medium">
                                                {formatCurrency(asset.price)}
                                            </TableCell>
                                            <TableCell className="p-4 text-right">
                                                <div className="flex items-center justify-end gap-3">
                                                    <span className="font-medium w-14 text-right">
                                                        {weight.toFixed(2)}%
                                                    </span>
                                                    <div className="w-24 bg-muted rounded-full h-2 overflow-hidden">
                                                        <div
                                                            className="bg-foreground h-full rounded-full"
                                                            style={{
                                                                width: `${weight}%`,
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </>
                                    )}

                                    {view === "locked" && (
                                        <>
                                            <TableCell className="p-4 text-right">
                                                <BalanceCell
                                                    balance={displayAmount(
                                                        lockedRaw,
                                                        primaryDecimals,
                                                    )}
                                                    symbol={asset.id}
                                                    balanceUSD={lockedUsd}
                                                />
                                            </TableCell>
                                            <TableCell className="p-4 text-right">
                                                <BalanceCell
                                                    balance={displayAmount(
                                                        unlockedRaw,
                                                        primaryDecimals,
                                                    )}
                                                    symbol={asset.id}
                                                    balanceUSD={unlockedUsd}
                                                />
                                            </TableCell>
                                            <TableCell className="p-4 text-right font-medium">
                                                {formatCurrency(asset.price)}
                                            </TableCell>
                                            <TableCell className="p-4 text-right">
                                                <BalanceCell
                                                    balance={displayAmount(
                                                        totalAllocatedRaw,
                                                        primaryDecimals,
                                                    )}
                                                    symbol={asset.id}
                                                    balanceUSD={
                                                        totalAllocatedUsd
                                                    }
                                                />
                                            </TableCell>
                                        </>
                                    )}

                                    {view === "earning" && (
                                        <>
                                            <TableCell className="p-4 text-right">
                                                <BalanceCell
                                                    balance={displayAmount(
                                                        earningRaw,
                                                        primaryDecimals,
                                                    )}
                                                    symbol={asset.id}
                                                    balanceUSD={earningUsd}
                                                />
                                            </TableCell>
                                            <TableCell className="p-4 text-right font-medium">
                                                {formatCurrency(asset.price)}
                                            </TableCell>
                                            <TableCell className="p-4 text-right">
                                                <BalanceCell
                                                    balance={displayAmount(
                                                        earningWithdrawRaw,
                                                        primaryDecimals,
                                                    )}
                                                    symbol={asset.id}
                                                    balanceUSD={
                                                        earningWithdrawUsd
                                                    }
                                                />
                                            </TableCell>
                                        </>
                                    )}

                                    <TableCell className="p-4 text-right">
                                        {isExpanded ? (
                                            <ChevronDown className="size-4 text-primary ml-auto" />
                                        ) : (
                                            <ChevronRight className="size-4 text-primary ml-auto" />
                                        )}
                                    </TableCell>
                                </TableRow>

                                {isExpanded &&
                                    view === "available" &&
                                    availableNetworks.length > 0 && (
                                        <AvailableExpandedRows
                                            asset={asset}
                                            availableNetworks={
                                                availableNetworks
                                            }
                                            treasuryId={treasuryId ?? null}
                                            onNavigate={(href) =>
                                                router.push(href)
                                            }
                                        />
                                    )}

                                {isExpanded &&
                                    view === "locked" &&
                                    lockedNetworks.length > 0 && (
                                        <LockedExpandedRows
                                            asset={asset}
                                            lockedNetworks={lockedNetworks}
                                            ftLockupInstanceCount={
                                                ftLockupInstanceCount
                                            }
                                            onSelectLockup={(network) => {
                                                setSelectedLockupNetwork(
                                                    network,
                                                );
                                                setIsLockupModalOpen(true);
                                            }}
                                        />
                                    )}

                                {isExpanded &&
                                    view === "earning" &&
                                    earningNetworks.length > 0 && (
                                        <EarningExpandedRows
                                            asset={asset}
                                            earningNetworks={earningNetworks}
                                            onSelectPool={(network, poolId) => {
                                                setSelectedStakingNetwork(
                                                    network,
                                                );
                                                setSelectedPoolId(poolId);
                                                setIsStakingModalOpen(true);
                                            }}
                                        />
                                    )}

                                {hasLockedEarningNotice && (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell className="p-0" colSpan={6}>
                                            <div className="mb-3 mt-2 flex items-center gap-2 rounded-lg bg-muted/60 px-4 py-2 text-xs">
                                                <Info className="size-4 shrink-0" />
                                                <p className="text-foreground">
                                                    {isFullLockedInEarning
                                                        ? "Your full allocated balance"
                                                        : "Part of your allocated balance"}{" "}
                                                    (
                                                    {formatSmartAmount(
                                                        displayAmount(
                                                            earningFromLockedRaw,
                                                            primaryDecimals,
                                                        ),
                                                    )}{" "}
                                                    {asset.id}) is currently
                                                    earning.
                                                    {isFullLockedInEarning &&
                                                        " It will appear here once you stop earning."}{" "}
                                                    <button
                                                        type="button"
                                                        className="underline underline-offset-2"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setActiveView(
                                                                "earning",
                                                            );
                                                        }}
                                                    >
                                                        {isFullLockedInEarning
                                                            ? "See in Earning tab"
                                                            : "See in Earning"}
                                                    </button>
                                                </p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </Fragment>
                        );
                    })}
                </TableBody>
            </Table>
            <EarningPoolDetailsModal
                isOpen={isStakingModalOpen}
                onClose={() => {
                    setIsStakingModalOpen(false);
                    setSelectedStakingNetwork(null);
                    setSelectedPoolId(null);
                }}
                asset={selectedStakingNetwork}
                poolId={selectedPoolId}
            />
            <LockupDetailsModal
                isOpen={isLockupModalOpen}
                onClose={() => {
                    setIsLockupModalOpen(false);
                    setSelectedLockupNetwork(null);
                }}
                asset={selectedLockupNetwork}
                treasuryId={treasuryId ?? null}
            />
        </div>
    );
}

export function AssetsTableSkeleton() {
    return (
        <Table>
            <TableHeader className="bg-transparent border-t-0">
                <TableRow className="hover:bg-transparent">
                    <TableHead className="text-muted-foreground pl-4">
                        <Skeleton className="h-4 w-12" />
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                        <Skeleton className="h-4 w-16 ml-auto" />
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                        <Skeleton className="h-4 w-16 ml-auto" />
                    </TableHead>
                    <TableHead className="text-right text-muted-foreground">
                        <Skeleton className="h-4 w-16 ml-auto" />
                    </TableHead>
                    <TableHead />
                </TableRow>
            </TableHeader>
            <TableBody>
                {[0, 1, 2, 3].map((idx) => (
                    <TableRow key={`skeleton-row-${idx}`}>
                        <TableCell className="p-4 pl-4">
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-10 w-10 rounded-full" />
                                <div>
                                    <Skeleton className="h-4 w-16 mb-1" />
                                    <Skeleton className="h-3 w-24" />
                                </div>
                            </div>
                        </TableCell>
                        <TableCell className="p-4">
                            <Skeleton className="h-4 w-20 ml-auto" />
                        </TableCell>
                        <TableCell className="p-4">
                            <Skeleton className="h-4 w-20 ml-auto" />
                        </TableCell>
                        <TableCell className="p-4">
                            <Skeleton className="h-4 w-20 ml-auto" />
                        </TableCell>
                        <TableCell className="p-4">
                            <Skeleton className="h-4 w-4 ml-auto" />
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

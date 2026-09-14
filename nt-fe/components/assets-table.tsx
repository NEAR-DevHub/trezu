"use client";
import {
    ArrowDataTransferVerticalIcon,
    ArrowDown01Icon,
    ArrowUp01Icon,
} from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { AssetRowActionMenu } from "@/components/asset-row-action-menu";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { MobileAssetActionSheet } from "@/components/mobile-shell/mobile-asset-action-sheet";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/table";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { AggregatedAsset } from "@/hooks/use-assets";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useTreasury } from "@/hooks/use-treasury";
import { decimalFromBaseUnits } from "@/lib/amount-format";
import { buildAssetRowActionHrefs } from "@/lib/asset-row-actions";
import { availableBalance } from "@/lib/balance";
import Big from "@/lib/big";
import { cn, formatCurrencyWithSubCent, formatSmartAmount } from "@/lib/utils";
import { BalanceCell } from "./token-display";
import { TokenIconImage } from "./token-icon-image";

type SortDirection = "asc" | "desc";
type NetworkAsset = AggregatedAsset["networks"][number];
type SortKey = "token" | "balance" | "price" | "weight";

interface Props {
    aggregatedTokens: AggregatedAsset[];
}

interface AssetMetrics {
    availableUsd: number;
    hasAvailable: boolean;
}

const SORT_BUTTON_CLASS =
    "inline-flex h-auto items-center gap-1.5 px-0! py-0! text-sm/5 font-semibold text-gray-500 hover:bg-transparent hover:text-gray-900 dark:text-gray-400 dark:hover:bg-transparent dark:hover:text-white";

/**
 * Column geometry from the design, shared by the header and the rows so the
 * populated table, the skeleton and the empty state always line up.
 */
const COLUMN_CLASS = {
    asset: "w-[62%] overflow-hidden pr-3 pl-4 sm:w-[28.5%] sm:pl-6",
    balance: "w-[38%] text-right sm:w-[18.5%]",
    price: "hidden w-[21%] text-right sm:table-cell",
    // Widest cell — percent plus its bar — so it takes whatever is left.
    weight: "hidden pr-6 text-right sm:table-cell",
    actions: "hidden w-14 sm:table-cell sm:w-18",
} as const;

/** 40px header row, `paragraph small/semibold` in the secondary foreground. */
const HEAD_CLASS =
    "h-10 px-3 py-2 font-semibold text-gray-500 text-sm/5 normal-case dark:text-gray-400";

/** Rounds the row block into an inset card, like the near.com vaults table. */
const TABLE_CARD_FILL_CLASS = [
    // Paint on cells, not tbody — a tbody fill is square and bleeds over
    // the rounded card border at the top corners.
    "[&>tr>td]:bg-white dark:[&>tr>td]:bg-gray-850",
    "[&>tr:first-child>td:first-child]:rounded-tl-lg",
    "max-sm:[&>tr:first-child>td:nth-child(2)]:rounded-tr-lg sm:[&>tr:first-child>td:last-child]:rounded-tr-lg",
    "[&>tr:last-child>td:first-child]:rounded-bl-lg",
    "max-sm:[&>tr:last-child>td:nth-child(2)]:rounded-br-lg sm:[&>tr:last-child>td:last-child]:rounded-br-lg",
].join(" ");

/** Hairline between rows; the empty state leaves it out. */
const TABLE_ROW_DIVIDER_CLASS =
    "[&>tr+tr>td]:border-t [&>tr+tr>td]:border-gray-200 dark:[&>tr+tr>td]:border-white/5";

const TABLE_CARD_CLASS = [
    TABLE_CARD_FILL_CLASS,
    "[&>tr>td]:border-gray-200 dark:[&>tr>td]:border-white/5",
    "[&>tr>td:first-child]:border-l",
    // Price/weight/chevron cells are `hidden` below `sm`, so they stay
    // :last-child in the DOM. On mobile the visible last column is Balance.
    "max-sm:[&>tr>td:nth-child(2)]:border-r sm:[&>tr>td:last-child]:border-r",
    "[&>tr:first-child>td]:border-t [&>tr:last-child>td]:border-b",
].join(" ");

function toUsd(rawAmount: Big.Big, decimals: number, price: number): number {
    if (price <= 0) return 0;
    return rawAmount.div(Big(10).pow(decimals)).mul(price).toNumber();
}

function networkAvailableRaw(asset: NetworkAsset): Big.Big {
    if (asset.residency === "Staked" || asset.residency === "Lockup") {
        return Big(0);
    }
    return availableBalance(asset.balance);
}

function getAssetMetrics(asset: AggregatedAsset): AssetMetrics {
    let availableUsd = 0;
    let hasAvailable = false;

    for (const network of asset.networks) {
        const availableRaw = networkAvailableRaw(network);
        availableUsd += toUsd(availableRaw, network.decimals, network.price);
        hasAvailable = hasAvailable || availableRaw.gt(0);
    }

    return {
        availableUsd,
        hasAvailable,
    };
}

function displayAmount(rawAmount: Big.Big, decimals: number): Big.Big {
    return decimalFromBaseUnits(rawAmount, decimals);
}

function sumTokenAmountsByNetwork(
    networks: NetworkAsset[],
    getRawAmount: (network: NetworkAsset) => Big.Big,
): Big.Big {
    return networks.reduce(
        (sum, network) =>
            sum.add(displayAmount(getRawAmount(network), network.decimals)),
        Big(0),
    );
}

interface BaseAssetViewProps {
    asset: AggregatedAsset;
}

interface AvailableViewProps extends BaseAssetViewProps {
    availableAmount: Big.Big;
    availableUsd: number;
    weight: number;
}

function AvailableView({
    asset,
    availableAmount,
    availableUsd,
    weight,
}: AvailableViewProps): ReactNode {
    return (
        <>
            <TableCell className="px-3 py-3 text-right">
                <BalanceCell
                    balance={availableAmount}
                    symbol={asset.id}
                    balanceUSD={availableUsd}
                    amountFirst
                    hideSymbol
                    size="md"
                />
            </TableCell>
            <TableCell className="hidden px-3 py-3 text-right font-semibold text-base/5 text-gray-900 sm:table-cell dark:text-white">
                {formatCurrencyWithSubCent(asset.price)}
            </TableCell>
            <TableCell className="hidden px-3 py-3 text-right sm:table-cell sm:pr-6">
                <div className="flex items-center justify-end gap-3">
                    <span className="shrink-0 text-right font-semibold text-base/5 text-gray-900 tabular-nums dark:text-white">
                        {weight.toFixed(2)}%
                    </span>
                    {/* The design's column is narrow, so the bar — not the
                        percentage — gives way when the table is squeezed. */}
                    <div className="h-2 w-18 min-w-6 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                            className="h-full rounded-full bg-gray-900 transition-all dark:bg-white"
                            style={{ width: `${weight}%` }}
                        />
                    </div>
                </div>
            </TableCell>
        </>
    );
}

export function AssetsTable({ aggregatedTokens }: Props) {
    const t = useTranslations("assetsTable");
    const { treasuryId } = useTreasury();
    const isMobile = useMediaQuery("(max-width: 1023px)");
    const [mobileAction, setMobileAction] = useState<{
        asset: AggregatedAsset;
        sendHref: string;
        swapHref: string;
        availableAmount: string;
    } | null>(null);
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

    const viewAssets = useMemo(() => {
        const filtered = aggregatedTokens.filter((asset) => {
            const metrics = metricsById.get(asset.id);
            return metrics?.hasAvailable ?? false;
        });

        const totalUsd = filtered.reduce((sum, asset) => {
            const metrics = metricsById.get(asset.id);
            return metrics ? sum + metrics.availableUsd : sum;
        }, 0);

        return filtered
            .map((asset) => {
                const metrics = metricsById.get(asset.id);
                if (!metrics) {
                    return {
                        asset,
                        weight: 0,
                        sortValues: {
                            token: asset.id.toLowerCase(),
                            balance: 0,
                            price: asset.price,
                            weight: 0,
                        },
                    };
                }
                const weight =
                    totalUsd > 0 ? (metrics.availableUsd / totalUsd) * 100 : 0;
                return {
                    asset,
                    weight,
                    sortValues: {
                        token: asset.id.toLowerCase(),
                        balance: metrics.availableUsd,
                        price: asset.price,
                        weight,
                    },
                };
            })
            .sort((a, b) => {
                const key = sortState.key;
                const dir = sortState.dir === "asc" ? 1 : -1;
                if (key === "token") {
                    return (
                        a.sortValues.token.localeCompare(b.sortValues.token) *
                        dir
                    );
                }
                return (a.sortValues[key] - b.sortValues[key]) * dir;
            });
    }, [aggregatedTokens, metricsById, sortState]);

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
        if (sortState.key !== key)
            return <Icon icon={ArrowDataTransferVerticalIcon} />;
        return sortState.dir === "desc" ? (
            <Icon icon={ArrowDown01Icon} />
        ) : (
            <Icon icon={ArrowUp01Icon} />
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
        <TableHead className={cn(HEAD_CLASS, options?.headClassName)}>
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
                {t("noAssetsFound")}
            </div>
        );
    }

    return (
        <div className="overflow-hidden">
            <div className="px-1 pb-1">
                <Table className="min-w-full table-fixed border-separate border-spacing-0">
                    <TableHeader className="border-0 bg-transparent [&_tr]:border-0">
                        <TableRow className="border-0 hover:bg-transparent">
                            {renderSortableHead("token", t("columnAsset"), {
                                headClassName: COLUMN_CLASS.asset,
                                buttonClassName: "justify-start",
                            })}
                            {renderSortableHead("balance", t("balance"), {
                                headClassName: COLUMN_CLASS.balance,
                                buttonClassName: "ml-auto",
                            })}
                            {renderSortableHead("price", t("columnPrice"), {
                                headClassName: COLUMN_CLASS.price,
                                buttonClassName: "ml-auto",
                            })}
                            {renderSortableHead("weight", t("weight"), {
                                headClassName: COLUMN_CLASS.weight,
                                buttonClassName: "ml-auto",
                            })}
                            <TableHead
                                className={cn("p-0", COLUMN_CLASS.actions)}
                            />
                        </TableRow>
                    </TableHeader>
                    <TableBody
                        className={cn(
                            TABLE_CARD_CLASS,
                            TABLE_ROW_DIVIDER_CLASS,
                        )}
                    >
                        {viewAssets.map(({ asset, weight }) => {
                            const availableNetworks = asset.networks.filter(
                                (n) => networkAvailableRaw(n).gt(0),
                            );
                            const availableAmount = sumTokenAmountsByNetwork(
                                availableNetworks,
                                networkAvailableRaw,
                            );
                            const availableUsd = availableNetworks.reduce(
                                (sum, n) =>
                                    sum +
                                    toUsd(
                                        networkAvailableRaw(n),
                                        n.decimals,
                                        n.price,
                                    ),
                                0,
                            );

                            const actions = treasuryId
                                ? buildAssetRowActionHrefs(treasuryId, asset)
                                : null;

                            const row = (
                                <TableRow
                                    key={asset.id}
                                    className={cn(
                                        "border-0 hover:bg-transparent hover:[&>td]:bg-gray-50 dark:hover:[&>td]:bg-white/3",
                                        actions && "cursor-pointer",
                                    )}
                                    data-testid={`asset-row-${asset.id}`}
                                    onClick={
                                        isMobile && actions
                                            ? () =>
                                                  setMobileAction({
                                                      asset,
                                                      sendHref:
                                                          actions.sendHref,
                                                      swapHref:
                                                          actions.swapHref,
                                                      availableAmount:
                                                          formatSmartAmount(
                                                              availableAmount,
                                                          ),
                                                  })
                                            : undefined
                                    }
                                >
                                    <TableCell className="overflow-hidden py-3 pr-3 pl-4 sm:pl-6">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <TokenIconImage
                                                icon={asset.icon}
                                                alt={asset.name}
                                                className="size-9"
                                            />
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-base/5 text-gray-900 dark:text-white">
                                                    {asset.id}
                                                </p>
                                                <p className="truncate font-medium text-gray-500 text-sm/5 dark:text-gray-400">
                                                    {asset.name}
                                                </p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <AvailableView
                                        asset={asset}
                                        availableAmount={availableAmount}
                                        availableUsd={availableUsd}
                                        weight={weight}
                                    />
                                    <TableCell className="hidden py-3 pr-4 pl-2 sm:table-cell sm:pr-6">
                                        {actions ? (
                                            <Icon
                                                icon={ArrowDown01Icon}
                                                className="ml-auto size-4 text-gray-400 dark:text-gray-500"
                                                aria-hidden
                                            />
                                        ) : null}
                                    </TableCell>
                                </TableRow>
                            );

                            if (!actions) {
                                return row;
                            }

                            if (isMobile) {
                                return row;
                            }

                            return (
                                <Popover key={asset.id}>
                                    <PopoverTrigger asChild>
                                        {row}
                                    </PopoverTrigger>
                                    <AssetRowActionMenu
                                        sendHref={actions.sendHref}
                                        swapHref={actions.swapHref}
                                    />
                                </Popover>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
            <MobileAssetActionSheet
                asset={mobileAction?.asset ?? null}
                sendHref={mobileAction?.sendHref ?? ""}
                swapHref={mobileAction?.swapHref ?? ""}
                availableAmount={mobileAction?.availableAmount ?? ""}
                open={!!mobileAction}
                onOpenChange={(open) => {
                    if (!open) setMobileAction(null);
                }}
            />
        </div>
    );
}

/**
 * Behind the empty state the rows stay inside the white card — only their
 * placeholders fade out downwards, so the card's border keeps its full weight.
 */
const EMPTY_ROW_FADE = [
    "**:data-[slot=skeleton]:opacity-100",
    "**:data-[slot=skeleton]:opacity-45",
    "**:data-[slot=skeleton]:opacity-15",
];

const SKELETON_ROWS = ["a", "b", "c"];

export function AssetsTableSkeleton({
    overlay,
}: {
    overlay?: React.ReactNode;
}) {
    const t = useTranslations("assetsTable");

    return (
        <div className="relative">
            <Table className="min-w-full table-fixed border-separate border-spacing-0">
                <TableHeader className="border-0 bg-transparent [&_tr]:border-0">
                    <TableRow className="border-0 hover:bg-transparent">
                        <TableHead
                            className={cn(HEAD_CLASS, COLUMN_CLASS.asset)}
                        >
                            {t("columnAsset")}
                        </TableHead>
                        <TableHead
                            className={cn(HEAD_CLASS, COLUMN_CLASS.balance)}
                        >
                            {t("balance")}
                        </TableHead>
                        <TableHead
                            className={cn(HEAD_CLASS, COLUMN_CLASS.price)}
                        >
                            {t("columnPrice")}
                        </TableHead>
                        <TableHead
                            className={cn(HEAD_CLASS, COLUMN_CLASS.weight)}
                        >
                            {t("weight")}
                        </TableHead>
                        <TableHead
                            className={cn("p-0", COLUMN_CLASS.actions)}
                        />
                    </TableRow>
                </TableHeader>
                <TableBody
                    className={cn(
                        TABLE_CARD_CLASS,
                        !overlay && TABLE_ROW_DIVIDER_CLASS,
                    )}
                >
                    {SKELETON_ROWS.map((row, idx) => (
                        <TableRow
                            key={row}
                            className={cn(
                                "border-0 hover:bg-transparent",
                                overlay && [
                                    "**:data-[slot=skeleton]:animate-none",
                                    EMPTY_ROW_FADE[idx],
                                ],
                            )}
                        >
                            <TableCell className="overflow-hidden py-3 pr-3 pl-4 sm:pl-6">
                                <div className="flex min-w-0 items-center gap-3">
                                    <Skeleton className="size-9 shrink-0 rounded-full" />
                                    <div className="flex min-w-0 flex-col gap-1.5">
                                        <Skeleton className="h-3.5 w-14 rounded-full" />
                                        <Skeleton className="h-3 w-20 rounded-full" />
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="px-3 py-3 text-right">
                                <div className="ml-auto flex flex-col items-end gap-1.5">
                                    <Skeleton className="h-3.5 w-16 rounded-full" />
                                    <Skeleton className="h-3 w-24 rounded-full" />
                                </div>
                            </TableCell>
                            <TableCell className="hidden px-3 py-3 sm:table-cell">
                                <Skeleton className="ml-auto h-3.5 w-20 rounded-full" />
                            </TableCell>
                            <TableCell className="hidden px-3 py-3 sm:table-cell sm:pr-6">
                                <Skeleton className="ml-auto h-3.5 w-20 rounded-full" />
                            </TableCell>
                            <TableCell className="hidden py-3 pr-4 pl-2 sm:table-cell sm:pr-6">
                                <Skeleton className="ml-auto size-8 shrink-0 rounded-full" />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {overlay ? (
                <div className="pointer-events-none absolute inset-x-0 top-10 bottom-0 flex items-center justify-center px-6">
                    <div className="pointer-events-auto">{overlay}</div>
                </div>
            ) : null}
        </div>
    );
}

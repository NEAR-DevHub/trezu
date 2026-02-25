"use client";

import type { RecentActivity } from "@/lib/api";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/table";
import {
    ArrowDownToLine,
    ArrowUpToLine,
    ArrowRightLeft,
    ArrowRight,
} from "lucide-react";
import { Pagination } from "@/components/pagination";
import { useTreasury } from "@/hooks/use-treasury";
import { FormattedDate } from "@/components/formatted-date";
import { TableSkeleton } from "@/components/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { Clock } from "lucide-react";
import { cn, formatActivityAmount, formatSmartAmount } from "@/lib/utils";
import { TokenAmountDisplay } from "@/components/token-display";
import { TransactionHashCell } from "./transaction-hash-cell";
import {
    getActivityLabel,
    getFromAccount,
    getToAccount,
} from "../utils/history-utils";

interface ActivityTableProps {
    activities: RecentActivity[];
    isLoading: boolean;
    pageIndex: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
}

export function ActivityTable({
    activities,
    isLoading,
    pageIndex,
    pageSize,
    total,
    onPageChange,
}: ActivityTableProps) {
    const { treasuryId } = useTreasury();

    const totalPages = Math.ceil(total / pageSize);

    const getTypeLabel = (activity: RecentActivity) => {
        return getActivityLabel({
            ...activity,
            tokenSymbol: activity.tokenMetadata?.symbol,
        });
    };

    if (isLoading) {
        return <TableSkeleton rows={pageSize} columns={5} />;
    }

    if (activities.length === 0) {
        return (
            <EmptyState
                icon={Clock}
                title="No transactions found"
                description="Your transactions will appear here once they happen"
            />
        );
    }

    return (
        <>
            <div className="space-y-4">
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-[120px] pl-6 text-xs font-medium uppercase text-muted-foreground">
                                    TYPE
                                </TableHead>
                                <TableHead className="min-w-[180px] text-xs font-medium uppercase text-muted-foreground">
                                    TRANSACTION
                                </TableHead>
                                <TableHead className="min-w-[150px] text-xs font-medium uppercase text-muted-foreground">
                                    FROM
                                </TableHead>
                                <TableHead className="min-w-[150px] text-xs font-medium uppercase text-muted-foreground">
                                    TO
                                </TableHead>
                                <TableHead className="text-right pr-6 min-w-[120px] text-xs font-medium uppercase text-muted-foreground">
                                    TRANSACTION
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {activities.map((activity) => {
                                const isSwap = !!activity.swap;
                                const isReceived =
                                    parseFloat(activity.amount) > 0;
                                const typeLabel = getTypeLabel(activity);

                                return (
                                    <TableRow key={activity.id}>
                                        <TableCell className="pl-6">
                                            <div className="flex items-center gap-3">
                                                <div
                                                    className={cn(
                                                        "flex h-10 w-10 items-center justify-center rounded-full shrink-0",
                                                        isSwap
                                                            ? "bg-blue-500/10"
                                                            : isReceived
                                                              ? "bg-general-success-background-faded"
                                                              : "bg-general-destructive-background-faded",
                                                    )}
                                                >
                                                    {isSwap ? (
                                                        <ArrowRightLeft className="h-5 w-5 text-blue-500" />
                                                    ) : isReceived ? (
                                                        <ArrowDownToLine className="h-5 w-5 text-general-success-foreground" />
                                                    ) : (
                                                        <ArrowUpToLine className="h-5 w-5 text-general-destructive-foreground" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-0.5 min-w-0">
                                                    <span className="text-sm font-medium truncate">
                                                        {typeLabel}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground whitespace-normal wrap-break-word md:whitespace-nowrap">
                                                        <FormattedDate
                                                            date={
                                                                new Date(
                                                                    activity.blockTime,
                                                                )
                                                            }
                                                            includeTime
                                                        />
                                                    </span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="min-w-[180px]">
                                            {isSwap && activity.swap && activity.swap.swapRole === "deposit" ? (
                                                <div className="flex items-center gap-1.5">
                                                    {activity.swap.sentAmount &&
                                                    activity.swap
                                                        .sentTokenMetadata ? (
                                                        <span className="font-semibold text-general-destructive-foreground whitespace-nowrap">
                                                            {formatSmartAmount(
                                                                activity.swap
                                                                    .sentAmount,
                                                            )}{" "}
                                                            {
                                                                activity.swap
                                                                    .sentTokenMetadata
                                                                    .symbol
                                                            }
                                                        </span>
                                                    ) : (
                                                        <span className="font-semibold text-muted-foreground">
                                                            ?
                                                        </span>
                                                    )}
                                                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                    <span className="font-semibold text-muted-foreground whitespace-nowrap">
                                                        {
                                                            activity.swap
                                                                .receivedTokenMetadata
                                                                .symbol
                                                        }
                                                    </span>
                                                </div>
                                            ) : isSwap && activity.swap && activity.swap.swapRole === "fulfillment" ? (
                                                <div className="flex items-center gap-1.5">
                                                    {activity.swap.sentTokenMetadata ? (
                                                        <span className="font-semibold text-muted-foreground whitespace-nowrap">
                                                            {activity.swap.sentTokenMetadata.symbol}
                                                        </span>
                                                    ) : null}
                                                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                    <span className="font-semibold text-general-success-foreground whitespace-nowrap">
                                                        {formatSmartAmount(
                                                            activity.swap
                                                                .receivedAmount,
                                                        )}{" "}
                                                        {
                                                            activity.swap
                                                                .receivedTokenMetadata
                                                                .symbol
                                                        }
                                                    </span>
                                                </div>
                                            ) : (
                                                <TokenAmountDisplay
                                                    icon={
                                                        activity.tokenMetadata
                                                            .icon
                                                    }
                                                    symbol={
                                                        activity.tokenMetadata
                                                            .symbol
                                                    }
                                                    amount={formatActivityAmount(
                                                        activity.amount,
                                                    )}
                                                    className={
                                                        isReceived
                                                            ? "text-general-success-foreground"
                                                            : "text-foreground"
                                                    }
                                                />
                                            )}
                                        </TableCell>
                                        <TableCell className="min-w-[150px] max-w-[200px]">
                                            <span className="text-sm truncate block">
                                                {getFromAccount(
                                                    activity,
                                                    isReceived,
                                                )}
                                            </span>
                                        </TableCell>
                                        <TableCell className="min-w-[150px] max-w-[200px]">
                                            <span className="text-sm truncate block">
                                                {getToAccount(
                                                    activity,
                                                    isReceived,
                                                    treasuryId,
                                                )}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <TransactionHashCell
                                                transactionHashes={
                                                    activity.transactionHashes
                                                }
                                                receiptIds={activity.receiptIds}
                                            />
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="pb-4">
                        <Pagination
                            pageIndex={pageIndex}
                            totalPages={totalPages}
                            onPageChange={onPageChange}
                        />
                    </div>
                )}
            </div>
        </>
    );
}

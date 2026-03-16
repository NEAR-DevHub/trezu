"use client";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { ChevronRight } from "lucide-react";
import type { RecentActivity } from "@/lib/api";
import { FormattedDate } from "@/components/formatted-date";
import { CopyButton } from "@/components/copy-button";
import { useReceiptSearch } from "@/hooks/use-receipt-search";
import { InfoDisplay, InfoItem } from "@/components/info-display";
import { AmountSummary } from "@/components/amount-summary";
import { Skeleton } from "@/components/ui/skeleton";
import { getActivityLabel } from "../utils/history-utils";
import { ExchangeSummaryCard } from "@/app/(treasury)/[treasuryId]/exchange/components/exchange-summary-card";
import { formatSmartAmount } from "@/lib/utils";
import { TransactionHashCell } from "./transaction-hash-cell";

interface TransactionDetailsModalProps {
    activity: RecentActivity | null;
    treasuryId: string;
    isOpen: boolean;
    onClose: () => void;
}

export function TransactionDetailsModal({
    activity,
    treasuryId,
    isOpen,
    onClose,
}: TransactionDetailsModalProps) {
    if (!activity) return null;

    const needsReceiptSearch = !activity.transactionHashes?.length;
    const { data: transactionFromReceipt, isLoading: isLoadingTransaction } =
        useReceiptSearch(
            needsReceiptSearch ? activity.receiptIds?.[0] : undefined,
        );

    const isReceived = parseFloat(activity.amount) > 0;
    const isSwap = !!activity.swap;
    const isFunctionCall = activity.actionKind === "FunctionCall";
    const transactionType = getActivityLabel({
        ...activity,
        tokenSymbol: activity.tokenMetadata?.symbol,
    });

    // Determine From/To based on receiver_id vs treasury account
    // For outgoing: don't show receiver (stored counterparty is often the contract)
    const knownCounterparty =
        activity.counterparty && activity.counterparty !== "UNKNOWN"
            ? activity.counterparty
            : null;
    const fromAccount = isSwap
        ? "via NEAR Intents"
        : isReceived
            ? knownCounterparty || activity.signerId || null
            : treasuryId;

    const toAccount = isSwap
        ? treasuryId
        : isReceived
            ? treasuryId
            : null;

    const formatAmount = (amount: string, decimals?: number) => {
        const num = parseFloat(amount);
        const sign = num >= 0 ? "+" : "-";
        const formatted = formatSmartAmount(Math.abs(num));
        return `${sign}${formatted}`;
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader className="border-b border-border">
                    <DialogTitle>Transaction Details</DialogTitle>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Transaction Summary */}
                    {isSwap && activity.swap ? (
                        <div className="relative flex justify-center items-center gap-4 w-full">
                            {/* From: Sent Token */}
                            {activity.swap.sentAmount &&
                                activity.swap.sentTokenMetadata ? (
                                <ExchangeSummaryCard
                                    title="Sell"
                                    token={{
                                        address: activity.swap.sentTokenMetadata.tokenId,
                                        symbol: activity.swap.sentTokenMetadata.symbol,
                                        decimals: activity.swap.sentTokenMetadata.decimals,
                                        name: activity.swap.sentTokenMetadata.name,
                                        icon: activity.swap.sentTokenMetadata.icon || "",
                                        network: activity.swap.sentTokenMetadata.network || "near",
                                        chainIcons: activity.swap.sentTokenMetadata.chainIcons,
                                    }}
                                    amount={formatSmartAmount(
                                        activity.swap.sentAmount,
                                    )}
                                />
                            ) : null}

                            {/* Arrow - absolutely positioned */}
                            <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
                                <div className="rounded-full bg-card border p-1.5 shadow-sm">
                                    <ChevronRight className="size-6 text-muted-foreground" />
                                </div>
                            </div>

                            {/* To: Received Token */}
                            <ExchangeSummaryCard
                                title="Receive"
                                token={{
                                    address: activity.swap.receivedTokenMetadata.tokenId,
                                    symbol: activity.swap.receivedTokenMetadata.symbol,
                                    decimals: activity.swap.receivedTokenMetadata.decimals,
                                    name: activity.swap.receivedTokenMetadata.name,
                                    icon: activity.swap.receivedTokenMetadata.icon || "",
                                    network: activity.swap.receivedTokenMetadata.network || "near",
                                    chainIcons: activity.swap.receivedTokenMetadata.chainIcons,
                                }}
                                amount={formatSmartAmount(
                                    activity.swap.receivedAmount,
                                )}
                            />
                        </div>
                    ) : (
                        <AmountSummary
                            title={transactionType}
                            total={formatAmount(activity.amount)}
                            token={{
                                address: activity.tokenMetadata.tokenId,
                                symbol: activity.tokenMetadata.symbol,
                                decimals: activity.tokenMetadata.decimals,
                                name: activity.tokenMetadata.name,
                                icon: activity.tokenMetadata.icon || "",
                                network:
                                    activity.tokenMetadata.network || "near",
                            }}
                        />
                    )}

                    {/* Transaction Details */}
                    <InfoDisplay
                        hideSeparator
                        items={[
                            {
                                label: "Type",
                                value: transactionType,
                            },
                            {
                                label: "Date",
                                value: (
                                    <FormattedDate
                                        date={new Date(activity.blockTime)}
                                        includeTime
                                    />
                                ),
                            },
                            ...(isSwap && activity.swap
                                ? [
                                    ...(activity.swap.sentAmount &&
                                        activity.swap.sentTokenMetadata
                                        ? [
                                            {
                                                label: "From",
                                                value: (
                                                    'Via NEAR Intents'
                                                ),
                                            } as InfoItem,
                                        ]
                                        : []),
                                    {
                                        label: "To",
                                        value: (
                                            <div className="flex items-center gap-1">
                                                <span className="max-w-[300px] truncate">
                                                    {treasuryId}
                                                </span>
                                                <CopyButton
                                                    text={
                                                        treasuryId
                                                    }
                                                    toastMessage="Address copied to clipboard"
                                                    tooltipContent="Copy Address"
                                                    variant="ghost"
                                                    size="icon-sm"
                                                />
                                            </div>
                                        ),
                                    } as InfoItem,
                                ]
                                : isFunctionCall && activity.methodName
                                    ? [
                                        {
                                            label: "Method",
                                            value: activity.methodName,
                                        } as InfoItem,
                                        {
                                            label: "Contract",
                                            value: (
                                                <div className="flex items-center gap-1">
                                                    <span className="max-w-[300px] truncate">
                                                        {activity.receiverId ||
                                                            activity.counterparty ||
                                                            "unknown"}
                                                    </span>
                                                    <CopyButton
                                                        text={
                                                            activity.receiverId ||
                                                            activity.counterparty ||
                                                            ""
                                                        }
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        tooltipContent="Copy Address"
                                                        toastMessage="Address copied to clipboard"
                                                    />
                                                </div>
                                            ),
                                        } as InfoItem,
                                    ]
                                    : [
                                        ...(fromAccount
                                            ? [
                                                {
                                                    label: "From",
                                                    value: (
                                                        <div className="flex items-center gap-1">
                                                            <span className="max-w-[300px] truncate">
                                                                {fromAccount}
                                                            </span>
                                                            <CopyButton
                                                                text={
                                                                    fromAccount
                                                                }
                                                                variant="ghost"
                                                                size="icon-sm"
                                                                tooltipContent="Copy Address"
                                                                toastMessage="Address copied to clipboard"
                                                            />
                                                        </div>
                                                    ),
                                                } as InfoItem,
                                            ]
                                            : []),
                                        ...(toAccount
                                            ? [
                                                {
                                                    label: "To",
                                                    value: (
                                                        <div className="flex items-center gap-1">
                                                            <span className="max-w-[300px] truncate">
                                                                {toAccount}
                                                            </span>
                                                            <CopyButton
                                                                text={
                                                                    toAccount
                                                                }
                                                                toastMessage="Address copied to clipboard"
                                                                tooltipContent="Copy Address"
                                                                variant="ghost"
                                                                size="icon-sm"
                                                            />
                                                        </div>
                                                    ),
                                                } as InfoItem,
                                            ]
                                            : []),
                                    ]),
                            ...(isLoadingTransaction
                                ? [
                                    {
                                        label: "Transaction",
                                        value: (
                                            <Skeleton className="h-5 w-[200px]" />
                                        ),
                                    } as InfoItem,
                                ]
                                : activity.transactionHashes?.length ||
                                    activity.receiptIds?.length
                                    ? [
                                        {
                                            label: "Transaction",
                                            value: (
                                                <TransactionHashCell
                                                    transactionHashes={activity.transactionHashes}
                                                    receiptIds={activity.receiptIds}
                                                    className="flex items-center gap-2"
                                                />
                                            ),
                                        } as InfoItem,
                                    ]
                                    : []),
                        ]}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

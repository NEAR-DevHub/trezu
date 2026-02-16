"use client";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { Button } from "@/components/button";
import { ExternalLink, ArrowRight } from "lucide-react";
import type { RecentActivity } from "@/lib/api";
import { FormattedDate } from "@/components/formatted-date";
import { CopyButton } from "@/components/copy-button";
import { useReceiptSearch } from "@/hooks/use-receipt-search";
import { InfoDisplay, InfoItem } from "@/components/info-display";
import { AmountSummary } from "@/components/amount-summary";
import { Skeleton } from "@/components/ui/skeleton";
import { TokenAmountDisplay } from "@/components/token-display";

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
    const transactionType = isSwap
        ? "Swap"
        : isReceived
            ? "Payment received"
            : "Payment sent";

    // Determine From/To based on receiver_id vs treasury account
    const fromAccount = isSwap
        ? "via NEAR Intents"
        : isReceived
            ? activity.counterparty || activity.signerId || "unknown"
            : treasuryId;

    const toAccount = isSwap
        ? treasuryId
        : isReceived
            ? treasuryId
            : activity.receiverId || activity.counterparty || "unknown";

    const formatAmount = (amount: string, decimals?: number) => {
        const num = parseFloat(amount);
        const absNum = Math.abs(num);
        const sign = num >= 0 ? "+" : "-";

        const decimalPlaces =
            absNum >= 1 ? 2 : Math.min(6, decimals || activity.tokenMetadata.decimals);

        return `${sign}${absNum.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: decimalPlaces,
        })}`;
    };

    const formatSwapAmount = (amount: string, decimals: number) => {
        const num = Math.abs(parseFloat(amount));
        const decimalPlaces = num >= 1 ? 2 : Math.min(6, decimals);
        return num.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: decimalPlaces,
        });
    };

    const transactionHash = activity.transactionHashes?.length
        ? activity.transactionHashes[0]
        : transactionFromReceipt?.[0]?.originatedFromTransactionHash;

    const openInExplorer = (hash: string) => {
        window.open(`https://nearblocks.io/txns/${hash}`, "_blank");
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
                        <div className="px-3.5 py-3 rounded-xl bg-muted">
                            <div className="flex flex-col gap-2 p-2 text-xs text-muted-foreground text-center justify-center items-center">
                                <p className="font-medium text-xs">Swap</p>
                                <div className="flex items-center justify-center w-full">
                                    {/* Sent Token */}
                                    {activity.swap.sentAmount && activity.swap.sentTokenMetadata ? (
                                        <div className="flex flex-col items-center gap-2 flex-1">
                                            <img
                                                src={activity.swap.sentTokenMetadata.icon || ""}
                                                alt={activity.swap.sentTokenMetadata.symbol}
                                                className="size-9 shrink-0 rounded-full"
                                            />
                                            <div className="flex flex-col gap-0.5">
                                                <p className="text-lg font-semibold text-general-destructive-foreground">
                                                    -{formatSwapAmount(
                                                        activity.swap.sentAmount,
                                                        activity.swap.sentTokenMetadata.decimals,
                                                    )}{" "}
                                                    <span className="text-muted-foreground font-medium text-xs">
                                                        {activity.swap.sentTokenMetadata.symbol}
                                                    </span>
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex-1">
                                            <span className="text-muted-foreground">?</span>
                                        </div>
                                    )}

                                    {/* Arrow */}
                                    <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />

                                    {/* Received Token */}
                                    <div className="flex flex-col items-center gap-2 flex-1">
                                        <img
                                            src={activity.swap.receivedTokenMetadata.icon || ""}
                                            alt={activity.swap.receivedTokenMetadata.symbol}
                                            className="size-9 shrink-0 rounded-full"
                                        />
                                        <div className="flex flex-col gap-0.5">
                                            <p className="text-lg font-semibold text-general-success-foreground">
                                                +{formatSwapAmount(
                                                    activity.swap.receivedAmount,
                                                    activity.swap.receivedTokenMetadata.decimals,
                                                )}{" "}
                                                <span className="text-muted-foreground font-medium text-xs">
                                                    {activity.swap.receivedTokenMetadata.symbol}
                                                </span>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
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
                                network: activity.tokenMetadata.network || "near",
                            }}
                        />
                    )}

                    {/* Transaction Details */}
                    <InfoDisplay
                        hideSeparator
                        items={[
                            {
                                label: "Type",
                                value: isSwap ? "Swap" : isReceived ? "Received" : "Sent",
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
                                    ...(activity.swap.sentAmount && activity.swap.sentTokenMetadata
                                        ? [
                                            {
                                                label: "Sent",
                                                value: (
                                                    <TokenAmountDisplay
                                                        icon={activity.swap.sentTokenMetadata.icon}
                                                        symbol={activity.swap.sentTokenMetadata.symbol}
                                                        amount={formatSwapAmount(
                                                            activity.swap.sentAmount,
                                                            activity.swap.sentTokenMetadata.decimals,
                                                        )}
                                                    />
                                                ),
                                            } as InfoItem,
                                        ]
                                        : []),
                                    {
                                        label: "Received",
                                        value: (
                                            <TokenAmountDisplay
                                                icon={activity.swap.receivedTokenMetadata.icon}
                                                symbol={activity.swap.receivedTokenMetadata.symbol}
                                                amount={formatSwapAmount(
                                                    activity.swap.receivedAmount,
                                                    activity.swap.receivedTokenMetadata.decimals,
                                                )}
                                            />
                                        ),
                                    } as InfoItem,
                                ]
                                : [
                                    {
                                        label: "From",
                                        value: (
                                            <div className="flex items-center gap-1">
                                                <span className="max-w-[300px] truncate">
                                                    {fromAccount}
                                                </span>
                                                <CopyButton
                                                    text={fromAccount}
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    tooltipContent="Copy Address"
                                                    toastMessage="Address copied to clipboard"
                                                />
                                            </div>
                                        ),
                                    } as InfoItem,
                                    {
                                        label: "To",
                                        value: (
                                            <div className="flex items-center gap-1">
                                                <span className="max-w-[300px] truncate">
                                                    {toAccount}
                                                </span>
                                                <CopyButton
                                                    text={toAccount}
                                                    toastMessage="Address copied to clipboard"
                                                    tooltipContent="Copy Address"
                                                    variant="ghost"
                                                    size="icon-sm"
                                                />
                                            </div>
                                        ),
                                    } as InfoItem,
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
                                : transactionHash
                                    ? [
                                        {
                                            label: "Transaction",
                                            value: (
                                                <div className="flex items-center">
                                                    <span className="font-mono max-w-[200px] truncate">
                                                        {transactionHash}
                                                    </span>

                                                    <Button
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        tooltipContent="Open Link in Explorer"
                                                        onClick={() =>
                                                            openInExplorer(
                                                                transactionHash,
                                                            )
                                                        }
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                    </Button>
                                                    <CopyButton
                                                        text={transactionHash}
                                                        toastMessage="Transaction hash copied to clipboard"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        tooltipContent="Copy Transaction Hash"
                                                    />
                                                </div>
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

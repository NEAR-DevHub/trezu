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
import { InfoDisplay, InfoItem } from "@/components/info-display";
import { AmountSummary } from "@/components/amount-summary";
import { User } from "@/components/user";
import {
    getActivityLabel,
    getFromAccount,
    getToAccount,
} from "../utils/history-utils";
import { ExchangeSummaryCard } from "@/app/(treasury)/[treasuryId]/exchange/components/exchange-summary-card";
import { formatSmartAmount } from "@/lib/utils";
import { TransactionHashCell } from "./transaction-hash-cell";

interface TransactionDetailsModalProps {
    activity: RecentActivity | null;
    treasuryId: string;
    isOpen: boolean;
    onClose: () => void;
}

function AccountValue({
    value,
    showCopy = true,
    useAddressBook = false,
}: {
    value: string;
    showCopy?: boolean;
    useAddressBook?: boolean;
}) {
    const canRenderUser =
        useAddressBook &&
        value !== "via NEAR Intents" &&
        value !== "—" &&
        value !== "unknown" &&
        value !== "UNKNOWN" &&
        !value.includes(" ");

    if (canRenderUser) {
        return <User accountId={value} useAddressBook withHoverCard={true} />;
    }

    return (
        <div className="flex items-center gap-1">
            <span className="max-w-[300px] truncate">{value}</span>
            {showCopy ? (
                <CopyButton
                    text={value}
                    variant="ghost"
                    size="icon-sm"
                    tooltipContent="Copy Address"
                    toastMessage="Address copied to clipboard"
                />
            ) : null}
        </div>
    );
}

export function TransactionDetailsModal({
    activity,
    treasuryId,
    isOpen,
    onClose,
}: TransactionDetailsModalProps) {
    if (!activity) return null;

    const isReceived = parseFloat(activity.amount) > 0;
    const isSwap = !!activity.swap;
    const isFunctionCall = activity.actionKind === "FunctionCall";
    const transactionType = getActivityLabel({
        ...activity,
        tokenSymbol: activity.tokenMetadata?.symbol,
    });

    const fromAccount = getFromAccount(activity, isReceived, treasuryId);
    const toAccount = getToAccount(activity, isReceived, treasuryId);

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
                                        address:
                                            activity.swap.sentTokenMetadata
                                                .tokenId,
                                        symbol: activity.swap.sentTokenMetadata
                                            .symbol,
                                        decimals:
                                            activity.swap.sentTokenMetadata
                                                .decimals,
                                        name: activity.swap.sentTokenMetadata
                                            .name,
                                        icon:
                                            activity.swap.sentTokenMetadata
                                                .icon || "",
                                        network:
                                            activity.swap.sentTokenMetadata
                                                .network || "near",
                                        chainIcons:
                                            activity.swap.sentTokenMetadata
                                                .chainIcons,
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
                                    address:
                                        activity.swap.receivedTokenMetadata
                                            .tokenId,
                                    symbol: activity.swap.receivedTokenMetadata
                                        .symbol,
                                    decimals:
                                        activity.swap.receivedTokenMetadata
                                            .decimals,
                                    name: activity.swap.receivedTokenMetadata
                                        .name,
                                    icon:
                                        activity.swap.receivedTokenMetadata
                                            .icon || "",
                                    network:
                                        activity.swap.receivedTokenMetadata
                                            .network || "near",
                                    chainIcons:
                                        activity.swap.receivedTokenMetadata
                                            .chainIcons,
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
                            showNetworkIcon
                            token={{
                                address: activity.tokenMetadata.tokenId,
                                symbol: activity.tokenMetadata.symbol,
                                decimals: activity.tokenMetadata.decimals,
                                name: activity.tokenMetadata.name,
                                icon: activity.tokenMetadata.icon || "",
                                network:
                                    activity.tokenMetadata.network || "near",
                                chainIcons: activity.tokenMetadata.chainIcons,
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
                                      {
                                          label: "From",
                                          value: (
                                              <AccountValue
                                                  value={fromAccount}
                                                  showCopy={false}
                                                  useAddressBook
                                              />
                                          ),
                                      } as InfoItem,
                                      {
                                          label: "To",
                                          value: (
                                              <AccountValue
                                                  value={toAccount}
                                                  useAddressBook
                                              />
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
                                                <AccountValue
                                                    value={
                                                        activity.receiverId ||
                                                        activity.counterparty ||
                                                        "unknown"
                                                    }
                                                    useAddressBook
                                                />
                                            ),
                                        } as InfoItem,
                                    ]
                                  : [
                                        {
                                            label: "From",
                                            value: (
                                                <AccountValue
                                                    value={fromAccount}
                                                    useAddressBook
                                                />
                                            ),
                                        } as InfoItem,
                                        {
                                            label: "To",
                                            value: (
                                                <AccountValue
                                                    value={toAccount}
                                                    useAddressBook
                                                />
                                            ),
                                        } as InfoItem,
                                    ]),
                            ...(activity.transactionHashes?.length ||
                            activity.receiptIds?.length
                                ? [
                                      {
                                          label: "Transaction",
                                          value: (
                                              <TransactionHashCell
                                                  transactionHashes={
                                                      activity.transactionHashes
                                                  }
                                                  receiptIds={
                                                      activity.receiptIds
                                                  }
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

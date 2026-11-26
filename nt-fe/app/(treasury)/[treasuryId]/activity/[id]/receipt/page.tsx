"use client";

import { redirect } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { use, useEffect, useRef } from "react";
import {
    ReceiptSenderSection,
    ReceiptTokenAmountRow,
} from "@/app/(treasury)/[treasuryId]/requests/[id]/receipt/components/receipt-shared";
import {
    AsyncNetwork,
    AsyncText,
    RECEIPT_CARD_CLASS,
    ReceiptLabelValueRow,
    ReceiptLayout,
    ReceiptPageShell,
    ReceiptPdfSkeletonCard,
    ReceiptSectionTitle,
} from "@/app/(treasury)/[treasuryId]/requests/[id]/receipt/components/receipt-sheet";
import {
    buildReceiveAmountModel,
    buildTokenReceiptInfo,
} from "@/app/(treasury)/[treasuryId]/requests/[id]/receipt/utils/receipt-models";
import { PageCard } from "@/components/card";
import { ConfidentialState } from "@/components/confidential-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
    getToAccount,
    hasReceiveReceipt,
    useGetFromAccount,
} from "@/features/activity/utils/history-utils";
import { StatusPill } from "@/features/proposals/components/proposal-status-pill";
import { useTokenPriceAtTimestamp } from "@/hooks/use-proposals";
import { useTreasury } from "@/hooks/use-treasury";
import { useRecentActivityRow, useToken } from "@/hooks/use-treasury-queries";
import { recordReceiptMetric } from "@/lib/proposals-api";
import { formatUserDate } from "@/lib/utils";

/** A receipt for a payment into the treasury that no request made. */
export default function ReceiveReceiptPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const tReceipt = useTranslations("receiptPage");
    const locale = useLocale();
    const { id } = use(params);
    const { treasuryId, isConfidential, isGuestTreasury } = useTreasury();
    const isHidden = isConfidential && isGuestTreasury;
    const { data: activity, isLoading } = useRecentActivityRow(
        isHidden ? null : treasuryId,
        Number(id),
    );
    const { data: token, isLoading: isLoadingToken } = useToken(
        activity?.tokenId,
    );
    const { data: historicalPrice, isLoading: isLoadingPrice } =
        useTokenPriceAtTimestamp(activity?.tokenId, activity?.blockTime);
    const getFromAccount = useGetFromAccount();
    const hasRecordedGeneratedRef = useRef(false);
    const isValidReceipt = !!activity && hasReceiveReceipt(activity);

    useEffect(() => {
        if (!treasuryId || !isValidReceipt || hasRecordedGeneratedRef.current) {
            return;
        }
        hasRecordedGeneratedRef.current = true;
        recordReceiptMetric(treasuryId, "generated");
    }, [treasuryId, isValidReceipt]);

    const receiptUrl =
        typeof window !== "undefined" ? window.location.href : "";
    const handlePrint = () => {
        if (treasuryId && !isHidden) {
            recordReceiptMetric(treasuryId, "print");
        }
        window.print();
    };

    if (isHidden) {
        return (
            <ReceiptPageShell
                receiptUrl={receiptUrl}
                showCopyLink={false}
                onPrint={handlePrint}
            >
                <PageCard className="bg-card p-8 rounded-none">
                    <ConfidentialState
                        skeleton={
                            <div className="space-y-3">
                                <Skeleton className="h-16 w-full" />
                                <Skeleton className="h-16 w-full" />
                                <Skeleton className="h-16 w-full" />
                            </div>
                        }
                    />
                </PageCard>
            </ReceiptPageShell>
        );
    }

    if (isLoading || !treasuryId) {
        return (
            <div className="min-h-dvh bg-muted p-4 print:bg-white">
                <div className="mx-auto w-full max-w-[700px]">
                    <ReceiptPdfSkeletonCard />
                </div>
            </div>
        );
    }

    if (!activity || !isValidReceipt) {
        redirect(`/${treasuryId}/dashboard/activity`);
    }

    const symbol = token?.symbol ?? activity.tokenMetadata?.symbol;
    const { amountDisplay, usdDisplay, rateLabel } = buildReceiveAmountModel({
        amount: activity.amount,
        unitPriceUsd: historicalPrice?.priceUsd,
        symbol,
        locale,
    });
    const tokenInfo = buildTokenReceiptInfo({
        token: token ?? (isLoadingToken ? null : activity.tokenMetadata),
        amount: amountDisplay,
        usdValue: usdDisplay,
        usdLoading: isLoadingPrice,
    });
    const receivedAt = new Date(activity.blockTime);

    return (
        <ReceiptPageShell
            receiptUrl={receiptUrl}
            showCopyLink={!isConfidential}
            onPrint={handlePrint}
        >
            <PageCard className={RECEIPT_CARD_CLASS}>
                <ReceiptLayout
                    title={tReceipt("paymentConfirmation")}
                    headingKey="receiveReceiptTitle"
                    receiptNumber={activity.id}
                    receiptDate={{ value: receivedAt, isLoading: false }}
                >
                    <ReceiptSenderSection
                        senderAddress={getFromAccount(
                            activity,
                            true,
                            treasuryId,
                            isConfidential,
                        )}
                    />

                    <section>
                        <ReceiptSectionTitle>
                            {tReceipt("recipient")}
                        </ReceiptSectionTitle>
                        <ReceiptLabelValueRow
                            label={tReceipt("address")}
                            value={getToAccount(
                                activity,
                                true,
                                treasuryId,
                                isConfidential,
                            )}
                            className="mt-2 border-b pb-3 pt-3"
                            valueClassName="break-all"
                        />
                    </section>

                    <section>
                        <ReceiptSectionTitle>
                            {tReceipt("transactionDetails")}
                        </ReceiptSectionTitle>
                        <div className="divide-y text-sm">
                            <ReceiptLabelValueRow
                                label={tReceipt("status")}
                                value={<StatusPill status="Executed" />}
                                className="py-3"
                            />
                            <ReceiptTokenAmountRow
                                label={tReceipt("amountWithToken", {
                                    token: symbol ?? "",
                                })}
                                metadata={tokenInfo.metadata}
                                amount={tokenInfo.amount}
                            />
                            <ReceiptLabelValueRow
                                label={tReceipt("amountUsd")}
                                value={<AsyncText value={tokenInfo.usd} />}
                                className="py-3"
                            />
                            <ReceiptLabelValueRow
                                label={tReceipt("network")}
                                value={
                                    <AsyncNetwork
                                        metadata={tokenInfo.metadata}
                                    />
                                }
                                className="py-3"
                            />
                            <ReceiptLabelValueRow
                                label={tReceipt("rate")}
                                value={
                                    <AsyncText
                                        value={{
                                            value: rateLabel,
                                            isLoading: isLoadingPrice,
                                        }}
                                    />
                                }
                                className="py-3"
                            />
                            <ReceiptLabelValueRow
                                label={tReceipt("dateAndTime")}
                                value={formatUserDate(receivedAt, {
                                    timezone: "UTC",
                                    includeTime: true,
                                    includeTimezone: true,
                                    timeFormat: "12",
                                })}
                                className="py-3"
                            />
                        </div>
                    </section>
                </ReceiptLayout>
            </PageCard>
        </ReceiptPageShell>
    );
}

import { useTranslations } from "next-intl";
import { useBatchPayment, useToken } from "@/hooks/use-treasury-queries";
import { useBulkPaymentTransactionHash } from "@/hooks/use-bulk-payment-transactions";
import { useIntentsWithdrawalFee } from "@/hooks/use-intents-withdrawal-fee";
import { BatchPaymentRequestData } from "../../types/index";
import { InfoDisplay, InfoItem } from "@/components/info-display";
import { Amount } from "../amount";
import { BatchPayment, PaymentStatus } from "@/lib/api";
import { Button } from "@/components/button";
import { useState } from "react";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ArrowUpRight, ChevronDown, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { Address } from "@/components/address";
import { User } from "@/components/user";
import Link from "next/link";
import { StatusPill } from "../proposal-status-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Proposal } from "@/lib/proposals-api";
import { getProposalStatus } from "../../utils/proposal-utils";
import { Policy } from "@/types/policy";
import Big from "@/lib/big";

interface PaymentDisplayProps {
    number: number;
    payment: BatchPayment;
    expanded: boolean;
    onExpandedClick: () => void;
    tokenId: string;
    batchId: string;
}

const paymentStatusToText = (status: PaymentStatus): "Pending" | "Paid" => {
    if (typeof status === "string") {
        return status;
    }
    return Object.keys(status)[0] as "Pending" | "Paid";
};

function PaymentDisplay({
    number,
    payment,
    expanded,
    onExpandedClick,
    tokenId,
    batchId,
}: PaymentDisplayProps) {
    const t = useTranslations("proposals.expanded");
    const status = paymentStatusToText(payment.status);
    const isPaid = status === "Paid";
    const { data: txData } = useBulkPaymentTransactionHash(
        isPaid ? batchId : null,
        isPaid ? payment.recipient : null,
    );
    const transactionHash = txData?.transactionHash;

    // Get token metadata to determine blockchain network for recipient address
    const { data: tokenData } = useToken(tokenId);
    const chainName = tokenData?.network || "near";

    // Transaction links are always NEAR (nearblocks)
    const nearBlocksUrl = transactionHash
        ? `https://nearblocks.io/txns/${transactionHash}`
        : null;

    let items: InfoItem[] = [
        {
            label: t("recipient"),
            value: (
                <User
                    useAddressBook
                    withName={chainName === "near"}
                    accountId={payment.recipient}
                    chainName={chainName}
                />
            ),
        },
        {
            label: t("amount"),
            value: (
                <Amount
                    amount={payment.amount.toString()}
                    showNetwork
                    tokenId={tokenId}
                />
            ),
        },
    ];

    if (status !== "Pending") {
        items.push({
            label: t("status"),
            value: <StatusPill status={status} />,
        });
    }

    if (isPaid && nearBlocksUrl && nearBlocksUrl.length > 0) {
        items.push({
            label: t("transactionLink"),
            value: (
                <Link
                    className="flex items-center gap-2"
                    href={nearBlocksUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {t("viewTransaction")} <ArrowUpRight className="size-4" />
                </Link>
            ),
        });
    }

    return (
        <Collapsible open={expanded} onOpenChange={onExpandedClick}>
            <CollapsibleTrigger
                className={cn(
                    "w-full flex justify-between items-center p-3 border rounded-lg",
                    expanded && "rounded-b-none",
                )}
            >
                <div className="flex gap-2 items-center">
                    <ChevronDown
                        className={cn("w-4 h-4", expanded && "rotate-180")}
                    />
                    {t("recipientNumber", { number })}
                </div>
                <div className="hidden md:flex gap-3 items-baseline text-sm text-muted-foreground">
                    <Address address={payment.recipient} />
                    <Amount
                        amount={payment.amount.toString()}
                        textOnly
                        showNetwork
                        tokenId={tokenId}
                        showUSDValue={false}
                    />
                </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <InfoDisplay
                    style="secondary"
                    className="p-3 rounded-b-lg"
                    items={items}
                />
            </CollapsibleContent>
        </Collapsible>
    );
}

interface BatchPaymentExpandedViewProps {
    /** Resolved token id (e.g. `near` or contract id). */
    tokenId: string;
    /** Total amount across all recipients in smallest units. */
    totalAmount: string;
    /** Notes — rendered below the table when present. */
    notes?: string;
    /** Per-recipient rows. */
    payments: BatchPayment[];
    /**
     * Optional batch id used by the public flow's per-row transaction-hash
     * lookup. Confidential bulk passes `null` (no on-chain hash to link).
     */
    batchId?: string | null;
    /**
     * Pre-computed total network fee in smallest units. Confidential bulk
     * passes the sum of `(amountIn - minAmountOut)` from each recipient's
     * stored 1Click quote — the actual fee the DAO already committed to.
     * When provided, skips the live SDK estimate.
     */
    totalNetworkFeeOverride?: string | null;
}

/**
 * Pure renderer shared by public and confidential bulk-payment expanded views.
 * Public wrapper feeds it via `useBatchPayment`; confidential wrapper feeds
 * it via `confidential_metadata.bulk.recipients`.
 */
export function BatchPaymentExpandedView({
    tokenId,
    totalAmount,
    notes,
    payments,
    batchId,
    totalNetworkFeeOverride,
}: BatchPaymentExpandedViewProps) {
    const t = useTranslations("proposals.expanded");
    const tIntents = useTranslations("intentsQuote");
    const [expanded, setExpanded] = useState<number[]>([]);

    const { data: tokenData } = useToken(tokenId);

    const representativeRecipient = payments[0]?.recipient;
    const skipLiveFee = totalNetworkFeeOverride != null;
    const {
        data: dynamicFeeData,
        isError: hasFeeError,
        isIntentsCrossChainToken,
    } = useIntentsWithdrawalFee({
        token:
            !skipLiveFee && tokenData
                ? {
                      address: tokenId,
                      network: tokenData.network || "near",
                      decimals: tokenData.decimals,
                  }
                : null,
        destinationAddress: skipLiveFee ? undefined : representativeRecipient,
    });

    const hasLiveFeeData =
        !skipLiveFee &&
        isIntentsCrossChainToken &&
        !hasFeeError &&
        !!dynamicFeeData?.networkFee;
    // Confidential bulk passes a pre-summed override (smallest units, decoded
    // to the token's display scale here). Public bulk falls back to the live
    // SDK estimate × recipient count.
    const totalNetworkFee = skipLiveFee
        ? Big(totalNetworkFeeOverride).gt(0)
            ? Big(totalNetworkFeeOverride).div(
                  Big(10).pow(tokenData?.decimals ?? 0),
              )
            : null
        : hasLiveFeeData
          ? Big(dynamicFeeData.networkFee).mul(payments.length)
          : null;

    const onExpandedChanged = (index: number) => {
        setExpanded((prev) =>
            prev.includes(index)
                ? prev.filter((id) => id !== index)
                : [...prev, index],
        );
    };

    const isAllExpanded = expanded.length === payments.length;
    const toggleAllExpanded = () => {
        if (isAllExpanded) setExpanded([]);
        else setExpanded(payments.map((_, index) => index));
    };

    const items: InfoItem[] = [
        {
            label: t("totalAmount"),
            value: (
                <Amount showNetwork amount={totalAmount} tokenId={tokenId} />
            ),
        },
        ...(totalNetworkFee
            ? [
                  {
                      label: t("networkFee"),
                      info: tIntents("networkFeeTooltip"),
                      value: `${totalNetworkFee.toString()} ${tokenData?.symbol || ""}`.trim(),
                  } satisfies InfoItem,
              ]
            : []),
        {
            label: t("recipients"),
            value: (
                <div className="flex gap-3 items-baseline">
                    <p className="text-sm font-medium">
                        {t("recipientsCount", { count: payments.length })}
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleAllExpanded}
                    >
                        {isAllExpanded ? t("collapseAll") : t("expandAll")}
                    </Button>
                </div>
            ),
            afterValue: (
                <div className="flex flex-col gap-1">
                    {payments.map((payment, index) => (
                        <PaymentDisplay
                            tokenId={tokenId}
                            number={index + 1}
                            key={index}
                            payment={payment}
                            expanded={expanded.includes(index)}
                            onExpandedClick={() => onExpandedChanged(index)}
                            batchId={batchId ?? ""}
                        />
                    ))}
                </div>
            ),
        },
    ];

    return (
        <>
            <InfoDisplay items={items} />
            {notes && notes !== "" && (
                <div className="flex justify-between gap-2 p-3 pt-0 mt-[-10px]">
                    <p className="text-sm text-muted-foreground">
                        {t("notes")}
                    </p>
                    <p className="text-sm font-medium">{notes}</p>
                </div>
            )}
        </>
    );
}

interface BatchPaymentRequestExpandedProps {
    data: BatchPaymentRequestData;
    proposal: Proposal;
}

export function BatchPaymentRequestExpanded({
    data,
    proposal,
}: BatchPaymentRequestExpandedProps) {
    const t = useTranslations("proposals.expanded");

    const proposalStatus = getProposalStatus(proposal, {} as Policy);
    const isExecuted = proposalStatus === "Executed";

    const {
        data: batchData,
        isLoading,
        isError,
    } = useBatchPayment(data.batchId);

    const hasPendingPayments = batchData?.payments?.some(
        (payment) => paymentStatusToText(payment.status) === "Pending",
    );

    const shouldAutoRefetch = isExecuted && hasPendingPayments;
    const { data: liveBatchData } = useBatchPayment(
        data.batchId,
        shouldAutoRefetch ? 5000 : false,
    );
    const activeBatchData = shouldAutoRefetch ? liveBatchData : batchData;

    if (isLoading) {
        return (
            <div className="space-y-6 py-4">
                <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-6 w-48" />
                </div>
                <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-6 w-32" />
                    <div className="flex flex-col gap-2 mt-4">
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                    </div>
                </div>
            </div>
        );
    }

    if (isError || !activeBatchData) {
        return (
            <EmptyState
                icon={SearchX}
                title={t("oopsTitle")}
                description={t("oopsDescription")}
            />
        );
    }

    let tokenId = data.tokenId;
    if (activeBatchData.tokenId?.toLowerCase() === "native") {
        tokenId = "near";
    }

    return (
        <BatchPaymentExpandedView
            tokenId={tokenId}
            totalAmount={data.totalAmount}
            notes={data.notes}
            payments={activeBatchData.payments}
            batchId={data.batchId}
        />
    );
}

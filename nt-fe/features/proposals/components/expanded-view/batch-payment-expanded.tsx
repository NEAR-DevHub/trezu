import { useTranslations } from "next-intl";
import { useBatchPayment, useToken } from "@/hooks/use-treasury-queries";
import { useBulkPaymentTransactionHash } from "@/hooks/use-bulk-payment-transactions";
import { useIntentsWithdrawalFee } from "@/hooks/use-intents-withdrawal-fee";
import {
    BatchPaymentRequestData,
    ConfidentialBulkPaymentData,
} from "../../types/index";
import { InfoDisplay, InfoItem } from "@/components/info-display";
import { Amount } from "../amount";
import { BatchPayment, PaymentStatus } from "@/lib/api";
import { Button } from "@/components/button";
import { useMemo, useState } from "react";
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

type BatchPaymentStatusLabel = "Pending" | "Paid";

const paymentStatusToText = (
    status: PaymentStatus,
): BatchPaymentStatusLabel => {
    if (typeof status === "string") {
        return status;
    }
    return Object.keys(status)[0] as BatchPaymentStatusLabel;
};

interface PaymentDisplayProps {
    number: number;
    recipient: string;
    amount: string;
    tokenId: string;
    expanded: boolean;
    onExpandedClick: () => void;
    status?: BatchPaymentStatusLabel;
    transactionHash?: string | null;
}

function PaymentDisplay({
    number,
    recipient,
    amount,
    tokenId,
    expanded,
    onExpandedClick,
    status,
    transactionHash,
}: PaymentDisplayProps) {
    const t = useTranslations("proposals.expanded");
    const { data: tokenData } = useToken(tokenId);
    const chainName = tokenData?.network || "near";
    const nearBlocksUrl = transactionHash
        ? `https://nearblocks.io/txns/${transactionHash}`
        : null;

    const items: InfoItem[] = [
        {
            label: t("recipient"),
            value: (
                <User
                    useAddressBook
                    withName={chainName === "near"}
                    accountId={recipient}
                    chainName={chainName}
                />
            ),
        },
        {
            label: t("amount"),
            value: <Amount amount={amount} showNetwork tokenId={tokenId} />,
        },
    ];

    if (status && status !== "Pending") {
        items.push({
            label: t("status"),
            value: <StatusPill status={status} />,
        });
    }

    if (nearBlocksUrl) {
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
                    <Address address={recipient} />
                    <Amount
                        amount={amount}
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

/**
 * Wraps an on-chain `BatchPayment` row with the per-payment tx-hash hook,
 * isolating the hook call per iteration.
 */
function OnChainPaymentDisplay({
    number,
    payment,
    tokenId,
    batchId,
    expanded,
    onExpandedClick,
}: {
    number: number;
    payment: BatchPayment;
    tokenId: string;
    batchId: string;
    expanded: boolean;
    onExpandedClick: () => void;
}) {
    const status = paymentStatusToText(payment.status);
    const isPaid = status === "Paid";
    const { data: txData } = useBulkPaymentTransactionHash(
        isPaid ? batchId : null,
        isPaid ? payment.recipient : null,
    );
    return (
        <PaymentDisplay
            number={number}
            recipient={payment.recipient}
            amount={payment.amount.toString()}
            tokenId={tokenId}
            expanded={expanded}
            onExpandedClick={onExpandedClick}
            status={status}
            transactionHash={txData?.transactionHash ?? null}
        />
    );
}

interface BatchPaymentViewProps {
    totalAmount: string;
    tokenId: string;
    recipientsCount: number;
    notes?: string;
    extraInfoItems?: InfoItem[];
    /** Caller supplies one fully-rendered row per recipient so it can bind
     * its own per-row hooks (e.g. on-chain tx-hash lookup). */
    renderRows: (ctx: {
        expanded: number[];
        toggle: (index: number) => void;
    }) => React.ReactNode;
}

/**
 * Generalized presentational shell for a bulk-payment proposal. Takes a
 * totalAmount + recipient count + a `renderRows` callback. Used by both the
 * on-chain bulk (`ContractBatchPaymentExpanded`) and confidential-intents
 * bulk (`IntentsBatchPaymentExpanded`).
 */
function BatchPaymentView({
    totalAmount,
    tokenId,
    recipientsCount,
    notes,
    extraInfoItems = [],
    renderRows,
}: BatchPaymentViewProps) {
    const t = useTranslations("proposals.expanded");
    const [expanded, setExpanded] = useState<number[]>([]);

    const toggle = (index: number) =>
        setExpanded((prev) =>
            prev.includes(index)
                ? prev.filter((i) => i !== index)
                : [...prev, index],
        );
    const isAllExpanded = expanded.length === recipientsCount;
    const toggleAll = () =>
        setExpanded(
            isAllExpanded
                ? []
                : Array.from({ length: recipientsCount }, (_, i) => i),
        );

    const items: InfoItem[] = [
        {
            label: t("totalAmount"),
            value: (
                <Amount showNetwork amount={totalAmount} tokenId={tokenId} />
            ),
        },
        ...extraInfoItems,
        {
            label: t("recipients"),
            value: (
                <div className="flex gap-3 items-baseline">
                    <p className="text-sm font-medium">
                        {t("recipientsCount", { count: recipientsCount })}
                    </p>
                    <Button variant="ghost" size="sm" onClick={toggleAll}>
                        {isAllExpanded ? t("collapseAll") : t("expandAll")}
                    </Button>
                </div>
            ),
            afterValue: (
                <div className="flex flex-col gap-1">
                    {renderRows({ expanded, toggle })}
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

interface ContractBatchPaymentExpandedProps {
    data: BatchPaymentRequestData;
    proposal: Proposal;
}

/**
 * On-chain bulk payment (`bulkpayment.near`). Hydrates per-payment status +
 * settlement tx from the contract and renders via `BatchPaymentView`.
 */
export function ContractBatchPaymentExpanded({
    data,
    proposal,
}: ContractBatchPaymentExpandedProps) {
    const t = useTranslations("proposals.expanded");
    const tIntents = useTranslations("intentsQuote");

    const proposalStatus = getProposalStatus(proposal, {} as Policy);
    const isExecuted = proposalStatus === "Executed";

    const {
        data: batchData,
        isLoading,
        isError,
    } = useBatchPayment(data.batchId);
    const hasPendingPayments = batchData?.payments?.some(
        (p) => paymentStatusToText(p.status) === "Pending",
    );
    const shouldAutoRefetch = isExecuted && hasPendingPayments;
    const { data: liveBatchData } = useBatchPayment(
        data.batchId,
        shouldAutoRefetch ? 5000 : false,
    );
    const activeBatchData = shouldAutoRefetch ? liveBatchData : batchData;

    let tokenId = data.tokenId;
    if (activeBatchData?.tokenId?.toLowerCase() === "native") {
        tokenId = "near";
    }
    const { data: tokenData } = useToken(tokenId);

    const representativeRecipient = activeBatchData?.payments[0]?.recipient;
    const {
        data: dynamicFeeData,
        isError: hasFeeError,
        isIntentsCrossChainToken,
    } = useIntentsWithdrawalFee({
        token: tokenData
            ? {
                  address: tokenId,
                  network: tokenData.network || "near",
                  decimals: tokenData.decimals,
              }
            : null,
        destinationAddress: representativeRecipient,
    });

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

    const hasFeeData =
        isIntentsCrossChainToken &&
        !hasFeeError &&
        !!dynamicFeeData?.networkFee;
    const totalNetworkFee = hasFeeData
        ? Big(dynamicFeeData.networkFee).mul(activeBatchData.payments.length)
        : null;
    const extraInfoItems: InfoItem[] =
        hasFeeData && totalNetworkFee
            ? [
                  {
                      label: t("networkFee"),
                      info: tIntents("networkFeeTooltip"),
                      value: `${totalNetworkFee.toString()} ${tokenData?.symbol || ""}`.trim(),
                  },
              ]
            : [];

    return (
        <BatchPaymentView
            totalAmount={data.totalAmount}
            tokenId={tokenId}
            recipientsCount={activeBatchData.payments.length}
            notes={data.notes}
            extraInfoItems={extraInfoItems}
            renderRows={({ expanded, toggle }) =>
                activeBatchData.payments.map((payment, i) => (
                    <OnChainPaymentDisplay
                        key={`${payment.recipient}-${i}`}
                        number={i + 1}
                        payment={payment}
                        tokenId={tokenId}
                        batchId={data.batchId}
                        expanded={expanded.includes(i)}
                        onExpandedClick={() => toggle(i)}
                    />
                ))
            }
        />
    );
}

// Backwards-compat alias — the expanded-view switch imports this name.
export const BatchPaymentRequestExpanded = ContractBatchPaymentExpanded;

interface IntentsBatchPaymentExpandedProps {
    data: ConfidentialBulkPaymentData;
}

/**
 * Confidential (1Click intents) bulk payment. The single signed NEP-413
 * message carries all transfers atomically — no per-row chain lookup.
 */
export function IntentsBatchPaymentExpanded({
    data,
}: IntentsBatchPaymentExpandedProps) {
    const tokenId = data.recipients[0]?.tokenId ?? "";
    const totalAmount = useMemo(
        () =>
            data.recipients
                .reduce((sum, r) => sum.add(Big(r.amount || "0")), Big(0))
                .toString(),
        [data.recipients],
    );

    return (
        <BatchPaymentView
            totalAmount={totalAmount}
            tokenId={tokenId}
            recipientsCount={data.recipients.length}
            notes={data.notes}
            renderRows={({ expanded, toggle }) =>
                data.recipients.map((r, i) => (
                    <PaymentDisplay
                        key={`${r.receiver}-${i}`}
                        number={i + 1}
                        recipient={r.receiver}
                        amount={r.amount}
                        tokenId={r.tokenId || tokenId}
                        expanded={expanded.includes(i)}
                        onExpandedClick={() => toggle(i)}
                    />
                ))
            }
        />
    );
}

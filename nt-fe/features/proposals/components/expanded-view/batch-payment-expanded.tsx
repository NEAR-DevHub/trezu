import { useBatchPayment, useToken } from "@/hooks/use-treasury-queries";
import { useBulkPaymentTransactionHash } from "@/hooks/use-bulk-payment-transactions";
import { BatchPaymentRequestData } from "../../types/index";
import { InfoDisplay, InfoItem } from "@/components/info-display";
import { Amount } from "../amount";
import { BatchPayment, BatchPaymentResponse, PaymentStatus } from "@/lib/api";
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
    const status = paymentStatusToText(payment.status);
    const isPaid = status === "Paid";
    const { data: txData } = useBulkPaymentTransactionHash(
        isPaid ? batchId : null,
        isPaid ? payment.recipient : null,
    );
    const transactionHash = txData?.transactionHash;
    const nearBlocksUrl = transactionHash
        ? `https://nearblocks.io/txns/${transactionHash}`
        : null;

    // Get token metadata to check network
    const { data: tokenData } = useToken(tokenId);
    const isNearNetwork = tokenData?.network?.toLowerCase() === "near";

    let items: InfoItem[] = [
        {
            label: "Recipient",
            value: (
                <User
                    accountId={payment.recipient}
                    withLink={isNearNetwork}
                    withName={isNearNetwork}
                />
            ),
        },
        {
            label: "Amount",
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
            label: "Status",
            value: <StatusPill status={status} />,
        });
    }

    if (isPaid && nearBlocksUrl && nearBlocksUrl.length > 0) {
        items.push({
            label: "Transaction Link",
            value: (
                <Link
                    className="flex items-center gap-2"
                    href={nearBlocksUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    View Transaction <ArrowUpRight className="size-4" />
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
                    Recipient {number}
                </div>
                <div className="flex gap-3 items-baseline text-sm text-muted-foreground">
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

interface BatchPaymentRequestExpandedProps {
    data: BatchPaymentRequestData;
    proposal: Proposal;
}

export function BatchPaymentRequestExpanded({
    data,
    proposal,
}: BatchPaymentRequestExpandedProps) {
    const [expanded, setExpanded] = useState<number[]>([]);

    // Check if we should auto-refetch
    // Only refetch if proposal is Executed
    const proposalStatus = getProposalStatus(proposal, {} as Policy);
    const isExecuted = proposalStatus === "Executed";

    // First fetch to check if there are pending payments
    const {
        data: batchData,
        isLoading,
        isError,
    } = useBatchPayment(data.batchId);

    // Determine if we should auto-refetch based on pending payments
    const hasPendingPayments = batchData?.payments?.some(
        (payment) => paymentStatusToText(payment.status) === "Pending",
    );

    // Second fetch with refetch interval if needed
    const shouldAutoRefetch = isExecuted && hasPendingPayments;
    const { data: liveBatchData } = useBatchPayment(
        data.batchId,
        shouldAutoRefetch ? 5000 : false, // 5 seconds when conditions are met
    );

    // Use live data if auto-refetching, otherwise use initial data
    const activeBatchData = shouldAutoRefetch ? liveBatchData : batchData;

    // Loading state
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

    // Error state
    if (isError || !activeBatchData) {
        return (
            <EmptyState
                icon={SearchX}
                title="Oops! Something went wrong"
                description="We couldn't find any data to show here."
            />
        );
    }

    let tokenId = data.tokenId;
    if (activeBatchData?.tokenId?.toLowerCase() === "native") {
        tokenId = "near";
    }

    const onExpandedChanged = (index: number) => {
        setExpanded((prev) => {
            if (prev.includes(index)) {
                return prev.filter((id) => id !== index);
            }
            return [...prev, index];
        });
    };

    const isAllExpanded = expanded.length === activeBatchData.payments.length;
    const toggleAllExpanded = () => {
        if (isAllExpanded) {
            setExpanded([]);
        } else {
            setExpanded(activeBatchData.payments.map((_, index) => index));
        }
    };

    const items: InfoItem[] = [
        {
            label: "Total Amount",
            value: (
                <Amount
                    showNetwork
                    amount={data.totalAmount}
                    tokenId={tokenId}
                />
            ),
        },
        {
            label: "Recipients",
            value: (
                <div className="flex gap-3 items-baseline">
                    <p className="text-sm font-medium">
                        {activeBatchData.payments.length} recipient
                        {activeBatchData.payments.length > 1 ? "s" : ""}
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleAllExpanded}
                    >
                        {isAllExpanded ? "Collapse all" : "Expand all"}
                    </Button>
                </div>
            ),
            afterValue: (
                <div className="flex flex-col gap-1">
                    {activeBatchData.payments.map((payment, index) => (
                        <PaymentDisplay
                            tokenId={tokenId}
                            number={index + 1}
                            key={index}
                            payment={payment}
                            expanded={expanded.includes(index)}
                            onExpandedClick={() => onExpandedChanged(index)}
                            batchId={data.batchId}
                        />
                    ))}
                </div>
            ),
        },
    ];

    return (
        <>
            <InfoDisplay items={items} />
            {data.notes && data.notes !== "" && (
                <div className="flex justify-between gap-2 p-3 pt-0 mt-[-10px]">
                    <p className="text-sm text-muted-foreground">Notes</p>
                    <p className="text-sm font-medium">{data.notes}</p>
                </div>
            )}
        </>
    );
}

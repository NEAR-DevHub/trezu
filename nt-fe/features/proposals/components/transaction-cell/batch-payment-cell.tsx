import { useTranslations } from "next-intl";
import {
    BatchPaymentRequestData,
    ConfidentialBulkPaymentData,
    PaymentRequestData,
} from "@/features/proposals/types/index";
import { useBatchPayment } from "@/hooks/use-treasury-queries";
import { TokenCell } from "./token-cell";
import { Skeleton } from "@/components/ui/skeleton";
import Big from "@/lib/big";

interface BatchPaymentCellViewProps {
    tokenId: string;
    totalAmount: string;
    recipientsCount: number;
    timestamp?: string;
    textOnly?: boolean;
}

/** Shared presentational cell for any batch-payment style proposal. */
function BatchPaymentCellView({
    tokenId,
    totalAmount,
    recipientsCount,
    timestamp,
    textOnly = false,
}: BatchPaymentCellViewProps) {
    const t = useTranslations("proposals.expanded");
    const tokenData = {
        tokenId,
        amount: totalAmount,
        receiver: t("recipientsCount", { count: recipientsCount }),
    } as PaymentRequestData;

    return (
        <TokenCell
            data={tokenData}
            isUser={false}
            timestamp={timestamp}
            textOnly={textOnly}
        />
    );
}

interface BatchPaymentCellProps {
    data: BatchPaymentRequestData;
    timestamp?: string;
    textOnly?: boolean;
}

/**
 * On-chain bulk payment cell. Queries the `bulkpayment.near` contract for the
 * current recipient list, then renders via `BatchPaymentCellView`.
 */
export function BatchPaymentCell({
    data,
    timestamp,
    textOnly = false,
}: BatchPaymentCellProps) {
    const { data: batchData, isLoading } = useBatchPayment(data.batchId);

    if (isLoading) {
        return (
            <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-24" />
            </div>
        );
    }

    let tokenId = data.tokenId;
    if (batchData?.tokenId?.toLowerCase() === "native") {
        tokenId = "near";
    }

    return (
        <BatchPaymentCellView
            tokenId={tokenId}
            totalAmount={data.totalAmount}
            recipientsCount={batchData?.payments?.length ?? 0}
            timestamp={timestamp}
            textOnly={textOnly}
        />
    );
}

interface IntentsBatchPaymentCellProps {
    data: ConfidentialBulkPaymentData;
    timestamp?: string;
    textOnly?: boolean;
}

/**
 * Confidential-intents bulk payment cell. No on-chain lookup needed — the
 * stored quote metadata already has every recipient/amount.
 */
export function IntentsBatchPaymentCell({
    data,
    timestamp,
    textOnly = false,
}: IntentsBatchPaymentCellProps) {
    const tokenId = data.recipients[0]?.tokenId ?? "";
    const totalAmount = data.recipients
        .reduce((sum, r) => sum.add(Big(r.amount || "0")), Big(0))
        .toString();

    return (
        <BatchPaymentCellView
            tokenId={tokenId}
            totalAmount={totalAmount}
            recipientsCount={data.recipients.length}
            timestamp={timestamp}
            textOnly={textOnly}
        />
    );
}

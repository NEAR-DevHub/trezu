import { ConfidentialBulkData } from "../../types/index";
import { BatchPayment, PaymentStatus } from "@/lib/api";
import { BatchPaymentExpandedView } from "./batch-payment-expanded";

interface ConfidentialBulkExpandedProps {
    data: ConfidentialBulkData;
}

/**
 * Confidential bulk-payment expanded view. Maps each recipient row from the
 * BE-attached `confidential_metadata.bulk` overlay into the public
 * `BatchPayment` shape so the same pure renderer can show it.
 *
 * Header total + token come from the parent extractor (header quote).
 * Recipient amount/recipient come from each leg's stored 1Click quote.
 */
export function ConfidentialBulkExpanded({
    data,
}: ConfidentialBulkExpandedProps) {
    const payments: BatchPayment[] = data.recipients.map((r) => {
        const quote =
            (r.quoteMetadata as
                | {
                      quote?: { amountIn?: string };
                      quoteRequest?: { recipient?: string };
                  }
                | undefined) ?? {};
        const amount = quote.quote?.amountIn ?? "0";
        const recipient = quote.quoteRequest?.recipient ?? "";
        const isPaid = r.status === "submitted";
        const status: PaymentStatus = isPaid
            ? { Paid: { block_height: 0 } }
            : "Pending";
        return { recipient, amount, status };
    });

    return (
        <BatchPaymentExpandedView
            tokenId={data.tokenId}
            totalAmount={data.totalAmount}
            payments={payments}
            batchId={null}
        />
    );
}

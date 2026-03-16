"use client";

import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/button";
import { ExternalLink } from "lucide-react";
import { useReceiptSearch } from "@/hooks/use-receipt-search";

interface TransactionHashCellProps {
    transactionHashes?: string[];
    receiptIds?: string[];
    className?: string;
}

/**
 * Reusable component for displaying transaction hash with receipt search fallback
 *
 * Displays a clickable transaction hash link with copy functionality.
 * If no transaction hash is provided, attempts to resolve it from receipt ID.
 */
export function TransactionHashCell({
    transactionHashes,
    receiptIds,
    className = "flex items-center justify-end gap-2",
}: TransactionHashCellProps) {
    const needsReceiptSearch = !transactionHashes?.length;
    const { data: transactionFromReceipt } = useReceiptSearch(
        needsReceiptSearch ? receiptIds?.[0] : undefined,
    );

    const transactionHash = transactionHashes?.length
        ? transactionHashes[0]
        : transactionFromReceipt?.[0]?.originatedFromTransactionHash;

    if (!transactionHash) return null;

    const explorerUrl = `https://nearblocks.io/txns/${transactionHash}`;

    return (
        <div className={className}>
            <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline hover:no-underline"
            >
                {transactionHash.slice(0, 12)}...
            </a>
            <Button
                variant="ghost"
                size="icon-sm"
                tooltipContent="Open in Explorer"
                onClick={() => window.open(explorerUrl, "_blank")}
            >
                <ExternalLink className="h-3 w-3" />
            </Button>
            <CopyButton
                text={transactionHash}
                toastMessage="Transaction hash copied"
                variant="ghost"
                size="icon-sm"
                tooltipContent="Copy Transaction Hash"
            />
        </div>
    );
}

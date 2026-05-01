import { ConfidentialRequestData } from "../../types/index";
import { ConfidentialBulkExpanded } from "./confidential-bulk-expanded";
import { SwapExpanded } from "./swap-expanded";
import { TransferExpanded } from "./transfer-expanded";
import { ConfidentialState } from "@/components/confidential-state";
import { Skeleton } from "@/components/ui/skeleton";

interface ConfidentialTransferExpandedProps {
    data: ConfidentialRequestData;
}

export function ConfidentialRequestExpanded({
    data,
}: ConfidentialTransferExpandedProps) {
    const mapped = data.mapped;

    if (!mapped) {
        return (
            <ConfidentialState
                skeleton={
                    <div className="flex flex-col gap-2">
                        <Skeleton className="h-[60px] w-full" />
                        <Skeleton className="h-[60px] w-full" />
                        <Skeleton className="h-[60px] w-full" />
                    </div>
                }
            />
        );
    }

    if (mapped.type === "swap") {
        return <SwapExpanded data={mapped.data} />;
    } else if (mapped.type === "bulk") {
        return <ConfidentialBulkExpanded data={mapped.data} />;
    }

    return <TransferExpanded data={mapped.data} />;
}

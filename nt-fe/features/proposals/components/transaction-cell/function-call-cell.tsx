import { FunctionCallData } from "../../types/index";
import { TitleSubtitleCell } from "./title-subtitle-cell";
import { useProfile } from "@/hooks/use-treasury-queries";

interface FunctionCallCellProps {
    data: FunctionCallData;
    timestamp?: string;
    textOnly?: boolean;
}

export function FunctionCallCell({ data, timestamp }: FunctionCallCellProps) {
    const { data: profile } = useProfile(data.receiver);
    const receiver = profile?.addressBookName ?? data.receiver;
    const subtitle = `on ${receiver}${data.actionsCount > 1 ? ` (+${data.actionsCount - 1} more)` : ""}`;

    return (
        <TitleSubtitleCell
            title={data.methodName || "Function Call"}
            subtitle={subtitle}
            timestamp={timestamp}
        />
    );
}

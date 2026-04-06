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
    const subtitle = `on ${receiver}`;
    const title =
        data.actions.length === 1
            ? data.actions[0].methodName
            : `${data.actions.length} actions`;

    return (
        <TitleSubtitleCell
            title={title}
            subtitle={subtitle}
            timestamp={timestamp}
        />
    );
}

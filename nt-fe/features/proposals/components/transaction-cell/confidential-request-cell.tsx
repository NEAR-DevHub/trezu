import { Shield } from "lucide-react";
import { ConfidentialRequestData } from "../../types/index";
import { Amount } from "../amount";
import { TitleSubtitleCell } from "./title-subtitle-cell";
import { TooltipUser } from "@/components/user";
import { useProfile } from "@/hooks/use-treasury-queries";

interface ConfidentialTransferCellProps {
    data: ConfidentialRequestData;
    timestamp?: string;
    textOnly?: boolean;
}

export function ConfidentialRequestCell({
    data,
    timestamp,
    textOnly = false,
}: ConfidentialTransferCellProps) {
    const { data: profile } = useProfile(data.recipient);
    const address = profile?.addressBookName ?? data.recipient;

    if (!data.originAsset || !data.amountIn) {
        return (
            <TitleSubtitleCell
                title={
                    <div className="flex items-center gap-1.5">
                        <Shield className="size-4 text-muted-foreground" />
                        <span className="font-medium">
                            Confidential Request
                        </span>
                    </div>
                }
                timestamp={timestamp}
            />
        );
    }

    const title = (
        <Amount
            amount={data.amountIn}
            tokenId={data.originAsset}
            showUSDValue={false}
            iconSize="sm"
            textOnly={textOnly}
        />
    );

    const subtitle = data.recipient ? (
        <>
            To:
            <TooltipUser accountId={data.recipient} useAddressBook>
                <span> {address}</span>
            </TooltipUser>
        </>
    ) : undefined;

    return (
        <TitleSubtitleCell
            title={title}
            subtitle={subtitle}
            timestamp={timestamp}
        />
    );
}

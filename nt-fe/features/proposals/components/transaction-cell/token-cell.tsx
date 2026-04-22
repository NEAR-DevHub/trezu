import { useTranslations } from "next-intl";
import {
    PaymentRequestData,
    VestingData,
    StakingData,
} from "../../types/index";
import { Amount } from "../amount";
import { TooltipUser } from "@/components/user";
import { TitleSubtitleCell } from "./title-subtitle-cell";
import { useProfile } from "@/hooks/use-treasury-queries";

interface TokenCellProps {
    data: PaymentRequestData | VestingData | StakingData;
    prefix?: string;
    isUser?: boolean;
    timestamp?: string;
    textOnly?: boolean;
}

export function TokenCell({
    data,
    prefix,
    isUser = true,
    timestamp,
    textOnly = false,
}: TokenCellProps) {
    const t = useTranslations("proposals.expanded");
    const effectivePrefix = prefix ?? t("toPrefix");
    const title = (
        <Amount
            amount={data.amount}
            tokenId={data.tokenId}
            showUSDValue={false}
            iconSize="sm"
            textOnly={textOnly}
        />
    );
    const { data: profile } = useProfile(data.receiver);
    const address = profile?.addressBookName ?? data.receiver;

    const subtitle = data.receiver ? (
        <>
            {effectivePrefix}
            {isUser ? (
                <TooltipUser accountId={data.receiver} useAddressBook>
                    <span> {address}</span>
                </TooltipUser>
            ) : (
                ` ${address}`
            )}
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

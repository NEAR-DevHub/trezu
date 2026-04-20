import { Amount } from "../amount";
import { InfoDisplay, InfoItem } from "@/components/info-display";
import { User } from "@/components/user";
import { PaymentRequestData } from "../../types/index";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useToken } from "@/hooks/use-treasury-queries";
import { useIntentsWithdrawalFee } from "@/hooks/use-intents-withdrawal-fee";
import { NETWORK_FEE_TOOLTIP_TEXT } from "@/lib/intents-fee";

interface TransferExpandedProps {
    data: PaymentRequestData;
}

export function TransferExpanded({ data }: TransferExpandedProps) {
    // Get token metadata to determine blockchain network
    const { data: tokenData } = useToken(data.tokenId);
    const chainName = tokenData?.network || "near";
    const {
        data: dynamicFeeData,
        isError: hasFeeError,
        isIntentsCrossChainToken,
    } = useIntentsWithdrawalFee({
        token: tokenData
            ? {
                  address: data.tokenId,
                  network: chainName,
                  decimals: tokenData.decimals,
              }
            : null,
        destinationAddress: data.receiver,
    });
    const hasFeeData =
        isIntentsCrossChainToken &&
        !hasFeeError &&
        !!dynamicFeeData?.networkFee;

    const infoItems: InfoItem[] = [
        {
            label: "Recipient",
            value: (
                <User
                    accountId={data.receiver}
                    useAddressBook
                    chainName={chainName}
                    withHoverCard
                />
            ),
        },
        {
            label: "Amount",
            value: (
                <Amount
                    amount={data.amount}
                    showNetwork
                    tokenId={data.tokenId}
                />
            ),
        },
    ];

    if (hasFeeData) {
        infoItems.push({
            label: "Network Fee",
            info: NETWORK_FEE_TOOLTIP_TEXT,
            value: `${dynamicFeeData.networkFee} ${tokenData?.symbol || ""}`.trim(),
        });
    }

    if (data.notes && data.notes !== "") {
        const notes = <span>{data.notes}</span>;
        const content =
            data.url && data.url !== "" ? (
                <Link
                    href={data.url}
                    target="_blank"
                    className="flex items-center gap-5"
                >
                    {notes} <ArrowUpRight className="size-4 shrink-0" />{" "}
                </Link>
            ) : (
                notes
            );
        infoItems.push({ label: "Notes", value: content });
    }

    return <InfoDisplay items={infoItems} />;
}

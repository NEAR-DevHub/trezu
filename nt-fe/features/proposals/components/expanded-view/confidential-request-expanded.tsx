import { Amount } from "../amount";
import { InfoDisplay, InfoItem } from "@/components/info-display";
import { User } from "@/components/user";
import { Address } from "@/components/address";
import { ConfidentialRequestData } from "../../types/index";
import { FormattedDate } from "@/components/formatted-date";

interface ConfidentialTransferExpandedProps {
    data: ConfidentialRequestData;
}

export function ConfidentialRequestExpanded({
    data,
}: ConfidentialTransferExpandedProps) {
    if (!data.originAsset || !data.amountIn) {
        return (
            <p className="text-sm text-muted-foreground">
                Confidential transfer details are not available for this
                proposal.
            </p>
        );
    }

    const infoItems: InfoItem[] = [
        {
            label: "Send",
            value: (
                <Amount
                    amount={data.amountIn}
                    showNetwork
                    tokenId={data.originAsset}
                />
            ),
        },
        {
            label: "Receive",
            value: (
                <Amount
                    amount={data.amountOut || data.amountIn}
                    showNetwork
                    tokenId={data.destinationAsset || data.originAsset}
                />
            ),
        },
    ];

    if (data.recipient) {
        infoItems.push({
            label: "Recipient",
            value: (
                <User accountId={data.recipient} useAddressBook withHoverCard />
            ),
        });
    }

    const expandableItems: InfoItem[] = [];

    if (data.timeEstimate) {
        expandableItems.push({
            label: "Estimated Time",
            value: <span>{data.timeEstimate} seconds</span>,
            info: "Estimated time for the transfer to be executed after the signing proposal is approved.",
        });
    }

    if (data.depositAddress) {
        expandableItems.push({
            label: "Deposit Address",
            value: <Address address={data.depositAddress} copyable />,
            info: "The 1Click deposit address where funds are sent for execution.",
        });
    }

    if (data.signature) {
        expandableItems.push({
            label: "Quote Signature",
            value: (
                <Address address={data.signature} copyable prefixLength={16} />
            ),
            info: "The cryptographic signature from 1Click API that validates this quote.",
        });
    }

    if (data.deadline) {
        expandableItems.push({
            label: "Quote Deadline",
            value: <FormattedDate date={data.deadline} />,
            info: "Time when the deposit address becomes inactive.",
        });
    }

    if (data.status) {
        expandableItems.push({
            label: "Intent Status",
            value: <span className="capitalize">{data.status}</span>,
        });
    }

    return <InfoDisplay items={infoItems} expandableItems={expandableItems} />;
}

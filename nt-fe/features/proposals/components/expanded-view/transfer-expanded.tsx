import { useTranslations } from "next-intl";
import { Amount } from "../amount";
import { InfoDisplay, InfoItem } from "@/components/info-display";
import { User } from "@/components/user";
import { PaymentRequestData } from "../../types/index";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useToken } from "@/hooks/use-treasury-queries";
import { useIntentsWithdrawalFee } from "@/hooks/use-intents-withdrawal-fee";
import { Address } from "@/components/address";
import { useBridgeTokens } from "@/hooks/use-bridge-tokens";
import { NetworkIconDisplay } from "@/components/token-display";
import { NEAR_COM_ICON } from "@/constants/token";
import { NEAR_COM_NETWORK_ID } from "@/constants/intents";
import type { ChainIcons } from "@/lib/api";

interface TransferExpandedProps {
    data: PaymentRequestData;
}

export function TransferExpanded({ data }: TransferExpandedProps) {
    const t = useTranslations("proposals.expanded");
    const tIntents = useTranslations("intentsQuote");
    const { data: tokenData } = useToken(data.tokenId);
    const tokenChainName = tokenData?.network || "near";
    const shouldFetchDestinationNetworkMeta =
        !!data.receiverNetwork &&
        data.receiverNetwork !== tokenChainName &&
        data.receiverNetwork !== NEAR_COM_NETWORK_ID;
    const { data: bridgeAssets = [] } = useBridgeTokens(
        shouldFetchDestinationNetworkMeta,
    );

    // For cross-chain intents payments use the destination network for the
    // recipient profile link so the explorer link points to the right chain.
    const recipientChainName = data.receiverNetwork ?? tokenChainName;

    const {
        data: dynamicFeeData,
        isError: hasFeeError,
        isIntentsCrossChainToken,
    } = useIntentsWithdrawalFee({
        token: tokenData
            ? {
                  address: data.tokenId,
                  network: tokenChainName,
                  decimals: tokenData.decimals,
              }
            : null,
        destinationAddress: data.receiver,
    });
    const hasFeeData =
        isIntentsCrossChainToken &&
        !hasFeeError &&
        !!dynamicFeeData?.networkFee;

    const destinationNetworkMeta = (() => {
        if (!data.receiverNetwork || data.receiverNetwork === tokenChainName) {
            return null;
        }
        if (data.receiverNetwork === NEAR_COM_NETWORK_ID) {
            return {
                name: NEAR_COM_NETWORK_ID,
                chainIcons: {
                    dark: NEAR_COM_ICON,
                    light: NEAR_COM_ICON,
                } as ChainIcons,
            };
        }

        for (const asset of bridgeAssets) {
            const network = asset.networks.find(
                (n) =>
                    n.id === data.receiverNetwork ||
                    n.name === data.receiverNetwork,
            );
            if (!network) continue;

            return {
                name: network.name,
                chainIcons: network.chainIcons,
            };
        }

        return {
            name: data.receiverNetwork,
            chainIcons: null,
        };
    })();

    const infoItems: InfoItem[] = [
        {
            label: t("recipient"),
            value: (
                <User
                    accountId={data.receiver}
                    useAddressBook
                    chainName={recipientChainName}
                    withHoverCard
                />
            ),
        },
        {
            label: t("amount"),
            value: (
                <Amount
                    amount={data.amount}
                    showNetwork
                    tokenId={data.tokenId}
                />
            ),
        },
    ];

    if (destinationNetworkMeta) {
        infoItems.push({
            label: t("destinationNetwork"),
            value: (
                <NetworkIconDisplay
                    chainIcons={destinationNetworkMeta.chainIcons}
                    networkName={destinationNetworkMeta.name}
                    networkNameClassName="font-normal capitalize"
                />
            ),
        });
    }

    if (hasFeeData) {
        infoItems.push({
            label: t("networkFee"),
            info: tIntents("networkFeeTooltip"),
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
        infoItems.push({ label: t("notes"), value: content });
    }

    const expandableItems: InfoItem[] = [];

    if (data.depositAddress) {
        expandableItems.push({
            label: t("depositAddress"),
            value: <Address address={data.depositAddress} copyable={true} />,
            info: t("depositAddressTooltip"),
        });
    }

    if (data.quoteSignature) {
        expandableItems.push({
            label: t("quoteSignature"),
            value: (
                <Address
                    address={data.quoteSignature}
                    copyable={true}
                    prefixLength={16}
                />
            ),
            info: t("quoteSignatureTooltip"),
        });
    }

    return (
        <InfoDisplay
            items={infoItems}
            expandableItems={
                expandableItems.length > 0 ? expandableItems : undefined
            }
        />
    );
}

"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { TokenDisplay } from "@/components/token-display-with-network";
import { getNetworkDisplayName } from "@/components/token-display";
import { Tooltip } from "@/components/tooltip";
import { getLocalizedNetworkDisplayName } from "@/constants/intents";
import { useToken } from "@/hooks/use-treasury-queries";
import {
    formatBalance,
    formatCurrency,
    formatTokenDisplayAmount,
    getNearTokenTypeLabel,
} from "@/lib/utils";
import { useMemo } from "react";

interface AmountProps {
    amount?: string;
    amountWithDecimals?: string;
    tokenId: string;
    showUSDValue?: boolean;
    showNetwork?: boolean;
    showNetworkTooltip?: boolean;
    expandNearComLabel?: boolean;
    network?: string; // Optional override for network display
    textOnly?: boolean;
    iconSize?: "sm" | "md" | "lg";
}

export function Amount({
    amount,
    amountWithDecimals,
    textOnly = false,
    tokenId,
    showUSDValue = true,
    showNetwork = false,
    showNetworkTooltip = false,
    expandNearComLabel = false,
    network,
    iconSize = "lg",
}: AmountProps) {
    const tCommon = useTranslations("common");
    const tAmount = useTranslations("amount");
    const tAddressBookTable = useTranslations("addressBookTable");
    const { data: tokenData, isLoading } = useToken(tokenId);
    const rawAmountValue = amount
        ? formatBalance(amount, tokenData?.decimals || 24)
        : amountWithDecimals || "0";
    const amountValue = formatTokenDisplayAmount(rawAmountValue);
    const estimatedUSDValue = useMemo(() => {
        const isPriceAvailable = tokenData?.price;
        const parsedAmount = Number(rawAmountValue);
        if (!isPriceAvailable || !rawAmountValue || isNaN(parsedAmount)) {
            return tCommon("notAvailable");
        }

        const price = tokenData?.price;
        return `≈ ${formatCurrency(parsedAmount * price!)}`;
    }, [tokenData, rawAmountValue, tCommon]);
    const normalizedTokenId = tokenId.trim().toLowerCase();
    const isNativeNearToken =
        normalizedTokenId.length === 0 || normalizedTokenId === "near";
    const resolvedNetwork = network ?? tokenData?.network;
    const resolvedNetworkForLabel = isNativeNearToken
        ? "near"
        : resolvedNetwork;
    const nearTypeLabel = getNearTokenTypeLabel(
        isNativeNearToken ? "near" : tokenId,
        resolvedNetworkForLabel,
    );
    const normalizedNearTypeLabel =
        !expandNearComLabel && nearTypeLabel === "NEAR (near.com) Network"
            ? "near.com"
            : nearTypeLabel;
    const networkLabel =
        normalizedNearTypeLabel ??
        (resolvedNetworkForLabel
            ? getLocalizedNetworkDisplayName({
                  networkName: resolvedNetworkForLabel,
                  networkLabel: tAddressBookTable("network"),
                  fallbackName: getNetworkDisplayName(resolvedNetworkForLabel),
                  expandNearComLabel,
              })
            : undefined);
    const networkTooltipContent = networkLabel
        ? tAmount("network", { network: networkLabel })
        : null;

    if (isLoading) {
        if (textOnly) {
            return <Skeleton className="h-5 w-24" />;
        }
        return (
            <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-5 w-20" />
                    {showUSDValue && <Skeleton className="h-4 w-16" />}
                </div>
                {showNetwork && <Skeleton className="h-3 w-24" />}
            </div>
        );
    }

    if (textOnly) {
        const textOnlyAmount = (
            <div className="flex flex-col items-end gap-0.5">
                <p className="text-sm font-semibold">
                    {amountValue} {tokenData?.symbol}
                </p>
                {showUSDValue && (
                    <span className="text-muted-foreground text-xs">
                        {estimatedUSDValue}
                    </span>
                )}
            </div>
        );

        if (showNetworkTooltip && networkTooltipContent) {
            return (
                <Tooltip content={networkTooltipContent}>
                    <span>{textOnlyAmount}</span>
                </Tooltip>
            );
        }

        return textOnlyAmount;
    }

    const amountContent = (
        <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
                {tokenData && (
                    <TokenDisplay
                        symbol={tokenData.symbol}
                        icon={tokenData.icon ?? ""}
                        chainIcons={tokenData.chainIcons}
                        iconSize={iconSize}
                    />
                )}
                {tokenData && (
                    <span className="font-medium">
                        {amountValue} {tokenData?.symbol}
                    </span>
                )}
            </div>
            {showUSDValue && (
                <span className="text-muted-foreground text-xs">
                    {estimatedUSDValue}
                </span>
            )}
            {showNetwork &&
                (() => {
                    return networkLabel ? (
                        <span className="text-muted-foreground text-xs">
                            {tAmount("network", { network: networkLabel })}
                        </span>
                    ) : null;
                })()}
        </div>
    );

    if (showNetworkTooltip && networkTooltipContent) {
        return (
            <Tooltip content={networkTooltipContent}>
                <div>{amountContent}</div>
            </Tooltip>
        );
    }

    return amountContent;
}

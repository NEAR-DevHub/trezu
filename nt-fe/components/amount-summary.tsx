"use client";

import { useTranslations } from "next-intl";
import Big from "@/lib/big";
import { Token } from "./token-input";
import { formatCurrency, formatTokenDisplayAmount } from "@/lib/utils";
import { TokenDisplay } from "./token-display-with-network";
import { SummaryBlock } from "./summary-block";

interface AmountSummaryProps {
    total: Big | string;
    totalUSD?: number;
    token: Token;
    title?: string;
    children?: React.ReactNode;
    /**
     * When false, renders without InputBlock wrapper
     * Default: true
     */
    useInputBlock?: boolean;
    /**
     * When true, shows network icon badge on token
     * Default: false
     */
    showNetworkIcon?: boolean;
    /**
     * When true, renders `total` as-is without applying amount formatter.
     * Useful when caller already provides a fully formatted value.
     * Default: false
     */
    preserveFormattedTotal?: boolean;
}

export function AmountSummary({
    total,
    token,
    title,
    totalUSD,
    children,
    useInputBlock = true,
    showNetworkIcon = false,
    preserveFormattedTotal = false,
}: AmountSummaryProps) {
    const t = useTranslations("amountSummary");
    const totalString = preserveFormattedTotal
        ? total.toString()
        : formatTokenDisplayAmount(total.toString());

    return (
        <SummaryBlock
            title={title ?? t("defaultTitle")}
            useInputBlock={useInputBlock}
            icon={
                <TokenDisplay
                    symbol={token.symbol}
                    icon={token.icon || ""}
                    chainIcons={showNetworkIcon ? token.chainIcons : undefined}
                    iconSize="xl"
                />
            }
            secondRow={
                <p className="text-lg font-semibold text-foreground break-all">
                    {totalString}{" "}
                    <span className="text-muted-foreground font-medium text-xs">
                        {token.symbol}
                    </span>
                </p>
            }
            subRow={
                totalUSD ? (
                    <p className="text-xxs text-muted-foreground break-all">
                        ≈{formatCurrency(totalUSD)}
                    </p>
                ) : undefined
            }
        >
            {children}
        </SummaryBlock>
    );
}

"use client";

import { AmountSummary } from "@/components/amount-summary";
import type { Token } from "@/components/token-input";

interface ExchangeSummaryCardProps {
    title: string;
    token: Token;
    amount: string;
    usdValue?: number;
}

/**
 * Card component to display token amount and USD value
 * Uses AmountSummary without InputBlock wrapper
 */
export function ExchangeSummaryCard({
    title,
    token,
    amount,
    usdValue,
}: ExchangeSummaryCardProps) {
    return (
        <AmountSummary
            total={amount}
            totalUSD={usdValue}
            token={token}
            title={title}
            useInputBlock={false}
            showNetworkIcon={true}
        />
    );
}

"use client";

import { Token } from "@/components/token-input";
import { AmountSummary } from "@/components/amount-summary";

interface ExchangeSummaryCardProps {
  title: string;
  token: Token;
  amount: string;
  usdValue: number;
}

/**
 * Format large numbers with ellipsis in the middle for better display
 */
function formatLargeNumber(num: string): string {
  // Remove token symbol if present
  const numOnly = num.split(" ")[0];

  // If number is very long (e.g., more than 20 chars), truncate with ellipsis
  if (numOnly.length > 20) {
    return `${numOnly.slice(0, 10)}...${numOnly.slice(-6)}`;
  }
  return num;
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
  const formattedAmount = formatLargeNumber(amount);

  return (
    <AmountSummary
      total={formattedAmount}
      totalUSD={usdValue}
      token={token}
      title={title}
      useInputBlock={false}
      showNetworkIcon={true}
    />
  );
}
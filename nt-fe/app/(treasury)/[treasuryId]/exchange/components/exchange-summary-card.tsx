"use client";

import { Token } from "@/components/token-input";
import { useThemeStore } from "@/stores/theme-store";

interface ExchangeSummaryCardProps {
  title: string;
  token: Token;
  amount: string;
  usdValue: number;
}

/**
 * Card component to display token amount and USD value
 */
export function ExchangeSummaryCard({
  title,
  token,
  amount,
  usdValue,
}: ExchangeSummaryCardProps) {
  const { theme } = useThemeStore();

  // Get network icon based on theme
  const getNetworkIcon = () => {
    if (!token.chainIcons) return null;
    return theme === 'light' ? token.chainIcons.light : token.chainIcons.dark;
  };

  const networkIcon = getNetworkIcon();

  // Format large numbers with ellipsis in the middle
  const formatLargeNumber = (num: string) => {
    // Remove token symbol if present
    const numOnly = num.split(" ")[0];

    // If number is very long (e.g., more than 20 chars), truncate with ellipsis
    if (numOnly.length > 20) {
      return `${numOnly.slice(0, 10)}...${numOnly.slice(-6)}`;
    }
    return num;
  };

  return (
    <div className="w-full max-w-[280px] rounded-lg border bg-muted p-4 flex flex-col items-center gap-2 h-[180px] justify-center">
      <p className="text-sm text-muted-foreground font-medium">{title}</p>
      <div className="relative flex">
        <img
          src={token.icon}
          alt={token.symbol}
          className="size-10 rounded-full"
        />
        {networkIcon && (
          <div className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-full bg-muted border border-border">
            <img
              src={networkIcon}
              alt="network"
              className="size-4 shrink-0 p-0.5"
            />
          </div>
        )}
      </div>
      <div className="w-full flex flex-col items-center">
        <p className="text-lg font-semibold text-center break-all">
          <span className="break-all">{formatLargeNumber(amount)}</span>{" "}
          <span className="text-muted-foreground text-xs font-normal whitespace-nowrap">
            {token.symbol}
          </span>
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        ≈ $
        {usdValue.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </p>
    </div>
  );
}


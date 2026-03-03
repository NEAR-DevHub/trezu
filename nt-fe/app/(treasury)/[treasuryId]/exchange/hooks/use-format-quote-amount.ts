import { useMemo } from "react";
import Big from "@/lib/big";
import { formatTokenAmount } from "@/lib/utils";

interface FormatQuoteAmountParams {
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    tokenDecimals: number;
}

/**
 * Hook to format token amounts from quote data with optimal precision
 * Calculates token price from quote USD value and formats with enough decimals to represent $0.01
 * 
 * @param params - Quote amount data and token decimals
 * @returns Formatted token amount string
 */
export function useFormatQuoteAmount(params: FormatQuoteAmountParams | null): string {
    return useMemo(() => {
        if (!params) {
            return "";
        }

        const { amountOut, amountOutFormatted, amountOutUsd, tokenDecimals } = params;

        try {
            // Calculate token price from USD value: price = usdValue / tokenAmount
            const usdValue = parseFloat(amountOutUsd || "0");
            const tokenAmountDecimal = Big(amountOut).div(Big(10).pow(tokenDecimals));
            const tokenPrice = tokenAmountDecimal.gt(0)
                ? usdValue / Number(tokenAmountDecimal.toString())
                : 0;

            return formatTokenAmount(amountOut, tokenDecimals, tokenPrice);
        } catch (error) {
            console.error("Error formatting quote amount:", error);
            // Fallback to backend formatted value
            return amountOutFormatted;
        }
    }, [params]);
}


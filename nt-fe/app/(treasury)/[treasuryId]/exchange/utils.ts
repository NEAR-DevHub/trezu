import Big from "@/lib/big";

/**
 * Checks if a token is native NEAR
 * If residency is provided, it must be "Near"
 * If residency is not provided, just check address
 */
export function isNativeNEAR(address: string, residency?: string): boolean {
    return address === "near" && (!residency || residency === "Near");
}

/**
 * Checks if a token is FT NEAR (wrap.near)
 * If residency is provided, it must be "Ft"
 * If residency is not provided, just check address
 */
export function isFTNEAR(address: string, residency?: string): boolean {
    return address === "wrap.near" && (!residency || residency === "Ft");
}

/**
 * Checks if this is a NEAR deposit conversion (native NEAR → FT NEAR)
 */
export function isNEARDeposit(
    sellToken: { address: string; residency?: string },
    receiveToken: { address: string; residency?: string },
): boolean {
    return (
        isNativeNEAR(sellToken.address, sellToken.residency) &&
        isFTNEAR(receiveToken.address, receiveToken.residency)
    );
}

/**
 * Checks if this is a NEAR withdraw conversion (FT NEAR → native NEAR)
 */
export function isNEARWithdraw(
    sellToken: { address: string; residency?: string },
    receiveToken: { address: string; residency?: string },
): boolean {
    return (
        isFTNEAR(sellToken.address, sellToken.residency) &&
        isNativeNEAR(receiveToken.address, receiveToken.residency)
    );
}

/**
 * Checks if this is a NEAR wrap/unwrap conversion (1:1 exchange)
 */
export function isNEARWrapConversion(
    sellToken: { address: string; residency?: string },
    receiveToken: { address: string; residency?: string },
): boolean {
    return (
        isNEARDeposit(sellToken, receiveToken) ||
        isNEARWithdraw(sellToken, receiveToken)
    );
}

/**
 * Formats an asset address for the 1Click Intents API
 * Native NEAR uses "wrap.near", other tokens use their address as-is
 */
export function formatAssetForIntentsAPI(tokenAddress: string): string {
    return tokenAddress.startsWith("nep")
        ? tokenAddress
        : tokenAddress === "near"
          ? "nep141:wrap.near"
          : `nep141:${tokenAddress}`;
}

/**
 * Determines deposit and refund type based on the origin asset's network
 * - If residency === "Intents": Token is on Intents → INTENTS
 * - Otherwise: Token is on NEAR: FT or Native NEAR → ORIGIN_CHAIN
 */
export function getDepositAndRefundType(
    residency: string,
    isConfidential?: boolean,
): "INTENTS" | "CONFIDENTIAL_INTENTS" | "ORIGIN_CHAIN" {
    return residency === "Intents"
        ? isConfidential
            ? "CONFIDENTIAL_INTENTS"
            : "INTENTS"
        : "ORIGIN_CHAIN";
}

export function getRecipientType(
    residency: string,
    isConfidential?: boolean,
): "INTENTS" | "CONFIDENTIAL_INTENTS" | "DESTINATION_CHAIN" {
    return residency === "Intents"
        ? isConfidential
            ? "CONFIDENTIAL_INTENTS"
            : "INTENTS"
        : "DESTINATION_CHAIN";
}

/**
 * Calculates the price difference between expected market rate and quote rate
 * Compares the USD values to determine if the rate is favorable or not
 * @param amountInUsd - USD value of input amount from quote
 * @param amountOutUsd - USD value of output amount from quote
 * @param amountIn - Raw amount in (smallest units)
 * @param amountOut - Raw amount out (smallest units)
 * @param sellTokenDecimals - Decimals for sell token
 * @param receiveTokenDecimals - Decimals for receive token
 * @param sellTokenPrice - Market price per token (from metadata/price feed)
 * @param receiveTokenPrice - Market price per token (from metadata/price feed)
 * @returns Object with percentage difference and whether it's favorable
 */
export function calculateMarketPriceDifference(
    amountInUsd: string,
    amountOutUsd: string,
    amountIn: string,
    amountOut: string,
    sellTokenDecimals: number,
    receiveTokenDecimals: number,
    sellTokenPrice?: number,
    receiveTokenPrice?: number,
): {
    percentDifference: string;
    isFavorable: boolean;
    hasMarketData: boolean;
} {
    // If we don't have market prices, we can't calculate market difference
    if (!sellTokenPrice || !receiveTokenPrice) {
        return {
            percentDifference: "N/A",
            isFavorable: false,
            hasMarketData: false,
        };
    }

    try {
        // Calculate actual token amounts
        const receiveAmount = Big(amountOut).div(
            Big(10).pow(receiveTokenDecimals),
        );

        // Calculate expected USD value based on market prices
        const expectedReceiveUSD = receiveAmount.mul(receiveTokenPrice);

        // Get actual USD values from quote
        const actualReceiveUSD = Big(amountOutUsd);

        // Calculate the rate difference
        // Positive means you're getting more USD value than expected (favorable)
        // Negative means you're getting less USD value than expected (unfavorable)
        const usdValueDifference = actualReceiveUSD.minus(expectedReceiveUSD);
        const percentDifference = usdValueDifference
            .div(expectedReceiveUSD)
            .mul(100);

        return {
            percentDifference: percentDifference.toFixed(4),
            isFavorable: percentDifference.gte(0),
            hasMarketData: true,
        };
    } catch (error) {
        console.error("Error calculating market price difference:", error);
        return {
            percentDifference: "N/A",
            isFavorable: false,
            hasMarketData: false,
        };
    }
}

export type ExchangeErrorCode =
    | "noRoute"
    | "amountTooLow"
    | "insufficientBalance"
    | "networkError"
    | "unknown";

/**
 * Classifies API errors into a translation-friendly code.
 * Caller is responsible for translating the code into a user message.
 */
export function classifyExchangeError(errorMessage: string): {
    code: ExchangeErrorCode;
    raw: string;
} {
    const lowerError = errorMessage.toLowerCase();

    if (
        lowerError.includes("no route") ||
        lowerError.includes("no swap") ||
        lowerError.includes("not supported") ||
        lowerError.includes("tokenin is not valid") ||
        lowerError.includes("tokenout is not valid")
    ) {
        return { code: "noRoute", raw: errorMessage };
    }
    if (lowerError.includes("amount") && lowerError.includes("low")) {
        return { code: "amountTooLow", raw: errorMessage };
    }
    if (
        lowerError.includes("insufficient") ||
        lowerError.includes("balance")
    ) {
        return { code: "insufficientBalance", raw: errorMessage };
    }
    if (lowerError.includes("timeout") || lowerError.includes("network")) {
        return { code: "networkError", raw: errorMessage };
    }
    return { code: "unknown", raw: errorMessage };
}

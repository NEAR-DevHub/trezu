import Big from "@/lib/big";

/**
 * Validate if payment amount meets minimum withdrawal requirement
 * @param amount - Amount in human-readable format (e.g., "10.5")
 * @param minWithdrawalAmount - Minimum amount in smallest unit (e.g., "1000000000000000000")
 * @param decimals - Token decimals
 * @param symbol - Token symbol for error message
 * @returns Error message if validation fails, null if passes
 */
export function validateMinimumWithdrawal(
    amount: string,
    minWithdrawalAmount: string | undefined,
    decimals: number,
    symbol: string,
): string | null {
    // Skip validation if no minimum withdrawal amount is set
    if (!minWithdrawalAmount) {
        return null;
    }

    try {
        const amountBig = new Big(amount);
        const minAmountRaw = new Big(minWithdrawalAmount);
        const divisor = new Big(10).pow(decimals);
        const minFormatted = minAmountRaw.div(divisor);

        if (amountBig.lt(minFormatted)) {
            return `The amount is too small to create this request. Minimum: ${minFormatted.toString()} ${symbol}`;
        }

        return null;
    } catch (error) {
        // Invalid number format, will be caught by other validation
        return null;
    }
}

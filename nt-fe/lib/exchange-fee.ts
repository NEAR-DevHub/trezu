import Big from "@/lib/big";

export const EXCHANGE_FEE_PERCENTAGE = 0.7;

/**
 * True when this quote included our app fee.
 * The quote proxy sets `hasAppFee`. Quotes from before that always charged,
 * so a missing flag still counts as charged.
 */
export function quoteHasAppFee(
    source?: {
        hasAppFee?: boolean | null;
    } | null,
): boolean {
    return source?.hasAppFee !== false;
}

/**
 * Older proposals never wrote `hasAppFee` and always charged.
 * Only an explicit `false` hides the row.
 */
export function shouldShowStoredExchangeFee(hasAppFee?: boolean): boolean {
    return hasAppFee !== false;
}

export function calculateExchangeFeeAmount(amount: string | number) {
    return Big(amount).mul(EXCHANGE_FEE_PERCENTAGE).div(100);
}

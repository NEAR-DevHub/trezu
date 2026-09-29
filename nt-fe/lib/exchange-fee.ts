import Big from "@/lib/big";

export const EXCHANGE_FEE_PERCENTAGE = 0.7;

export type QuoteAppFee = {
    recipient?: string;
    fee?: number;
};

/**
 * True when the 1Click quote charged our app fee.
 * `appFees` is one protocol-fee entry when we did not inject, and additional
 * entries when we did.
 */
export function quoteHasAppFee(
    quoteRequest?: { appFees?: QuoteAppFee[] | null } | null,
): boolean {
    return (quoteRequest?.appFees?.length ?? 0) > 1;
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

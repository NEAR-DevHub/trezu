import { groupedDecimalOrNull } from "@/lib/amount-format";
import Big from "@/lib/big";

export const EXCHANGE_FEE_PERCENTAGE = 0.7;

export type QuoteAppFee = {
    recipient?: string;
    fee?: number;
    limitOrderId?: string | null;
};

/**
 * True when the 1Click quote charged our app fee.
 * `appFees` is always an array: one protocol-fee entry when we did not inject,
 * and additional entries when we did.
 */
export function quoteHasAppFee(
    quoteRequest?: { appFees?: QuoteAppFee[] | null } | null,
): boolean {
    return (quoteRequest?.appFees?.length ?? 0) > 1;
}

/**
 * Stored proposals: older ones never wrote `hasAppFee` and always charged.
 * Only an explicit `false` (new quotes with protocol fee only) hides the row.
 */
export function shouldShowStoredExchangeFee(hasAppFee?: boolean): boolean {
    return hasAppFee !== false;
}

export function calculateExchangeFeeAmount(
    amount: string | number | Big | null | undefined,
): Big | null {
    const parsed = groupedDecimalOrNull(amount);
    if (!parsed?.gt(0)) return null;
    return parsed.mul(EXCHANGE_FEE_PERCENTAGE).div(100);
}

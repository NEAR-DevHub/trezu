import { groupedDecimalOrNull } from "@/lib/amount-format";
import Big from "@/lib/big";

export const EXCHANGE_FEE_PERCENTAGE = 0.7;

export function calculateExchangeFeeAmount(
    amount: string | number | Big | null | undefined,
): Big | null {
    const parsed = groupedDecimalOrNull(amount);
    if (!parsed?.gt(0)) return null;
    return parsed.mul(EXCHANGE_FEE_PERCENTAGE).div(100);
}

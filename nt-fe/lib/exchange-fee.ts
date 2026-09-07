import { groupedDecimalOrNull } from "@/lib/amount-format";
import Big from "@/lib/big";

export const EXCHANGE_FEE_PERCENTAGE = 0.7;

export function calculateExchangeFeeAmount(amount: string | number | Big) {
    const parsed = groupedDecimalOrNull(amount);
    if (!parsed) return Big(0);
    return parsed.mul(EXCHANGE_FEE_PERCENTAGE).div(100);
}

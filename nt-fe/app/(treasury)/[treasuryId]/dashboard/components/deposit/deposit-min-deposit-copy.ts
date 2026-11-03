import { decimalFromBaseUnitsOrNull } from "@/lib/amount-format";
import Big from "@/lib/big";

/** Shown when no minimum is known at all, matching near.com. */
export const DISPLAY_MIN_USD = 1;

export type MinDepositCopy =
    | { kind: "usd"; usd: number }
    | { kind: "amount"; amount: string }
    | { kind: "none" };

/**
 * Headline copy for a reusable deposit address.
 * With a price the minimum shows in dollars, rounded up to the cent so the
 * payer is never told less than the real floor; without one the formatted
 * token amount is used. With no minimum at all, bridge-routed addresses
 * fall back to the $1 floor as on near.com, while direct treasury-account
 * deposits (`usdFloor: false`) have none.
 */
export function resolveMinDepositCopy(params: {
    minDepositRaw?: string | null;
    decimals: number;
    priceUsd?: number | null;
    minDepositDisplay: string | null;
    usdFloor?: boolean;
}): MinDepositCopy {
    const {
        minDepositRaw,
        decimals,
        priceUsd,
        minDepositDisplay,
        usdFloor = true,
    } = params;
    const amount = decimalFromBaseUnitsOrNull(minDepositRaw, decimals);
    if (amount?.gt(0) && priceUsd != null && priceUsd > 0) {
        return {
            kind: "usd",
            usd: amount.mul(priceUsd).round(2, Big.roundUp).toNumber(),
        };
    }
    if (minDepositDisplay) {
        return { kind: "amount", amount: minDepositDisplay };
    }
    return usdFloor ? { kind: "usd", usd: DISPLAY_MIN_USD } : { kind: "none" };
}

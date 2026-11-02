import { decimalFromBaseUnitsOrNull } from "@/lib/amount-format";

/** Floor for the "Send at least $N" headline, matching near.com. */
export const DISPLAY_MIN_USD = 1;

export type MinDepositCopy =
    | { kind: "usd"; usd: number }
    | { kind: "amount"; amount: string }
    | { kind: "none" };

/**
 * Headline copy for a reusable deposit address.
 * With a price the minimum shows as whole dollars rounded up (never below
 * $1); without one the formatted token amount is used. With no minimum at
 * all, bridge-routed addresses fall back to the $1 floor as on near.com,
 * while direct treasury-account deposits (`usdFloor: false`) have none.
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
        const usd = amount.mul(priceUsd).toNumber();
        return {
            kind: "usd",
            usd: Math.max(DISPLAY_MIN_USD, Math.ceil(usd)),
        };
    }
    if (minDepositDisplay) {
        return { kind: "amount", amount: minDepositDisplay };
    }
    return usdFloor ? { kind: "usd", usd: DISPLAY_MIN_USD } : { kind: "none" };
}

export function formatWholeUsd(usd: number, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(usd);
}

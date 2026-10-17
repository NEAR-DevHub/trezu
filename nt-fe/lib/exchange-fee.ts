import Big from "@/lib/big";

/**
 * Total fee, in basis points, that swaps without a stored fee list were
 * charged: the old 0.35% Trezu fee plus the 0.35% NEAR Intents fee.
 */
export const LEGACY_EXCHANGE_FEE_BPS = 70;

interface AppFeeEntry {
    fee?: number | null;
}

/**
 * Total of every fee in a quote's `appFees` (ours plus the NEAR Intents
 * protocol fee), in basis points. `null` when the quote carries no fee list.
 */
export function sumAppFeesBps(
    appFees?: readonly AppFeeEntry[] | null,
): number | null {
    if (!Array.isArray(appFees)) return null;
    return appFees.reduce(
        (total, entry) =>
            total + (typeof entry?.fee === "number" ? entry.fee : 0),
        0,
    );
}

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
 * What the user paid for a swap, in basis points, or `null` when there is no
 * fee to show. A stored fee total is used as is, so past swaps keep the fee
 * they were charged; without one, a swap that did not inject our fee shows
 * nothing and any other (older) swap shows the legacy total.
 */
export function exchangeFeeBps(
    source?: {
        hasAppFee?: boolean | null;
        appFeeBps?: number | null;
    } | null,
): number | null {
    if (typeof source?.appFeeBps === "number") {
        return source.appFeeBps > 0 ? source.appFeeBps : null;
    }
    return quoteHasAppFee(source) ? LEGACY_EXCHANGE_FEE_BPS : null;
}

/** Fee as a percentage value (35 bps is 0.35). */
export function exchangeFeePercent(bps: number): number {
    return bps / 100;
}

export function calculateExchangeFeeAmount(
    amount: string | number,
    bps: number = LEGACY_EXCHANGE_FEE_BPS,
) {
    return Big(amount).mul(bps).div(10_000);
}

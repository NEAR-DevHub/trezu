import { useCallback, useMemo } from "react";
import { useBridgeTokens } from "@/hooks/use-bridge-tokens";

interface PriceAvailabilityResult {
    /** Check if a specific token's price is unavailable (bridge token with zero price) */
    isTokenPriceUnavailable: (tokenId: string, price: number) => boolean;
    /** True if any token in the provided list has an unavailable price */
    anyPriceUnavailable: boolean;
}

/**
 * Checks token prices against bridge token list.
 * Bridge tokens with price=0 are treated as "price loading" (skeleton).
 * Non-bridge tokens with price=0 show $0.00 normally.
 * Only fetches bridge tokens when at least one token has zero price.
 *
 * @param tokens - Array of objects with `id` and `price` fields to check
 */
export function usePriceAvailability(
    tokens: Array<{ id: string; price: number }>,
): PriceAvailabilityResult {
    const hasAnyZeroPrice = useMemo(
        () => tokens.some((t) => t.price <= 0),
        [tokens],
    );

    const { data: bridgeAssets = [], isLoading: isBridgeLoading } =
        useBridgeTokens(hasAnyZeroPrice);

    const bridgeIds = useMemo(
        () => new Set(bridgeAssets.map((a) => a.id.toLowerCase())),
        [bridgeAssets],
    );

    const isTokenPriceUnavailable = useCallback(
        (tokenId: string, price: number): boolean => {
            if (!hasAnyZeroPrice) return false;
            return (
                price <= 0 &&
                (isBridgeLoading || bridgeIds.has(tokenId.toLowerCase()))
            );
        },
        [bridgeIds, isBridgeLoading, hasAnyZeroPrice],
    );

    const anyPriceUnavailable = useMemo(
        () =>
            hasAnyZeroPrice &&
            tokens.some((t) => isTokenPriceUnavailable(t.id, t.price)),
        [tokens, isTokenPriceUnavailable, hasAnyZeroPrice],
    );

    return { isTokenPriceUnavailable, anyPriceUnavailable };
}

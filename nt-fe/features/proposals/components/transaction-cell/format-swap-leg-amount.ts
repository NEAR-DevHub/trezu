import {
    formatRawTokenQuantity,
    formatTokenQuantity,
    groupedDecimalOrNull,
} from "@/lib/amount-format";

/**
 * The amount of one leg, in exactly one of the two shapes a swap proposal
 * stores: `amount` is the raw on-chain integer and needs the token's decimals
 * applied, `amountWithDecimals` is already scaled. The union keeps a caller
 * from passing both (which shape wins?) or neither (a silent zero).
 */
export type SwapLegAmount =
    | { amount: string; amountWithDecimals?: never }
    | { amountWithDecimals: string; amount?: never };

/** Same rounding and token-decimal cap for raw and already-scaled swap legs. */
export function formatSwapLegAmount(
    leg: SwapLegAmount,
    tokenDecimals: number,
): string {
    if (leg.amount !== undefined) {
        return formatRawTokenQuantity(leg.amount, tokenDecimals, {
            rounding: "down",
        }).display;
    }
    return formatTokenQuantity(groupedDecimalOrNull(leg.amountWithDecimals), {
        tokenDecimals,
        rounding: "down",
    }).display;
}

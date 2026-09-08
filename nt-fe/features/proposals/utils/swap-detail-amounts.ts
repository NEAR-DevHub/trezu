import {
    decimalFromBaseUnitsOrNull,
    decimalOrNull,
    groupedDecimalOrNull,
} from "@/lib/amount-format";
import type Big from "@/lib/big";
import { calculateExchangeFeeAmount } from "@/lib/exchange-fee";

/**
 * Exact swap-detail figures. Intents `amountIn` is raw base units; wrap
 * `amountIn` and quote `amountOut` are already decimal. Never pass a
 * grouped display string (`1,000`) into `Big()` — that throws.
 */
export function resolveSwapDetailAmounts({
    isWrapConversion,
    amountInRaw,
    amountOutRaw,
    tokenInDecimals,
    slippage,
}: {
    isWrapConversion: boolean;
    amountInRaw: string;
    amountOutRaw: string;
    tokenInDecimals: number;
    slippage?: string;
}): {
    amountIn: Big | null;
    amountOut: Big | null;
    rate: Big | null;
    minimumReceived: Big | null;
    exchangeFee: Big | null;
} {
    const amountIn = isWrapConversion
        ? groupedDecimalOrNull(amountInRaw)
        : decimalFromBaseUnitsOrNull(amountInRaw, tokenInDecimals);
    const amountOut = groupedDecimalOrNull(amountOutRaw);

    const rate =
        amountIn && amountOut && amountIn.gt(0)
            ? amountOut.div(amountIn)
            : null;

    const slippagePct = decimalOrNull(slippage);
    const minimumReceived =
        amountOut && slippagePct
            ? amountOut.minus(amountOut.mul(slippagePct).div(100))
            : null;

    const exchangeFee =
        !isWrapConversion && amountIn
            ? calculateExchangeFeeAmount(amountIn.toFixed())
            : null;

    return { amountIn, amountOut, rate, minimumReceived, exchangeFee };
}

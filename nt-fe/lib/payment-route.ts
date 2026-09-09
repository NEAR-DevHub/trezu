import type { Token } from "@/components/token-input";
import {
    NEAR_NETWORK_ID,
    NEP141_WRAP_NEAR_ASSET_ID,
} from "@/constants/network-ids";
import { isNearChainFtToken, isNearChainNativeToken } from "@/lib/intents-fee";
import { isNearComNetwork } from "@/lib/intents-network";
import {
    isEthImplicitNearAddress,
    isValidNearAddressFormat,
} from "@/lib/near-validation";
import { stripNearComAddressPrefix } from "@/lib/nearcom-address";
import { formatAssetForIntentsAPI } from "@/lib/oneclick-asset-routing";

export type PaymentTokenClassification = {
    isNearNativeToken: boolean;
    isNearFtToken: boolean;
    tokenForIntentsQuote: Token;
};

/** `"recipient"` = EXACT_OUTPUT; `"total"` = EXACT_INPUT (fees included). */
export type PaymentIntentsAmountMode = "recipient" | "total";

/**
 * Typed amount → recipient gets that exact amount (EXACT_OUTPUT).
 * Max → spend the full source balance, fees included (EXACT_INPUT).
 *
 * Do not gate Max on `isIntentsCrossChainToken`. That helper is false for
 * NEAR-network intents tokens (USDC, wNEAR), which still have 1Click fees —
 * treating Max as EXACT_OUTPUT adds the fee on top of the full balance and
 * falsely reports insufficient funds.
 */
export function paymentIntentsAmountModeForInput(
    source: "typed" | "max",
): PaymentIntentsAmountMode {
    return source === "max" ? "total" : "recipient";
}

/** Bare account for proposals / 1Click. Eth-implicit 0x… is lowercased. */
export function normalizePaymentRecipient(address: string): string {
    const bare = stripNearComAddressPrefix(address.trim());
    return isEthImplicitNearAddress(bare) ? bare.toLowerCase() : bare;
}

export function classifyPaymentToken(token: Token): PaymentTokenClassification {
    const isNearNativeToken = isNearChainNativeToken(token);
    const isNearFtToken = isNearChainFtToken(token);
    const intentsOriginAsset = isNearNativeToken
        ? NEP141_WRAP_NEAR_ASSET_ID
        : isNearFtToken
          ? formatAssetForIntentsAPI(token.address)
          : token.address;

    return {
        isNearNativeToken,
        isNearFtToken,
        tokenForIntentsQuote: {
            ...token,
            address: intentsOriginAsset,
            balanceAssetId: intentsOriginAsset,
        },
    };
}

/**
 * Public liquid NEAR / NEAR FT to a NEAR account (not near.com) goes on-chain
 * directly. Confidential always quotes.
 */
export function shouldUseDirectPaymentTransfer(args: {
    token: Token;
    destinationNetwork?: string;
    recipient: string;
    isConfidential: boolean;
}): boolean {
    if (args.isConfidential || isNearComNetwork(args.destinationNetwork)) {
        return false;
    }
    const { isNearNativeToken, isNearFtToken } = classifyPaymentToken(
        args.token,
    );
    const dest = args.destinationNetwork?.trim().toLowerCase();
    const isNearDestination = !dest || dest === NEAR_NETWORK_ID;
    const bare = stripNearComAddressPrefix(args.recipient).toLowerCase();
    // 0x… is both an EVM address and a NEAR implicit account. Only treat it
    // as NEAR when the receive network is NEAR (otherwise 1Click quotes).
    const isNearAccount = isEthImplicitNearAddress(bare)
        ? isNearDestination
        : isValidNearAddressFormat(bare);
    return isNearAccount && (isNearNativeToken || isNearFtToken);
}

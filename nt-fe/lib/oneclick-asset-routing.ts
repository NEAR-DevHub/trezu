/**
 * Dual-id helpers for 1Click / Intents asset routing (mirrors nt-be
 * `oneclick_asset_routing.rs` + near.com `oneClickAssetRouting.ts`).
 *
 * `1cs_v1:<chain>:…` means deliver on that external chain. Treasuries hold
 * `nep141` / `nep245` balance ids under INTENTS custody — never treat a
 * chain-specific 1cs id as an INTENTS receive asset.
 */

import {
    NEAR_NETWORK_ID,
    NEP141_WRAP_NEAR_ASSET_ID,
} from "@/constants/network-ids";

export const NBTC_BALANCE_ASSET_ID = "nep141:nbtc.bridge.near";
export const ONE_CLICK_BTC_NATIVE_ASSET_ID = "1cs_v1:btc:native:coin";

/**
 * 1Click `/v0/quote` tokenIn/tokenOut ids. Bare NEAR FT contracts must be
 * `nep141:<contract>`; native NEAR is wrap.near. Already-prefixed and `1cs_v1:`
 * ids are left alone.
 */
export function formatAssetForIntentsAPI(tokenAddress: string): string {
    if (tokenAddress.startsWith("nep") || tokenAddress.startsWith("1cs_v1:")) {
        return tokenAddress;
    }
    return tokenAddress === NEAR_NETWORK_ID
        ? NEP141_WRAP_NEAR_ASSET_ID
        : `nep141:${tokenAddress}`;
}

/** True when the asset id is a 1Click Omni (`1cs_v1:`) routing id. */
export function isOneClickRoutingAsset(
    assetId: string | null | undefined,
): boolean {
    return !!assetId?.toLowerCase().startsWith("1cs_v1:");
}

/**
 * A catalog row that spends a different asset than its own id. Covers `1cs_v1:`
 * routes and NEAR on BSC (`nep245` destination, `nep141:wrap.near` balance).
 * nBTC is not this: its row id is the held balance, and the 1cs id is only the quote.
 */
export function isChainDeliveryRoute(network: {
    id: string;
    balanceAssetId?: string;
    quoteAssetId?: string;
}): boolean {
    const id = network.id.toLowerCase();
    const balance = (network.balanceAssetId || network.id).toLowerCase();
    const quote = (network.quoteAssetId || network.id).toLowerCase();
    if (balance !== id) return true;
    return (
        isOneClickRoutingAsset(id) &&
        isOneClickRoutingAsset(quote) &&
        quote !== balance
    );
}

/**
 * Delivery lands on a NEAR account. Swap can quote these because the only
 * recipient it has is the treasury's NEAR account. ZEC on NEAR is this case.
 */
export function deliversOnNearAccount(network: {
    id: string;
    chainId?: string;
    quoteAssetId?: string;
}): boolean {
    const chain = network.chainId?.trim().toLowerCase();
    if (chain === "near:mainnet" || chain === NEAR_NETWORK_ID) return true;
    const quote = (network.quoteAssetId || network.id).toLowerCase();
    return quote.startsWith("1cs_v1:near:");
}

/**
 * Chain delivery that needs a Solana, Hyperliquid, BNB, or other non-NEAR
 * address. Swap has no field for that address, so these rows stay off swap.
 * Send still shows them.
 */
export function isOffNearChainDelivery(network: {
    id: string;
    balanceAssetId?: string;
    quoteAssetId?: string;
    chainId?: string;
}): boolean {
    if (deliversOnNearAccount(network)) return false;
    if (isChainDeliveryRoute(network)) return true;
    return isOneClickRoutingAsset(network.id);
}

/**
 * Decimals of the raw balance / spend asset. Chain-delivery rows keep catalog
 * `decimals` for the destination asset and store the held token's decimals here.
 */
export function holdingDecimals(token: {
    decimals: number;
    balanceDecimals?: number;
}): number {
    return token.balanceDecimals ?? token.decimals;
}

/**
 * Map a catalog/balance id to the 1Click routing id when they differ
 * (currently only nBTC → native BTC).
 */
export function quoteAssetIdForBalance(balanceAssetId: string): string {
    if (balanceAssetId === NBTC_BALANCE_ASSET_ID) {
        return ONE_CLICK_BTC_NATIVE_ASSET_ID;
    }
    return balanceAssetId;
}

/** Map a 1Click / history routing id back to the Intents balance id. */
export function balanceAssetIdFromQuote(quoteOrHistoryId: string): string {
    if (quoteOrHistoryId === ONE_CLICK_BTC_NATIVE_ASSET_ID) {
        return NBTC_BALANCE_ASSET_ID;
    }
    return quoteOrHistoryId;
}

export type QuoteAssetNetworkLookup = {
    id: string;
    quoteAssetId?: string;
    balanceAssetId?: string;
};

export type QuoteAssetCatalogAsset = {
    networks: QuoteAssetNetworkLookup[];
};

/**
 * Resolve the 1Click destination asset for a payment/withdraw network pick.
 * Prefers the network's `quoteAssetId` (e.g. BTC native) over the balance id.
 */
export function findQuoteAssetIdForDestination(
    bridgeAssets: QuoteAssetCatalogAsset[],
    networkId: string | undefined | null,
): string | undefined {
    if (!networkId) return undefined;
    for (const asset of bridgeAssets) {
        const network = asset.networks.find((n) => n.id === networkId);
        if (network) {
            return network.quoteAssetId || network.balanceAssetId || network.id;
        }
    }
    return networkId;
}

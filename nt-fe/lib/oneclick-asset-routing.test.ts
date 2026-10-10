import { describe, expect, it } from "bun:test";
import {
    balanceAssetIdFromQuote,
    findQuoteAssetIdForDestination,
    formatAssetForIntentsAPI,
    holdingDecimals,
    isChainDeliveryRoute,
    isNearAccountDeliveryQuote,
    isOffNearChainDelivery,
    isOneClickRoutingAsset,
    NBTC_BALANCE_ASSET_ID,
    ONE_CLICK_BTC_NATIVE_ASSET_ID,
    quoteAssetIdForBalance,
} from "./oneclick-asset-routing";

describe("oneclick-asset-routing", () => {
    it("detects 1cs routing ids", () => {
        expect(isOneClickRoutingAsset("1cs_v1:starknet:erc20:0xabc")).toBe(
            true,
        );
        expect(isOneClickRoutingAsset("nep141:zec.omft.near")).toBe(false);
    });

    it("treats a 1cs row with a different holdable sibling as chain delivery", () => {
        expect(
            isChainDeliveryRoute({
                id: "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG",
                balanceAssetId: "nep141:wrap.near",
                quoteAssetId:
                    "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG",
            }),
        ).toBe(true);
        expect(
            isChainDeliveryRoute({
                id: NBTC_BALANCE_ASSET_ID,
                balanceAssetId: NBTC_BALANCE_ASSET_ID,
                quoteAssetId: ONE_CLICK_BTC_NATIVE_ASSET_ID,
            }),
        ).toBe(false);
        expect(holdingDecimals({ decimals: 9, balanceDecimals: 24 })).toBe(24);
        expect(holdingDecimals({ decimals: 24 })).toBe(24);
        expect(
            isChainDeliveryRoute({
                id: "nep245:v2_1.omni.hot.tg:56_SZzgw3HSudhZcTwPWUTi2RJB19t",
                balanceAssetId: "nep141:wrap.near",
                quoteAssetId:
                    "nep245:v2_1.omni.hot.tg:56_SZzgw3HSudhZcTwPWUTi2RJB19t",
            }),
        ).toBe(true);
    });

    it("hides off-NEAR chain delivery from swap and keeps ZEC on NEAR", () => {
        expect(
            isOffNearChainDelivery({
                id: "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG",
                balanceAssetId: "nep141:wrap.near",
                quoteAssetId:
                    "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG",
                chainId: "sol:mainnet",
            }),
        ).toBe(true);
        expect(
            isOffNearChainDelivery({
                id: "nep245:v2_1.omni.hot.tg:56_SZzgw3HSudhZcTwPWUTi2RJB19t",
                balanceAssetId: "nep141:wrap.near",
                quoteAssetId:
                    "nep245:v2_1.omni.hot.tg:56_SZzgw3HSudhZcTwPWUTi2RJB19t",
                chainId: "eth:56",
            }),
        ).toBe(true);
        expect(
            isOffNearChainDelivery({
                id: "1cs_v1:near:nep141:zec.omft.near",
                balanceAssetId: "nep141:zec.omft.near",
                quoteAssetId: "1cs_v1:near:nep141:zec.omft.near",
                chainId: "near:mainnet",
            }),
        ).toBe(false);
        expect(
            isOffNearChainDelivery({
                id: NBTC_BALANCE_ASSET_ID,
                balanceAssetId: NBTC_BALANCE_ASSET_ID,
                quoteAssetId: ONE_CLICK_BTC_NATIVE_ASSET_ID,
                chainId: "btc:mainnet",
            }),
        ).toBe(false);
        expect(
            isOffNearChainDelivery({
                id: "nep141:wrap.near",
                balanceAssetId: "nep141:wrap.near",
                quoteAssetId: "nep141:wrap.near",
                chainId: "near:mainnet",
            }),
        ).toBe(false);
    });

    it("delivers on-chain only for a NEAR 1cs quote, not nBTC", () => {
        expect(
            isNearAccountDeliveryQuote(
                "1cs_v1:near:nep141:zec.omft.near",
                "nep141:zec.omft.near",
            ),
        ).toBe(true);
        expect(
            isNearAccountDeliveryQuote(
                ONE_CLICK_BTC_NATIVE_ASSET_ID,
                NBTC_BALANCE_ASSET_ID,
            ),
        ).toBe(false);
        expect(
            isNearAccountDeliveryQuote(
                "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG",
                "nep141:wrap.near",
            ),
        ).toBe(false);
    });

    it("maps nBTC balance ↔ native BTC quote", () => {
        expect(quoteAssetIdForBalance(NBTC_BALANCE_ASSET_ID)).toBe(
            ONE_CLICK_BTC_NATIVE_ASSET_ID,
        );
        expect(balanceAssetIdFromQuote(ONE_CLICK_BTC_NATIVE_ASSET_ID)).toBe(
            NBTC_BALANCE_ASSET_ID,
        );
    });

    it("prefixes bare NEAR FT contracts for 1Click tokenIn", () => {
        expect(
            formatAssetForIntentsAPI(
                "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
            ),
        ).toBe(
            "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
        );
        expect(
            formatAssetForIntentsAPI(
                "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
            ),
        ).toBe(
            "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
        );
        expect(formatAssetForIntentsAPI("near")).toBe("nep141:wrap.near");
        expect(formatAssetForIntentsAPI(ONE_CLICK_BTC_NATIVE_ASSET_ID)).toBe(
            ONE_CLICK_BTC_NATIVE_ASSET_ID,
        );
    });

    it("resolves destination quote id from the selected receiver network", () => {
        const assets = [
            {
                networks: [
                    {
                        id: NBTC_BALANCE_ASSET_ID,
                        balanceAssetId: NBTC_BALANCE_ASSET_ID,
                        quoteAssetId: ONE_CLICK_BTC_NATIVE_ASSET_ID,
                    },
                    {
                        id: "nep141:zec.omft.near",
                        balanceAssetId: "nep141:zec.omft.near",
                        quoteAssetId: "nep141:zec.omft.near",
                    },
                ],
            },
        ];
        expect(
            findQuoteAssetIdForDestination(assets, NBTC_BALANCE_ASSET_ID),
        ).toBe(ONE_CLICK_BTC_NATIVE_ASSET_ID);
        expect(
            findQuoteAssetIdForDestination(assets, "nep141:zec.omft.near"),
        ).toBe("nep141:zec.omft.near");
    });
});

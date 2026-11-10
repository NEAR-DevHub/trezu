import { describe, expect, it } from "bun:test";
import type { BridgeAsset } from "@/hooks/use-bridge-tokens";
import {
    resolveBridgeChainId,
    resolveBridgeQuoteAssetId,
} from "./deposit-transfer-resolve";

const assets = [
    {
        id: "usdc",
        symbol: "USDC",
        name: "USD Coin",
        icon: "",
        networks: [
            {
                id: "nep141:base-usdc.omft.near",
                name: "base",
                symbol: "USDC",
                chainId: "eth:8453",
                decimals: 6,
                quoteAssetId: "nep141:base-usdc.omft.near",
            },
            {
                id: "nep141:nbtc.bridge.near",
                name: "bitcoin",
                symbol: "BTC",
                chainId: "btc:mainnet",
                decimals: 8,
                quoteAssetId: "1cs_v1:btc:native",
            },
        ],
    },
] as BridgeAsset[];

describe("resolveBridgeQuoteAssetId", () => {
    it("returns the routing id the deposit modal sends", () => {
        expect(
            resolveBridgeQuoteAssetId(assets, "nep141:nbtc.bridge.near"),
        ).toBe("1cs_v1:btc:native");
        expect(
            resolveBridgeQuoteAssetId(assets, "nep141:base-usdc.omft.near"),
        ).toBe("nep141:base-usdc.omft.near");
    });

    it("falls back to the network id when the catalog lacks the row", () => {
        expect(resolveBridgeQuoteAssetId(assets, "nep141:unknown.near")).toBe(
            "nep141:unknown.near",
        );
        expect(resolveBridgeQuoteAssetId(assets, "")).toBeNull();
    });

    it("keeps chain resolution unchanged", () => {
        expect(resolveBridgeChainId(assets, "nep141:nbtc.bridge.near")).toBe(
            "btc:mainnet",
        );
    });
});

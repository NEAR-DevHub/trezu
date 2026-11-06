import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NEAR_COM_NETWORK_ID } from "@/constants/network-ids";
import type { BridgeAsset } from "@/hooks/use-bridge-tokens";
import {
    buildDepositAssetCatalog,
    INTERNAL_ANY_TOKEN_ASSET_ID,
    isDepositOriginSupported,
    USDC_HYPERLIQUID_QUOTE_ID,
} from "./deposit-asset-catalog";

const USDC_HYPERLIQUID =
    "1cs_v1:hypercore:erc20:0xb88339CB7199b77E23DB6E890353E22632Ba630f";

describe("isDepositOriginSupported", () => {
    it("blocks USDC on Hyperliquid for public and confidential deposit", () => {
        expect(
            isDepositOriginSupported({
                id: USDC_HYPERLIQUID,
                quoteAssetId: USDC_HYPERLIQUID,
            }),
        ).toBe(false);
    });

    it("matches the USDC-on-Hyperliquid id in the vendored catalog", () => {
        const catalog = JSON.parse(
            readFileSync(
                join(
                    import.meta.dir,
                    "../../../../../../../nt-be/data/nearcom-tokens.json",
                ),
                "utf8",
            ),
        ) as {
            tokens: { groupedTokens?: { defuseAssetId: string }[] }[];
        };
        const ids = catalog.tokens.flatMap(
            (token) =>
                token.groupedTokens?.map((grouped) => grouped.defuseAssetId) ??
                [],
        );
        const catalogId = ids.find((id) =>
            id.toLowerCase().includes("hypercore:erc20:0xb88339cb"),
        );
        expect(catalogId?.toLowerCase()).toBe(USDC_HYPERLIQUID_QUOTE_ID);
    });

    it("keeps other Hyperliquid and USDC routes depositable", () => {
        expect(
            isDepositOriginSupported({
                id: "1cs_v1:hypercore:hip1:0x20b8c9d2f022ffd2aea4f7962b7b1d8b",
                quoteAssetId:
                    "1cs_v1:hypercore:hip1:0x20b8c9d2f022ffd2aea4f7962b7b1d8b",
            }),
        ).toBe(true);
        expect(
            isDepositOriginSupported({
                id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
            }),
        ).toBe(true);
    });
});

describe("buildDepositAssetCatalog internal network", () => {
    const usdc: BridgeAsset = {
        id: "nep141:usdc.near",
        symbol: "USDC",
        name: "USD Coin",
        icon: "usdc.svg",
        networks: [
            {
                id: "nep141:usdc.near",
                name: "near",
                symbol: "USDC",
                chainId: "near:mainnet",
                decimals: 6,
                quoteAssetId: "nep141:usdc.near",
                publicDepositSupported: true,
            },
            {
                id: "nep141:base-usdc.omft.near",
                name: "base",
                symbol: "USDC",
                chainId: "eth:8453",
                decimals: 6,
                quoteAssetId: "nep141:base-usdc.omft.near",
                publicDepositSupported: true,
            },
        ],
    } as BridgeAsset;
    const labels = {
        popularAssets: "Popular",
        yourAssets: "Yours",
        otherAssets: "Other",
    };

    it("puts near.com first under every asset for confidential treasuries", () => {
        const catalog = buildDepositAssetCatalog({
            bridgeAssets: [usdc],
            aggregatedTreasuryTokens: [],
            popularAssets: [],
            isConfidential: true,
            otherAssetName: "Other",
            internalAnyTokenName: "Any token",
            labels,
        });
        const networks = catalog.assetNetworksMap.get(usdc.id) ?? [];
        expect(networks[0]?.id).toBe(NEAR_COM_NETWORK_ID);
        expect(networks.map((network) => network.id)).toEqual([
            NEAR_COM_NETWORK_ID,
            "nep141:usdc.near",
            "nep141:base-usdc.omft.near",
        ]);
        expect(
            catalog.assetNetworksMap
                .get(INTERNAL_ANY_TOKEN_ASSET_ID)
                ?.map((network) => network.id),
        ).toEqual([NEAR_COM_NETWORK_ID]);
    });

    it("leaves public treasuries without the internal network", () => {
        const catalog = buildDepositAssetCatalog({
            bridgeAssets: [usdc],
            aggregatedTreasuryTokens: [],
            popularAssets: [],
            isConfidential: false,
            otherAssetName: "Other",
            labels,
        });
        const ids = (catalog.assetNetworksMap.get(usdc.id) ?? []).map(
            (network) => network.id,
        );
        expect(ids).not.toContain(NEAR_COM_NETWORK_ID);
        expect(catalog.assetNetworksMap.has(INTERNAL_ANY_TOKEN_ASSET_ID)).toBe(
            false,
        );
    });
});

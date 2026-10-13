import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
    USDC_HYPERLIQUID_QUOTE_ID,
    isDepositOriginSupported,
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

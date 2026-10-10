import { describe, expect, it } from "bun:test";
import { isDepositOriginSupported } from "./deposit-asset-catalog";

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

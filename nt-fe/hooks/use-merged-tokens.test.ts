import { describe, expect, it } from "bun:test";
import type { NetworkAsset } from "@/hooks/use-assets";
import Big from "@/lib/big";
import {
    type MergedNetwork,
    overlayChainDeliveryHoldings,
} from "./use-merged-tokens";

const SOLANA_NEAR = "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG";

const holding = {
    availableBalanceRaw: "333187681653139407244785",
    availableBalanceUSD: 1.25,
    price: 3.7,
    decimals: 24,
    balance: { type: "Standard", total: Big(1), locked: Big(0) },
} as NetworkAsset;

const chainRow: MergedNetwork = {
    id: SOLANA_NEAR,
    name: "solana",
    symbol: "NEAR",
    chainIcons: null,
    chainId: "sol:mainnet",
    decimals: 9,
    residency: "Intents",
    balanceAssetId: "nep141:wrap.near",
    quoteAssetId: SOLANA_NEAR,
};

describe("overlayChainDeliveryHoldings", () => {
    it("copies the held sibling onto a chain-delivery row", () => {
        const [overlaid] = overlayChainDeliveryHoldings(
            [chainRow],
            new Map([["nep141:wrap.near", holding]]),
        );
        expect(overlaid.balance).toBe(holding.availableBalanceRaw);
        expect(overlaid.balanceUSD).toBe(1.25);
        expect(overlaid.balanceDecimals).toBe(24);
        expect(overlaid.decimals).toBe(9);
        expect(overlaid.quoteAssetId).toBe(SOLANA_NEAR);
    });

    it("leaves a normal balance row alone", () => {
        const wrap: MergedNetwork = {
            ...chainRow,
            id: "nep141:wrap.near",
            decimals: 24,
            balance: "1",
            balanceAssetId: "nep141:wrap.near",
            quoteAssetId: "nep141:wrap.near",
        };
        const [overlaid] = overlayChainDeliveryHoldings(
            [wrap],
            new Map([["nep141:wrap.near", holding]]),
        );
        expect(overlaid.balance).toBe("1");
        expect(overlaid.balanceDecimals).toBeUndefined();
    });
});

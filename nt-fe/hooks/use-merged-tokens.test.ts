import { describe, expect, it } from "bun:test";
import type { NetworkAsset } from "@/hooks/use-assets";
import type { BridgeNetwork } from "@/hooks/use-bridge-tokens";
import Big from "@/lib/big";
import { isChainDeliveryRoute } from "@/lib/oneclick-asset-routing";
import {
    type MergedNetwork,
    mapHeldChainDeliveryNetwork,
    overlayChainDeliveryHoldings,
} from "./use-merged-tokens";

const SOLANA_NEAR =
    "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG";

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

describe("mapHeldChainDeliveryNetwork", () => {
    const ZEC_ON_NEAR = "1cs_v1:near:nep141:zec.omft.near";
    const zecOnNear = {
        id: ZEC_ON_NEAR,
        name: "near",
        symbol: "ZEC",
        chainIcons: null,
        chainId: "near:mainnet",
        decimals: 8,
        balanceAssetId: "nep141:zec.omft.near",
        quoteAssetId: ZEC_ON_NEAR,
    } as unknown as BridgeNetwork;
    const zecHolding = {
        id: "zec",
        contractId: ZEC_ON_NEAR,
        network: "near",
        symbol: "ZEC",
        residency: "Intents",
        availableBalanceRaw: "100000",
        availableBalanceUSD: 0.4,
        price: 400,
        decimals: 8,
        balance: { type: "Standard", total: Big(1), locked: Big(0) },
    } as unknown as NetworkAsset;

    it("spends a confidential route holding under its own id", () => {
        const held = mapHeldChainDeliveryNetwork(zecOnNear, zecHolding);
        expect(held.heldRoute).toBe(true);
        expect(held.balance).toBe("100000");
        expect(held.balanceAssetId).toBe(ZEC_ON_NEAR);
        expect(held.quoteAssetId).toBe(ZEC_ON_NEAR);
        expect(held.name).toBe("near");
        expect(isChainDeliveryRoute(held)).toBe(false);
    });

    it("labels a Solana holding by its chain, not near", () => {
        const solanaId =
            "1cs_v1:sol:spl:3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG";
        const held = mapHeldChainDeliveryNetwork(
            {
                ...zecOnNear,
                id: solanaId,
                name: "solana",
                chainId: "sol:mainnet",
                quoteAssetId: solanaId,
            },
            { ...zecHolding, contractId: solanaId, network: "near" },
        );
        expect(held.name).toBe("solana");
        expect(held.balanceAssetId).toBe(solanaId);
        expect(held.quoteAssetId).toBe(solanaId);
    });

    it("leaves the overlay off a held route", () => {
        const held = mapHeldChainDeliveryNetwork(zecOnNear, zecHolding);
        const [overlaid] = overlayChainDeliveryHoldings(
            [held],
            new Map([["nep141:zec.omft.near", holding]]),
        );
        expect(overlaid.balance).toBe("100000");
    });
});

import { describe, expect, it } from "bun:test";
import {
    buildStockIndex,
    findStock,
    isStockMarketOpen,
    nextStockMarketOpen,
    readStockRegionCookie,
} from "./stock-restrictions";

const at = (iso: string) => new Date(iso);

describe("isStockMarketOpen", () => {
    it("follows the Sunday 20:00 to Friday 19:59 ET window in summer", () => {
        expect(isStockMarketOpen(at("2026-07-12T23:59:00Z"))).toBe(false);
        expect(isStockMarketOpen(at("2026-07-13T00:00:00Z"))).toBe(true);
        expect(isStockMarketOpen(at("2026-07-15T12:00:00Z"))).toBe(true);
        expect(isStockMarketOpen(at("2026-07-17T23:58:00Z"))).toBe(true);
        expect(isStockMarketOpen(at("2026-07-17T23:59:00Z"))).toBe(false);
        expect(isStockMarketOpen(at("2026-07-18T15:00:00Z"))).toBe(false);
    });

    it("shifts by an hour in winter", () => {
        expect(isStockMarketOpen(at("2026-01-12T00:59:00Z"))).toBe(false);
        expect(isStockMarketOpen(at("2026-01-12T01:00:00Z"))).toBe(true);
    });
});

describe("nextStockMarketOpen", () => {
    it("is null while open", () => {
        expect(nextStockMarketOpen(at("2026-07-15T12:00:00Z"))).toBeNull();
    });

    it("returns Sunday 20:00 ET during the weekend", () => {
        expect(
            nextStockMarketOpen(at("2026-10-10T05:30:00Z"))?.toISOString(),
        ).toBe("2026-10-12T00:00:00.000Z");
        expect(
            nextStockMarketOpen(at("2026-01-10T12:00:00Z"))?.toISOString(),
        ).toBe("2026-01-12T01:00:00.000Z");
    });
});

describe("stock index", () => {
    const index = buildStockIndex([
        {
            symbol: "GLD",
            assetClass: "stock",
            marketHoursOnly: true,
            networks: [
                {
                    id: "nep141:bnb-0xabc.omdep.near",
                    balanceAssetId: "nep141:bnb-0xabc.omdep.near",
                },
            ],
        },
        {
            symbol: "USDC",
            networks: [{ id: "nep141:usdc.near" }],
        },
    ]);

    it("matches stock ids with or without the nep141 prefix", () => {
        expect(findStock(index, "nep141:bnb-0xABC.omdep.near")).toEqual({
            symbol: "GLD",
            marketHoursOnly: true,
        });
        expect(findStock(index, "bnb-0xabc.omdep.near")?.symbol).toBe("GLD");
    });

    it("ignores non-stock assets", () => {
        expect(findStock(index, "nep141:usdc.near")).toBeUndefined();
        expect(findStock(index, undefined)).toBeUndefined();
    });
});

describe("readStockRegionCookie", () => {
    it("reads the flag among other cookies", () => {
        expect(readStockRegionCookie("a=1; nearcom_stocks_restricted=1")).toBe(
            true,
        );
        expect(readStockRegionCookie("nearcom_stocks_restricted=0")).toBe(
            false,
        );
        expect(readStockRegionCookie("")).toBe(false);
    });
});

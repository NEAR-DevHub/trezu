"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useFormatDate } from "@/components/formatted-date";
import { getSwapProposalAssetIds } from "@/features/proposals/utils/proposal-utils";
import { useTokenCatalog } from "@/hooks/use-bridge-tokens";
import { useTreasury } from "@/hooks/use-treasury";
import type { Proposal } from "@/lib/proposals-api";
import {
    buildStockIndex,
    findStock,
    isStockMarketOpen,
    nextStockMarketOpen,
    readStockRegionCookie,
} from "@/lib/stock-restrictions";

const MINUTE_MS = 60 * 1000;

const subscribeNever = () => () => {};

/** True when this visitor is in a country where near.com hides stocks. */
export function useStockRegionRestricted(): boolean {
    return useSyncExternalStore(
        subscribeNever,
        () => readStockRegionCookie(document.cookie),
        () => false,
    );
}

/** Stock market state, re-checked every minute. */
export function useStockMarketClock(): {
    isOpen: boolean;
    reopensAt: Date | null;
} {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), MINUTE_MS);
        return () => clearInterval(id);
    }, []);
    return useMemo(() => {
        const date = new Date(now);
        return {
            isOpen: isStockMarketOpen(date),
            reopensAt: nextStockMarketOpen(date),
        };
    }, [now]);
}

export interface StockApproveBlock {
    anyBlocked: boolean;
    blockedCount: number;
    /** Why approval is blocked, ready to show. */
    message: string | null;
}

/**
 * Stock swaps this member can't approve right now: any of them when the
 * member is in a restricted region, and swaps of a market-hours stock while
 * the stock market is closed. Rejection is never blocked.
 */
export function useStockApproveBlock(proposals: Proposal[]): StockApproveBlock {
    const t = useTranslations("stockRestrictions");
    const formatDate = useFormatDate();
    const { treasuryId } = useTreasury();
    const regionRestricted = useStockRegionRestricted();
    const market = useStockMarketClock();

    const swaps = useMemo(
        () =>
            proposals.flatMap((proposal) => {
                const assets = getSwapProposalAssetIds(
                    proposal,
                    treasuryId ?? undefined,
                );
                return assets ? [assets] : [];
            }),
        [proposals, treasuryId],
    );
    const { data: catalog } = useTokenCatalog({
        kind: "swap-stocks",
        enabled: swaps.length > 0,
    });
    const stockIndex = useMemo(() => buildStockIndex(catalog ?? []), [catalog]);

    return useMemo(() => {
        let regionCount = 0;
        let marketClosedCount = 0;
        for (const assets of swaps) {
            const stocks = [
                findStock(stockIndex, assets.tokenIn),
                findStock(stockIndex, assets.tokenOut),
            ].filter((stock) => stock !== undefined);
            if (stocks.length === 0) continue;
            if (regionRestricted) {
                regionCount += 1;
            } else if (
                !market.isOpen &&
                stocks.some((stock) => stock.marketHoursOnly)
            ) {
                marketClosedCount += 1;
            }
        }

        const blockedCount = regionCount + marketClosedCount;
        let message: string | null = null;
        if (regionCount > 0) {
            message = t("approveRegion", { count: regionCount });
        } else if (marketClosedCount > 0) {
            message = market.reopensAt
                ? t("approveMarketClosed", {
                      count: marketClosedCount,
                      reopensAt: formatDate(market.reopensAt),
                  })
                : t("approveMarketClosedNoTime", {
                      count: marketClosedCount,
                  });
        }
        return { anyBlocked: blockedCount > 0, blockedCount, message };
    }, [swaps, stockIndex, regionRestricted, market, t, formatDate]);
}

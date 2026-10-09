"use client";

import { useIsFetching } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTreasury } from "@/hooks/use-treasury";
import { useRefreshConfidentialHistory } from "@/hooks/use-treasury-queries";

export const CONFIDENTIAL_HISTORY_AUTO_REFRESH_COOLDOWN_MS = 60_000;

/** Per-treasury trigger timestamps, so a refresh runs at most once per cooldown. */
export class AutoRefreshCooldown {
    private readonly lastTriggeredAt = new Map<string, number>();

    constructor(private readonly cooldownMs: number) {}

    tryAcquire(accountId: string, now: number = Date.now()): boolean {
        const last = this.lastTriggeredAt.get(accountId);
        if (last !== undefined && now - last < this.cooldownMs) {
            return false;
        }
        this.lastTriggeredAt.set(accountId, now);
        return true;
    }
}

// Module scoped so moving between dashboard pages keeps the cooldown.
const cooldown = new AutoRefreshCooldown(
    CONFIDENTIAL_HISTORY_AUTO_REFRESH_COOLDOWN_MS,
);

/**
 * The backend drains a confidential treasury's 1Click history on a schedule
 * that slows to hourly once the treasury has been inactive for a while, so a
 * fresh deposit can stay hidden for up to an hour. Whenever the dashboard
 * queries history (recent activity or the balance chart), also fire the same
 * refresh the dashboard refresh button runs, at most once per cooldown per
 * treasury. A successful refresh invalidates the history queries through the
 * mutation itself.
 */
export function useConfidentialHistoryAutoRefresh() {
    const { treasuryId, isConfidential, isGuestTreasury } = useTreasury();
    const enabled = isConfidential && !isGuestTreasury;
    const { mutate: refreshHistory, isPending } =
        useRefreshConfidentialHistory(treasuryId);
    const fetchingRecentActivity = useIsFetching({
        queryKey: ["recentActivity", treasuryId],
    });
    const fetchingBalanceChart = useIsFetching({
        queryKey: ["balanceChart", treasuryId],
    });
    const isFetchingHistory = fetchingRecentActivity + fetchingBalanceChart > 0;

    useEffect(() => {
        if (!enabled || !treasuryId || !isFetchingHistory || isPending) {
            return;
        }
        if (!cooldown.tryAcquire(treasuryId)) {
            return;
        }
        refreshHistory();
    }, [enabled, treasuryId, isFetchingHistory, isPending, refreshHistory]);
}

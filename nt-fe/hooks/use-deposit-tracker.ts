"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import {
    fetchDepositTracker,
    type TrackedDeposit,
    type TrackedDepositStatus,
} from "@/lib/bridge-api";

const POLL_MS = 2_000;

const TERMINAL_STATUSES: ReadonlySet<TrackedDepositStatus> = new Set([
    "ledger_confirmed",
    "failed",
]);

/**
 * Poll the backend deposit tracker while a deposit address is on screen.
 * SSE `treasury_projection_updated` also invalidates this key, so the poll is
 * only a fallback for missed events.
 *
 * Public addresses are reusable, so the view is scoped to this showing:
 * deposits still in flight count from `shownAtMs - inFlightLookbackMs` (a
 * transfer sent just before opening the page), while completed or failed
 * deposits count only when detected after `shownAtMs`. Reopening the page
 * after a deposit settled therefore starts clean. Quote-scoped
 * (confidential) addresses are one-time, so no time filter applies.
 */
export function useDepositTracker(options: {
    enabled: boolean;
    accountId: string | null | undefined;
    chain?: string | null;
    quoteDepositAddress?: string | null;
    shownAtMs?: number | null;
    inFlightLookbackMs?: number;
}): { deposits: TrackedDeposit[]; hasFetched: boolean } {
    const {
        enabled,
        accountId,
        chain,
        quoteDepositAddress,
        shownAtMs,
        inFlightLookbackMs = 0,
    } = options;
    const scopeReady = !!quoteDepositAddress || !!chain;

    const query = useQuery({
        queryKey: [
            "depositTracker",
            accountId,
            quoteDepositAddress ?? null,
            chain ?? null,
        ],
        queryFn: () => {
            if (!accountId) {
                throw new Error("accountId is required");
            }
            return fetchDepositTracker(accountId, {
                chain,
                quoteDepositAddress,
            });
        },
        enabled: enabled && !!accountId && scopeReady,
        staleTime: POLL_MS,
        refetchInterval: POLL_MS,
        retry: 1,
    });

    // A row shown once stays visible for this showing, so a deposit watched
    // from "detected" still flips to "received" instead of disappearing.
    // The memory belongs to one showing of one scope: a new stamp, chain,
    // quote, or treasury starts with nothing remembered.
    const showingKey = [
        accountId ?? "",
        quoteDepositAddress ?? "",
        chain ?? "",
        shownAtMs ?? "",
    ].join("|");
    const shown = useRef({ key: showingKey, ids: new Set<number>() });
    if (shown.current.key !== showingKey) {
        shown.current = { key: showingKey, ids: new Set<number>() };
    }
    const shownIds = shown.current.ids;
    const deposits = (query.data?.deposits ?? []).filter((deposit) => {
        if (quoteDepositAddress) return true;
        // No stamp yet (first render, or not on the address step): the
        // showing has not started, so nothing is visible or remembered.
        if (shownAtMs == null) return false;
        if (shownIds.has(deposit.id)) return true;
        const detected = Date.parse(deposit.detectedAt);
        const visible =
            !Number.isFinite(detected) ||
            detected >=
                (TERMINAL_STATUSES.has(deposit.status)
                    ? shownAtMs
                    : shownAtMs - inFlightLookbackMs);
        if (visible) shownIds.add(deposit.id);
        return visible;
    });

    return { deposits, hasFetched: query.isFetched };
}

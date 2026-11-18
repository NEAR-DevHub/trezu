"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
    APP_EVENT_NAMES,
    type AppEventScope,
    handleAppEvent,
    invalidateTreasuryScopedQueries,
    parseAppEvent,
} from "@/lib/app-events";
import { recoverPendingSubmissions } from "@/lib/relay-submissions";

function buildAppEventsUrl(scope: AppEventScope) {
    const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_API_BASE;
    if (!backendBaseUrl || !scope.treasuryId) {
        return null;
    }

    const url = new URL("/api/app-events", backendBaseUrl);
    url.searchParams.set("accountId", scope.treasuryId);
    return url.toString();
}

export function AppEventsProvider({ scope }: { scope: AppEventScope }) {
    const queryClient = useQueryClient();
    const treasuryId = scope.treasuryId;

    useEffect(() => {
        const activeScope: AppEventScope = { treasuryId };
        const url = buildAppEventsUrl(activeScope);
        if (!url) {
            return;
        }

        const eventSource = new EventSource(url, {
            withCredentials: true,
        });

        const handleMessage = (message: MessageEvent<string>) => {
            const event = parseAppEvent(message.data);
            if (!event) {
                return;
            }

            void handleAppEvent(queryClient, event, activeScope);
        };

        // Events emitted while the stream was down (server restart, network
        // blip) are never replayed, so every reconnect catches up with one
        // blanket invalidation. The first open is skipped: initial page
        // queries are fetching fresh data already. Pending relay submissions
        // are fetched on every open, the first one included: that is the
        // page-mount recovery after a refresh.
        let hasConnected = false;
        const handleOpen = () => {
            if (treasuryId) {
                void recoverPendingSubmissions(treasuryId);
            }
            if (!hasConnected) {
                hasConnected = true;
                return;
            }
            if (treasuryId) {
                void invalidateTreasuryScopedQueries(queryClient, treasuryId);
            }
        };
        eventSource.addEventListener("open", handleOpen);

        // A background tab may have had its stream throttled or dropped
        // without a reconnect; coming back to the foreground re-reads what
        // is still pending.
        const handleVisibility = () => {
            if (document.visibilityState === "visible" && treasuryId) {
                void recoverPendingSubmissions(treasuryId);
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);

        for (const eventName of APP_EVENT_NAMES) {
            eventSource.addEventListener(eventName, handleMessage);
        }

        return () => {
            document.removeEventListener("visibilitychange", handleVisibility);
            eventSource.removeEventListener("open", handleOpen);
            for (const eventName of APP_EVENT_NAMES) {
                eventSource.removeEventListener(eventName, handleMessage);
            }
            eventSource.close();
        };
    }, [queryClient, treasuryId]);

    return null;
}

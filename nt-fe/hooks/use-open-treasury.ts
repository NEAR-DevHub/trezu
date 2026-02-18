import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openTreasury, OpenTreasuryResponse } from "@/lib/api";

// Re-trigger dirty monitor if last call was more than 30 seconds ago
const DIRTY_RETRIGGER_INTERVAL_MS = 30_000;

/**
 * Hook to open/register a treasury for monitoring
 * Handles automatic registration when a treasury is visited
 * Provides access to credits information and registration status
 *
 * Features:
 * - Triggers dirty monitor on first visit and re-triggers after 30s cooldown
 * - Caches response in React Query for access across components
 * - Returns mutation for manual triggering if needed
 */
export function useOpenTreasury() {
    const queryClient = useQueryClient();

    // Track last open time per treasury to throttle API calls
    const lastOpenedAt = useRef<Map<string, number>>(new Map());

    const mutation = useMutation({
        mutationFn: (treasuryId: string) => openTreasury(treasuryId),
        onSuccess: (data, treasuryId) => {
            if (data) {
                // Cache the response for other components to access
                queryClient.setQueryData(["treasuryCredits", treasuryId], data);
            }
        },
    });

    // Use a ref for mutate to keep `open` callback stable across renders
    const mutateRef = useRef(mutation.mutate);
    mutateRef.current = mutation.mutate;

    /**
     * Open/register a treasury, triggering the dirty monitor for fresh data.
     * Throttled to at most once per 30 seconds per treasury to avoid
     * hammering the endpoint on re-renders.
     */
    const open = useCallback((treasuryId: string | undefined) => {
        if (!treasuryId) return;

        const now = Date.now();
        const lastOpened = lastOpenedAt.current.get(treasuryId) ?? 0;

        if (now - lastOpened > DIRTY_RETRIGGER_INTERVAL_MS) {
            lastOpenedAt.current.set(treasuryId, now);
            mutateRef.current(treasuryId);
        }
    }, []);

    /**
     * Get cached credits data for a treasury
     * Returns null if not yet fetched
     */
    const getCredits = useCallback(
        (treasuryId: string | undefined): OpenTreasuryResponse | null => {
            if (!treasuryId) return null;
            return (
                queryClient.getQueryData<OpenTreasuryResponse>([
                    "treasuryCredits",
                    treasuryId,
                ]) ?? null
            );
        },
        [queryClient],
    );

    return {
        /** Open/register a treasury (safe to call multiple times) */
        open,
        /** Get cached credits for a treasury */
        getCredits,
        /** The underlying mutation for advanced usage */
        mutation,
        /** Whether a registration is currently in progress */
        isLoading: mutation.isPending,
        /** The last registration response */
        data: mutation.data,
        /** Whether the last registration was for a new treasury */
        isNewRegistration: mutation.data?.isNewRegistration ?? false,
    };
}

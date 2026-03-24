import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openTreasury, OpenTreasuryResponse } from "@/lib/api";

/**
 * Hook to open/register a treasury for monitoring
 * Handles automatic registration when a treasury is visited
 * Provides access to credits information and registration status
 *
 * Features:
 * - Triggers dirty monitor once per treasury change
 * - Caches response in React Query for access across components
 * - Returns mutation for manual triggering if needed
 */
export function useOpenTreasury() {
    const queryClient = useQueryClient();

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

    const open = useCallback((treasuryId: string | undefined) => {
        if (!treasuryId) return;
        mutateRef.current(treasuryId);
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

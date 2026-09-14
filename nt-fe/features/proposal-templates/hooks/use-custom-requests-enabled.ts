import { useQuery } from "@tanstack/react-query";
import { useTreasury } from "@/hooks/use-treasury";
import { useNear } from "@/stores/near-store";
import { getCustomRequestsEnabled } from "../api";

function customRequestsKey(
    treasuryId: string | undefined,
    accountId: string | null | undefined,
) {
    return ["custom-requests-enabled", treasuryId, accountId] as const;
}

/**
 * Whether the Custom Requests feature is on for the current treasury. Gates the sidebar's Request
 * Templates section and the templates routes. Same enable-conditions as the templates query
 * (signed-in, non-guest treasury).
 */
export function useCustomRequestsEnabled() {
    const { accountId } = useNear();
    const { treasuryId, isGuestTreasury } = useTreasury();
    const enabled = !!treasuryId && !!accountId && !isGuestTreasury;

    return useQuery({
        queryKey: customRequestsKey(treasuryId, accountId),
        queryFn: () => getCustomRequestsEnabled(treasuryId as string),
        enabled,
        staleTime: 1000 * 30,
    });
}

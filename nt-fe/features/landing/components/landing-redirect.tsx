"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTreasury } from "@/hooks/use-treasury";
import { resolveTreasuryHomeHref } from "@/lib/treasury-home";
import { useNear } from "@/stores/near-store";

/**
 * Sends a signed-in visitor from the marketing page to their last viewed
 * treasury (or `/create` when they have none). The session cookie lives on the
 * backend origin, so this can only be decided client-side after `checkAuth`;
 * anonymous visitors see the landing page immediately and are never blocked.
 */
export function LandingRedirect() {
    const router = useRouter();
    const { accountId, isAuthenticated, isInitializing, checkAuth } = useNear();
    const { isLoading, lastTreasuryId, memberTreasuries } = useTreasury();
    const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

    useEffect(() => {
        checkAuth().finally(() => setHasCheckedAuth(true));
    }, [checkAuth]);

    useEffect(() => {
        if (!hasCheckedAuth || isInitializing || !isAuthenticated) return;
        // Signed in but terms not yet accepted: `accountId` stays null and the
        // treasury list never loads. `/create` hosts the terms modal and then
        // forwards to the preferred treasury itself.
        if (!accountId) {
            router.replace("/create");
            return;
        }
        if (isLoading) return;
        router.replace(
            resolveTreasuryHomeHref(memberTreasuries, lastTreasuryId),
        );
    }, [
        accountId,
        hasCheckedAuth,
        isAuthenticated,
        isInitializing,
        isLoading,
        lastTreasuryId,
        memberTreasuries,
        router,
    ]);

    return null;
}

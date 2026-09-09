"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LoadingScreen } from "@/components/loading-screen";
import { useUserTreasuries } from "@/hooks/use-treasury-queries";
import { resolveTreasuryHomeHref } from "@/lib/treasury-home";
import { useNear } from "@/stores/near-store";
import { useTreasuryStore } from "@/stores/treasury-store";

/**
 * Decides what a visitor of `/` sees: the marketing page, or a loading screen
 * on the way to their last viewed treasury (`/create` when they have none).
 *
 * The session cookie lives on the backend origin, so being signed in can only
 * be confirmed client-side after `checkAuth`. `hasSessionHint` is the server's
 * best guess from our own hint cookie (see `lib/session-hint.ts`), and it is
 * what keeps returning users off the marketing page from the very first paint
 * until the redirect lands. Anonymous visitors carry no hint and see the
 * landing page immediately; a stale hint costs them a loading screen until
 * `checkAuth` resolves and clears it.
 */
export function LandingGate({
    hasSessionHint,
    stayOnLanding = false,
    children,
}: {
    hasSessionHint: boolean;
    /** Server-read `?welcome` so a shared link never flashes the loading screen. */
    stayOnLanding?: boolean;
    children: React.ReactNode;
}) {
    const router = useRouter();
    const { accountId, isAuthenticated, isInitializing, checkAuth } = useNear();
    // Read the treasury list directly rather than through `useTreasury()`:
    // that hook resolves its treasury from `useParams()`, which has nothing to
    // resolve here, and it includes treasuries the user hid from selectors.
    const { data: treasuries = [], isLoading } = useUserTreasuries(accountId);
    const lastTreasuryId = useTreasuryStore((state) => state.lastTreasuryId);
    const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

    useEffect(() => {
        checkAuth().finally(() => setHasCheckedAuth(true));
    }, [checkAuth]);

    useEffect(() => {
        if (stayOnLanding) return;
        if (!hasCheckedAuth || isInitializing || !isAuthenticated) return;
        // Signed in but terms not yet accepted: `accountId` stays null and the
        // treasury list never loads. `/create` hosts the terms modal and then
        // forwards to the preferred treasury itself.
        if (!accountId) {
            router.replace("/create");
            return;
        }
        if (isLoading) return;
        router.replace(resolveTreasuryHomeHref(treasuries, lastTreasuryId));
    }, [
        accountId,
        hasCheckedAuth,
        isAuthenticated,
        isInitializing,
        isLoading,
        stayOnLanding,
        lastTreasuryId,
        router,
        treasuries,
    ]);

    if (stayOnLanding) {
        return <>{children}</>;
    }

    const authResolved = hasCheckedAuth && !isInitializing;
    if (authResolved ? isAuthenticated : hasSessionHint) {
        return <LoadingScreen />;
    }

    return <>{children}</>;
}

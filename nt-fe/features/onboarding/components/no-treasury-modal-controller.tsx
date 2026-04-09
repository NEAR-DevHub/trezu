"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTreasury } from "@/hooks/use-treasury";
import { useTreasuryCreationStatus } from "@/hooks/use-treasury-queries";
import { useNear } from "@/stores/near-store";
import { APP_ACTIVE_TREASURY } from "@/constants/config";
import { NoTreasuryModal } from "./no-treasury-modal";

const MODAL_SUPPRESSED_PATHS = new Set(["/app/new", APP_ACTIVE_TREASURY]);

export function NoTreasuryModalController() {
    const router = useRouter();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    // Show once per explicit login completion (not on refresh/session restore).
    const promptedLoginKeyRef = useRef<string | null>(null);
    const prevIsAuthenticatingRef = useRef(false);
    const [loginNonce, setLoginNonce] = useState(0);
    const { accountId, isInitializing, isAuthenticating } = useNear();
    const { treasuries, isLoading } = useTreasury();
    const { data: creationStatus } = useTreasuryCreationStatus();

    const creationAvailable = creationStatus?.creationAvailable ?? true;
    const isSuppressedPath = pathname
        ? MODAL_SUPPRESSED_PATHS.has(pathname)
        : false;
    const shouldShowModal =
        !!accountId &&
        loginNonce > 0 &&
        creationAvailable &&
        !isInitializing &&
        !isLoading &&
        treasuries.length === 0 &&
        !isSuppressedPath;

    useEffect(() => {
        if (!accountId) {
            promptedLoginKeyRef.current = null;
            setOpen(false);
        }
    }, [accountId]);

    useEffect(() => {
        const justCompletedLogin =
            prevIsAuthenticatingRef.current && !isAuthenticating && !!accountId;

        if (justCompletedLogin) {
            setLoginNonce((prev) => prev + 1);
            promptedLoginKeyRef.current = null;
        }

        prevIsAuthenticatingRef.current = isAuthenticating;
    }, [isAuthenticating, accountId]);

    useEffect(() => {
        if (!shouldShowModal) {
            setOpen(false);
            return;
        }

        const loginKey = `${accountId}:${loginNonce}`;
        if (promptedLoginKeyRef.current !== loginKey) {
            promptedLoginKeyRef.current = loginKey;
            setOpen(true);
        }
    }, [shouldShowModal, accountId, loginNonce]);

    const handleOpenChange = (nextOpen: boolean) => setOpen(nextOpen);

    return (
        <NoTreasuryModal
            open={open}
            onOpenChange={handleOpenChange}
            onCreateTreasury={() => {
                handleOpenChange(false);
                router.push("/app/new");
            }}
        />
    );
}

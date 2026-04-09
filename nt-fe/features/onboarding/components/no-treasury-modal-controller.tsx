"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTreasury } from "@/hooks/use-treasury";
import { useTreasuryCreationStatus } from "@/hooks/use-treasury-queries";
import { useNear } from "@/stores/near-store";
import { APP_ACTIVE_TREASURY } from "@/constants/config";
import { NoTreasuryModal } from "./no-treasury-modal";

const MODAL_SUPPRESSED_PATHS = new Set(["/app/new", APP_ACTIVE_TREASURY]);
const DISMISSED_KEY_PREFIX = "no-treasury-modal-dismissed";

export function NoTreasuryModalController() {
    const router = useRouter();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    // On onboarding ("/"), show once per visit regardless of localStorage dismissal.
    // Outside onboarding, localStorage controls whether the modal stays hidden.
    const onboardingShownRef = useRef(false);
    const { accountId, isInitializing } = useNear();
    const { treasuries, isLoading } = useTreasury();
    const { data: creationStatus } = useTreasuryCreationStatus();
    const dismissedStorageKey = `${DISMISSED_KEY_PREFIX}:${accountId ?? "guest"}`;

    const creationAvailable = creationStatus?.creationAvailable ?? true;
    const isOnboardingPath = pathname === "/";
    const isSuppressedPath = pathname
        ? MODAL_SUPPRESSED_PATHS.has(pathname)
        : false;
    const shouldShowModal =
        !!accountId &&
        creationAvailable &&
        !isInitializing &&
        !isLoading &&
        treasuries.length === 0 &&
        !isSuppressedPath;

    useEffect(() => {
        if (pathname !== "/") {
            onboardingShownRef.current = false;
        }
    }, [pathname]);

    useEffect(() => {
        if (!shouldShowModal) {
            setOpen(false);
            return;
        }

        if (isOnboardingPath) {
            if (!onboardingShownRef.current) {
                onboardingShownRef.current = true;
                setOpen(true);
            }
            return;
        }

        const isDismissed =
            localStorage.getItem(dismissedStorageKey) === "true";
        setOpen(!isDismissed);
    }, [shouldShowModal, isOnboardingPath, dismissedStorageKey]);

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);

        if (!nextOpen && accountId) {
            localStorage.setItem(dismissedStorageKey, "true");
        }
    };

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

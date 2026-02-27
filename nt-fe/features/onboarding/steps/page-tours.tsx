"use client";

import { useNextStep } from "nextstepjs";
import type { Tour } from "nextstepjs";
import { useEffect, useCallback, useRef } from "react";
import { useTreasury } from "@/hooks/use-treasury";
import { useResponsiveSidebar } from "@/stores/sidebar-store";

// Tour names
export const PAGE_TOUR_NAMES = {
    PAYMENTS_BULK: "payments-bulk",
    PAYMENTS_PENDING: "payments-pending",
    EXCHANGE_SETTINGS: "exchange-settings",
    MEMBERS_PENDING: "members-pending",
    GUEST_SAVE: "guest-save",
} as const;

// Local storage keys
export const PAGE_TOUR_STORAGE_KEYS = {
    PAYMENTS_BULK_SHOWN: "payments-bulk-tour-shown",
    PAYMENTS_PENDING_SHOWN: "payments-pending-tour-shown",
    EXCHANGE_SETTINGS_SHOWN: "exchange-settings-tour-shown",
    MEMBERS_PENDING_SHOWN: "members-pending-tour-shown",
    GUEST_SAVE_SHOWN: "guest-save-tour-shown",
} as const;

// Selector IDs
export const PAGE_TOUR_SELECTORS = {
    PAYMENTS_BULK_BTN: "#payments-bulk-btn",
    PAYMENTS_PENDING_BTN: "#payments-pending-btn",
    EXCHANGE_SETTINGS_BTN: "#exchange-settings-btn",
    MEMBERS_PENDING_BTN: "#members-pending-btn",
    GUEST_BADGE: "#guest-badge",
    GUEST_SAVE_BTN: "#guest-save-btn",
} as const;

const defaultStepProps = {
    icon: null,
    title: "",
    disableInteraction: true,
    showControls: false,
    showSkip: false,
    pointerPadding: 8,
    pointerRadius: 8,
} as const;

export const PAYMENTS_BULK_TOUR: Tour = {
    tour: PAGE_TOUR_NAMES.PAYMENTS_BULK,
    steps: [
        {
            ...defaultStepProps,
            content: (
                <>
                    Bulk creation is here! Create several requests in just a few
                    steps.
                </>
            ),
            selector: PAGE_TOUR_SELECTORS.PAYMENTS_BULK_BTN,
            side: "bottom",
        },
    ],
};

export const PAYMENTS_PENDING_TOUR: Tour = {
    tour: PAGE_TOUR_NAMES.PAYMENTS_PENDING,
    steps: [
        {
            ...defaultStepProps,
            content: <>View requests that are pending approval here.</>,
            selector: PAGE_TOUR_SELECTORS.PAYMENTS_PENDING_BTN,
            side: "bottom-right",
        },
    ],
};

export const EXCHANGE_SETTINGS_TOUR: Tour = {
    tour: PAGE_TOUR_NAMES.EXCHANGE_SETTINGS,
    steps: [
        {
            ...defaultStepProps,
            content: (
                <>
                    Here you can set how much price change you're willing to
                    accept.
                </>
            ),
            selector: PAGE_TOUR_SELECTORS.EXCHANGE_SETTINGS_BTN,
            side: "bottom-right",
        },
    ],
};

export const MEMBERS_PENDING_TOUR: Tour = {
    tour: PAGE_TOUR_NAMES.MEMBERS_PENDING,
    steps: [
        {
            ...defaultStepProps,
            content: <>Click to see active requests waiting for approval.</>,
            selector: PAGE_TOUR_SELECTORS.MEMBERS_PENDING_BTN,
            side: "bottom-left",
        },
    ],
};

export const GUEST_SAVE_TOUR: Tour = {
    tour: PAGE_TOUR_NAMES.GUEST_SAVE,
    steps: [
        {
            ...defaultStepProps,
            content: (
                <>
                    You are a guest of this treasury. You can only view the
                    data.
                </>
            ),
            selector: PAGE_TOUR_SELECTORS.GUEST_BADGE,
            side: "right",
        },
        {
            ...defaultStepProps,
            content: (
                <>You can save this guest treasury to your treasuries list.</>
            ),
            selector: PAGE_TOUR_SELECTORS.GUEST_SAVE_BTN,
            side: "right",
        },
    ],
};

/**
 * Hook to trigger the guest save tour when a connected user views a guest treasury for the first time.
 */
export function useGuestSaveTour(
    accountId: string | undefined,
    isSaved: boolean,
) {
    const { startNextStep, currentTour } = useNextStep();
    const { isGuestTreasury, isLoading } = useTreasury();
    const { isSidebarOpen } = useResponsiveSidebar();
    const hasTriggered = useRef(false);

    useEffect(() => {
        if (isLoading || !isGuestTreasury || !accountId || isSaved) return;
        if (currentTour) return;
        if (!isSidebarOpen) return;

        const alreadyShown =
            localStorage.getItem(PAGE_TOUR_STORAGE_KEYS.GUEST_SAVE_SHOWN) ===
            "true";
        if (alreadyShown) return;

        if (hasTriggered.current) return;
        hasTriggered.current = true;

        const timeout = setTimeout(() => {
            localStorage.setItem(
                PAGE_TOUR_STORAGE_KEYS.GUEST_SAVE_SHOWN,
                "true",
            );
            startNextStep(PAGE_TOUR_NAMES.GUEST_SAVE);
        }, 500);

        return () => clearTimeout(timeout);
    }, [
        isLoading,
        isGuestTreasury,
        accountId,
        isSaved,
        currentTour,
        startNextStep,
        isSidebarOpen,
    ]);
}

/**
 * Hook to trigger a one-time page tour on mount.
 * Checks localStorage and guest status before showing.
 */
export function usePageTour(tourName: string, storageKey: string) {
    const { startNextStep } = useNextStep();
    const { isGuestTreasury, isLoading } = useTreasury();
    const hasTriggered = useRef(false);

    const triggerTour = useCallback(() => {
        if (hasTriggered.current) return;
        const alreadyShown = localStorage.getItem(storageKey) === "true";
        if (alreadyShown) return;

        hasTriggered.current = true;
        localStorage.setItem(storageKey, "true");
        startNextStep(tourName);
    }, [storageKey, tourName, startNextStep]);

    // Auto-trigger on mount (with delay for DOM readiness)
    useEffect(() => {
        if (isGuestTreasury || isLoading) return;

        const alreadyShown = localStorage.getItem(storageKey) === "true";
        if (alreadyShown) return;

        const timeout = setTimeout(() => {
            triggerTour();
        }, 500);

        return () => clearTimeout(timeout);
    }, [isGuestTreasury, isLoading, storageKey, triggerTour]);

    // Return triggerTour for manual triggering (e.g., after form submit)
    return { triggerTour };
}

/**
 * Hook for tours that should only trigger manually (not on mount).
 * Used for the payments pending tour which triggers after form submission.
 */
export function useManualPageTour(tourName: string, storageKey: string) {
    const { startNextStep } = useNextStep();
    const { isGuestTreasury } = useTreasury();

    const triggerTour = useCallback(() => {
        if (isGuestTreasury) return;

        const alreadyShown = localStorage.getItem(storageKey) === "true";
        if (alreadyShown) return;

        localStorage.setItem(storageKey, "true");
        // Delay to let DOM update after form reset
        setTimeout(() => {
            startNextStep(tourName);
        }, 500);
    }, [isGuestTreasury, storageKey, tourName, startNextStep]);

    return { triggerTour };
}

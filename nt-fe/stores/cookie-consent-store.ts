"use client";

import { create } from "zustand";
import { applyAnalyticsConsent } from "@/lib/analytics";
import {
    ALL_CONSENT,
    type ConsentPreferences,
    ESSENTIAL_ONLY_CONSENT,
    readConsent,
    writeConsent,
} from "@/lib/cookie-consent";

type CookieConsentStore = {
    /** `null` until hydrated from the cookie, and while no choice is stored. */
    preferences: ConsentPreferences | null;
    hydrated: boolean;
    preferencesOpen: boolean;
    hydrate: () => void;
    acceptAll: () => void;
    rejectNonEssential: () => void;
    save: (prefs: ConsentPreferences) => void;
    openPreferences: () => void;
    closePreferences: () => void;
};

export const useCookieConsentStore = create<CookieConsentStore>()(
    (set, get) => ({
        preferences: null,
        hydrated: false,
        preferencesOpen: false,
        hydrate: () => {
            if (get().hydrated) return;
            set({ preferences: readConsent(), hydrated: true });
        },
        acceptAll: () => get().save(ALL_CONSENT),
        rejectNonEssential: () => get().save(ESSENTIAL_ONLY_CONSENT),
        save: (prefs) => {
            const previous = get().preferences;
            writeConsent(prefs);
            set({ preferences: prefs, preferencesOpen: false });
            if (previous?.analytics !== prefs.analytics) {
                applyAnalyticsConsent(prefs.analytics);
            }
        },
        openPreferences: () => set({ preferencesOpen: true }),
        closePreferences: () => set({ preferencesOpen: false }),
    }),
);

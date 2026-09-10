"use client";

import { useEffect } from "react";
import { useCookieConsentStore } from "@/stores/cookie-consent-store";
import { CookieConsentBanner } from "./cookie-consent-banner";
import { CookiePreferencesDialog } from "./cookie-preferences-dialog";

export function CookieConsent() {
    const hydrate = useCookieConsentStore((s) => s.hydrate);
    const hydrated = useCookieConsentStore((s) => s.hydrated);
    const hasChoice = useCookieConsentStore((s) => s.preferences !== null);
    const preferencesOpen = useCookieConsentStore((s) => s.preferencesOpen);

    useEffect(() => {
        hydrate();
    }, [hydrate]);

    if (!hydrated) return null;

    return (
        <>
            {!hasChoice && !preferencesOpen && <CookieConsentBanner />}
            <CookiePreferencesDialog />
        </>
    );
}

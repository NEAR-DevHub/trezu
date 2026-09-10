"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { PRIVACY_POLICY_HREF } from "@/constants/config";
import { useCookieConsentStore } from "@/stores/cookie-consent-store";
import { useUiStore } from "@/stores/ui-store";

export function CookieConsentBanner() {
    const t = useTranslations("cookieConsent");
    const acceptAll = useCookieConsentStore((s) => s.acceptAll);
    const rejectNonEssential = useCookieConsentStore(
        (s) => s.rejectNonEssential,
    );
    const openPreferences = useCookieConsentStore((s) => s.openPreferences);
    const pushOverlay = useUiStore((s) => s.pushOverlay);
    const popOverlay = useUiStore((s) => s.popOverlay);

    // Counts as an overlay so the support-chat launcher steps aside while the
    // banner occupies the same corner.
    useEffect(() => {
        pushOverlay();
        return () => popOverlay();
    }, [pushOverlay, popOverlay]);

    return createPortal(
        <section
            aria-label={t("title")}
            className="fixed bottom-4 right-4 z-60 w-sm max-w-[calc(100vw-2rem)] rounded-2xl bg-popover-foreground text-popover shadow-xl p-4"
        >
            <div className="flex items-start gap-3">
                <p className="min-w-0 flex-1 text-xs leading-relaxed">
                    {t.rich("bannerBody", {
                        privacy: (chunks) => (
                            <Link
                                href={PRIVACY_POLICY_HREF}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline underline-offset-2 hover:opacity-80"
                            >
                                {chunks}
                            </Link>
                        ),
                    })}
                </p>
                <button
                    type="button"
                    onClick={rejectNonEssential}
                    className="shrink-0 rounded-sm opacity-70 transition-opacity hover:opacity-100"
                >
                    <Icon icon={Cancel01Icon} />
                    <span className="sr-only">{t("closeBanner")}</span>
                </button>
            </div>

            <div className="mt-4 flex flex-col gap-2">
                <Button
                    onClick={acceptAll}
                    className="w-full bg-card text-card-foreground hover:bg-card/90 hover:text-card-foreground/90 text-[14px] leading-none"
                >
                    {t("acceptAll")}
                </Button>
                <Button
                    variant="ghost"
                    onClick={openPreferences}
                    className="w-full bg-popover/10 text-popover/80 hover:bg-popover/20 hover:text-popover text-[14px] leading-none"
                >
                    {t("managePreferences")}
                </Button>
            </div>
        </section>,
        document.body,
    );
}

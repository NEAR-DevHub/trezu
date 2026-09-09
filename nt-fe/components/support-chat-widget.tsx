"use client";

import dynamic from "next/dynamic";
import { useMediaQuery } from "@/hooks/use-media-query";
import { SUPPORT_CHAT } from "@/lib/support-chat";
import { useUiStore } from "@/stores/ui-store";
import { HelpScoutBeacon } from "./helpscout-beacon";

// Gleap SDK is browser-only and heavy; only load it when it is the active provider.
const GleapWidget = dynamic(
    () => import("./gleap-widget").then((m) => m.GleapWidget),
    { ssr: false },
);

/** Matches the mobile shell breakpoint (`lg:hidden` bottom nav). */
const MOBILE_MEDIA_QUERY = "(max-width: 1023px)";

/**
 * Mounts the configured support chat provider (Help Scout Beacon or Gleap).
 *
 * The floating launcher button is hidden on mobile viewports (the chat is
 * reachable via Help & Support in the user menu) and while any overlay is open.
 */
export function SupportChatWidget() {
    const overlayOpen = useUiStore((s) => s.overlayCount > 0);
    const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
    const hideLauncher = overlayOpen || isMobile;

    switch (SUPPORT_CHAT?.provider) {
        case "helpscout":
            return (
                <HelpScoutBeacon
                    beaconId={SUPPORT_CHAT.beaconId}
                    hideLauncher={hideLauncher}
                />
            );
        case "gleap":
            return (
                <GleapWidget
                    apiKey={SUPPORT_CHAT.apiKey}
                    hideLauncher={hideLauncher}
                />
            );
        default:
            return null;
    }
}

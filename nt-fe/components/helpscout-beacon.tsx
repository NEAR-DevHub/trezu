"use client";

import { useEffect } from "react";

const BEACON_SCRIPT_URL = "https://beacon-v2.helpscout.net";

type BeaconMethod =
    | "init"
    | "destroy"
    | "open"
    | "close"
    | "toggle"
    | "config"
    | "identify"
    | "navigate"
    | "logout";

interface BeaconQueuedCall {
    method: BeaconMethod;
    options?: unknown;
    data?: unknown;
}

interface BeaconFn {
    (method: BeaconMethod, options?: unknown, data?: unknown): void;
    readyQueue?: BeaconQueuedCall[];
}

declare global {
    interface Window {
        Beacon?: BeaconFn;
    }
}

/**
 * Typed port of the official Help Scout Beacon loader snippet: installs a
 * queueing stub on `window.Beacon` and injects the Beacon script once.
 * Calls made before the script loads are replayed by Beacon from `readyQueue`.
 */
function ensureBeaconLoaded() {
    if (window.Beacon) return;

    const stub: BeaconFn = (method, options, data) => {
        stub.readyQueue?.push({ method, options, data });
    };
    stub.readyQueue = [];
    window.Beacon = stub;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = BEACON_SCRIPT_URL;
    document.head.appendChild(script);
}

interface HelpScoutBeaconProps {
    beaconId: string;
    /** Hide the floating launcher button; `Beacon("open")` still works. */
    hideLauncher: boolean;
}

export function HelpScoutBeacon({
    beaconId,
    hideLauncher,
}: HelpScoutBeaconProps) {
    useEffect(() => {
        ensureBeaconLoaded();
        window.Beacon?.("init", beaconId);
        return () => {
            window.Beacon?.("destroy");
        };
    }, [beaconId]);

    useEffect(() => {
        window.Beacon?.("config", {
            display: {
                style: hideLauncher ? "manual" : "icon",
                // With the launcher scaled to 48px in globals.css, 12px keeps
                // it inside the landing footer's 64px corner padding, clear
                // of the full-width wordmark.
                horizontalOffset: 12,
                verticalOffset: 12,
            },
        });
    }, [hideLauncher]);

    return null;
}

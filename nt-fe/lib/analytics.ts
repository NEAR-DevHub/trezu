"use client";

import posthog from "posthog-js";

type AnalyticsParamValue =
    | string
    | number
    | boolean
    | string[]
    | number[]
    | boolean[]
    | null
    | undefined;
type AnalyticsParams = Record<string, AnalyticsParamValue>;

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

declare global {
    interface Window {
        gtag?: (...args: unknown[]) => void;
    }
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}) {
    posthog.capture(eventName, params);

    if (GA_MEASUREMENT_ID && typeof window !== "undefined") {
        window.gtag?.("event", eventName, {
            send_to: GA_MEASUREMENT_ID,
            ...params,
        });
    }
}

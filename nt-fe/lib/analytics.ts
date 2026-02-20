"use client";

type AnalyticsParamValue = string | number | boolean | null | undefined;
type AnalyticsParams = Record<string, AnalyticsParamValue>;

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

declare global {
    interface Window {
        gtag?: (...args: unknown[]) => void;
    }
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}) {
    if (!GA_MEASUREMENT_ID) return;
    if (typeof window === "undefined") return;

    window.gtag?.("event", eventName, {
        send_to: GA_MEASUREMENT_ID,
        ...params,
    });
}

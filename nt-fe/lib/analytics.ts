"use client";

import posthog from "posthog-js";
import { readConsent } from "@/lib/cookie-consent";

type AnalyticsParamValue = string | number | boolean | null | undefined;
type AnalyticsParams = Record<string, AnalyticsParamValue>;

const POSTHOG_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

declare global {
    interface Window {
        dataLayer?: Record<string, unknown>[];
        gtag?: (...args: unknown[]) => void;
    }
}

export function isAnalyticsAllowed(): boolean {
    return readConsent()?.analytics === true;
}

function initPostHog() {
    if (typeof POSTHOG_TOKEN !== "string" || posthog.__loaded) return;

    posthog.init(POSTHOG_TOKEN, {
        api_host: "/_telemetry",
        ui_host: "https://us.posthog.com",
        flags_api_host: "/_features",
        defaults: "2026-01-30",
        // Sentry is the error-reporting system; capturing exceptions here too
        // produced duplicate, unrouted copies of every client error.
        capture_exceptions: false,
        // We use custom onboarding questionnaire UI; disable PostHog survey runtime.
        disable_surveys: true,
        debug: process.env.NODE_ENV === "development",
    });
}

/**
 * Starts (or resumes) analytics. Safe to call on every page load and again
 * when the user grants consent: PostHog is only ever initialized once, and a
 * stale opt-out left by an earlier revoke is cleared.
 */
export function enableAnalytics(): void {
    initPostHog();
    if (posthog.__loaded && posthog.has_opted_out_capturing()) {
        posthog.opt_in_capturing({ captureEventName: false });
    }
    window.gtag?.("consent", "update", { analytics_storage: "granted" });
}

export function disableAnalytics(): void {
    if (posthog.__loaded) {
        posthog.opt_out_capturing();
    }
    window.gtag?.("consent", "update", { analytics_storage: "denied" });
}

export function applyAnalyticsConsent(granted: boolean): void {
    if (granted) enableAnalytics();
    else disableAnalytics();
}

function isPostHogCapturing(): boolean {
    return posthog.__loaded && !posthog.has_opted_out_capturing();
}

export function identifyAnalyticsUser(accountId: string): void {
    if (!isPostHogCapturing()) return;
    posthog.identify(accountId, { account_id: accountId });
}

/**
 * `posthog.reset()` also clears PostHog's own opt-out flag, so it must never
 * run while the user has declined analytics.
 */
export function resetAnalyticsUser(): void {
    if (!isPostHogCapturing()) return;
    posthog.reset();
}

function pushToDataLayer(eventName: string, params: AnalyticsParams = {}) {
    if (!GTM_ID || typeof window === "undefined") return;

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
        event: eventName,
        ...params,
    });
}

function sendToGoogleAnalytics(
    eventName: string,
    params: AnalyticsParams = {},
) {
    if (!GA_MEASUREMENT_ID || typeof window === "undefined") return;

    window.gtag?.("event", eventName, {
        send_to: GA_MEASUREMENT_ID,
        ...params,
    });
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}) {
    if (!isAnalyticsAllowed()) return;
    posthog.capture(eventName, params);
    pushToDataLayer(eventName, params);
    sendToGoogleAnalytics(eventName, params);
}

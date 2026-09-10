// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./lib/sentry-scrub";

Sentry.init({
    dsn:
        process.env.NEXT_PUBLIC_SENTRY_DSN ??
        "https://770b93020aaf1120d67ef430ff7fd074@o4510946911715328.ingest.us.sentry.io/4510946913222656",

    // Separates prod / staging / dev events into Sentry environments so alert
    // rules only fire for production.
    environment:
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

    tracesSampleRate: 0.1,

    // Attach sentry-trace/baggage to backend API requests so a frontend event
    // and its backend handler share a trace.
    tracePropagationTargets: process.env.NEXT_PUBLIC_BACKEND_API_BASE
        ? [process.env.NEXT_PUBLIC_BACKEND_API_BASE]
        : [],

    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Disable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: false,

    beforeSend: scrubSentryEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

import { enableAnalytics, isAnalyticsAllowed } from "./lib/analytics";

if (isAnalyticsAllowed()) {
    enableAnalytics();
}

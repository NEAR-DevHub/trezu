// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: "https://770b93020aaf1120d67ef430ff7fd074@o4510946911715328.ingest.us.sentry.io/4510946913222656",

    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: 1,
    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Disable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

import posthog from "posthog-js";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
    api_host: "/_telemetry",
    ui_host: "https://us.posthog.com",
    flags_api_host: "/_features",
    defaults: "2026-01-30",
    capture_exceptions: true,
    // We use custom onboarding questionnaire UI; disable PostHog survey runtime.
    disable_surveys: true,
    debug: process.env.NODE_ENV === "development",
});

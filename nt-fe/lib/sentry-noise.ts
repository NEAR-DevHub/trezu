import type { Event } from "@sentry/nextjs";

/**
 * The `TypeError` message each browser gives a `fetch()` that got no
 * response: offline or flaky network, the page being hidden or left (iOS
 * Safari and in-app WKWebViews drop requests often), blockers, DNS.
 * Newer browsers may append the host in parentheses.
 *
 * - Safari / WebKit: "Load failed"
 * - Chrome / Edge: "Failed to fetch"
 * - Firefox: "NetworkError when attempting to fetch resource."
 */
const FETCH_NETWORK_FAILURE_RE =
    /^(Load failed|Failed to fetch|NetworkError when attempting to fetch resource\.)( \(.+\))?$/;

/**
 * True for events that only say the user's connection dropped a `fetch()`.
 * They have nothing to act on, often come from third-party scripts
 * (analytics, wallet SDKs) with no stack, and are mostly unhandled
 * rejections. Our own API calls go through axios, whose connectivity
 * failures are handled the same way in `lib/http.ts`. A real outage is
 * reported by the backend (5xx, p0) and uptime monitoring.
 */
export function isBrowserNetworkFailure(event: Event): boolean {
    const exceptions = event.exception?.values ?? [];
    return (
        exceptions.length > 0 &&
        exceptions.every(
            (exception) =>
                exception.type === "TypeError" &&
                FETCH_NETWORK_FAILURE_RE.test(exception.value ?? ""),
        )
    );
}

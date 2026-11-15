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

/** URL schemes browsers use for extension scripts. */
const EXTENSION_SCHEME_RE =
    /^(chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension):$/;

/** First URL in one stack line: `at fn (url:1:2)` (V8) or `fn@url:1:2`. */
const FRAME_URL_RE = /([a-z][a-z0-9+.-]*:)\/\/[^\s)]+/i;

/**
 * True when the error was thrown inside a browser extension's script, e.g.
 * an extension that patches `XMLHttpRequest` and throws in its own
 * `onreadystatechange` after each of our API calls. Not ours to fix.
 *
 * This must read the raw `error.stack`: by the time `beforeSend` runs, the
 * Next.js SDK has rewritten every frame origin to `app://`, so
 * `chrome-extension://<id>/executors/200.js` looks like our own
 * `app:///executors/200.js` (and in-app) in the event.
 *
 * Only the innermost frame counts: if an extension merely wraps a callback
 * and our code throws, the error is still reported.
 */
export function isBrowserExtensionError(originalException: unknown): boolean {
    if (!(originalException instanceof Error) || !originalException.stack) {
        return false;
    }
    for (const line of originalException.stack.split("\n")) {
        // V8 puts "TypeError: message" first; frames start with "at ".
        // Firefox and Safari list only frames, as "fn@url:line:col".
        const isFrame = /^\s*at\s/.test(line) || line.includes("@");
        if (!isFrame) {
            continue;
        }
        const url = FRAME_URL_RE.exec(line);
        if (url) {
            return EXTENSION_SCHEME_RE.test(url[1].toLowerCase());
        }
    }
    return false;
}

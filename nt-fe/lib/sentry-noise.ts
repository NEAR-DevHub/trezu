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

/**
 * Location of the innermost frame of one stack line: `at fn (loc:1:2)` (V8)
 * or `fn@loc:1:2` (Firefox, Safari). `about:srcdoc` has no `//`.
 */
const FRAME_LOCATION_RE = /(about:srcdoc|[a-z][a-z0-9+.-]*:\/\/[^\s)]+)/i;

/** Who wrote the code that threw, when it is not ours. */
export type ForeignOrigin = "browser-extension" | "wallet-executor";

/**
 * Tell from the raw `error.stack` whether the error was thrown by code we
 * do not own:
 *
 * - **browser-extension**: a script from an extension URL, e.g. one that
 *   patches `XMLHttpRequest` and throws in its own `onreadystatechange`
 *   after each of our API calls.
 * - **wallet-executor**: a NEAR Connect wallet executor. Executors run in a
 *   sandboxed `srcdoc` iframe, and near-connect rejects our wallet call with
 *   the executor's error, cloned over `postMessage` with its stack. That
 *   is the only `srcdoc` document we run, so its frames read `about:srcdoc`.
 *
 * This must read the raw stack: by the time `beforeSend` runs, the Next.js
 * SDK has rewritten every frame origin to `app://`, so
 * `chrome-extension://<id>/executors/200.js` looks like our own in-app
 * `app:///executors/200.js` in the event.
 *
 * Only the innermost frame counts: if foreign code merely wraps a callback
 * and our code throws, the error is still ours.
 */
export function foreignOrigin(
    originalException: unknown,
): ForeignOrigin | null {
    if (!(originalException instanceof Error) || !originalException.stack) {
        return null;
    }
    for (const line of originalException.stack.split("\n")) {
        // V8 puts "TypeError: message" first; frames start with "at ".
        // Firefox and Safari list only frames, as "fn@location:line:col".
        const isFrame = /^\s*at\s/.test(line) || line.includes("@");
        if (!isFrame) {
            continue;
        }
        const location = FRAME_LOCATION_RE.exec(line)?.[1];
        if (!location) {
            continue;
        }
        if (location.toLowerCase() === "about:srcdoc") {
            return "wallet-executor";
        }
        const scheme = `${location.slice(0, location.indexOf(":")).toLowerCase()}:`;
        return EXTENSION_SCHEME_RE.test(scheme) ? "browser-extension" : null;
    }
    return null;
}

/**
 * Messages React's server renderer (`renderToPipeableStream`, bundled in
 * Next.js) aborts a render with when the HTTP response it streams into
 * closes or errors first. The client went away mid-response: navigated on,
 * cancelled an RSC prefetch, or lost the connection.
 */
const CLIENT_DISCONNECT_MESSAGES: ReadonlySet<string> = new Set([
    "The destination stream closed early.",
    "The destination stream errored while writing data.",
]);

/**
 * True for server-side events that only say the client disconnected while
 * a page or RSC payload was still streaming. They reach Sentry through
 * Next's `onRequestError` with no app frames and nothing to act on.
 */
export function isClientDisconnect(event: Event): boolean {
    const exceptions = event.exception?.values ?? [];
    return (
        exceptions.length > 0 &&
        exceptions.every((exception) =>
            CLIENT_DISCONNECT_MESSAGES.has(exception.value ?? ""),
        )
    );
}

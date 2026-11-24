import * as Sentry from "@sentry/nextjs";
import axios, { AxiosError } from "axios";

/**
 * Shared axios instance for backend/API calls.
 *
 * Reports unexpected failures (5xx and other failures without a response) to
 * Sentry once, centrally, tagged `error_code=FE_API_FAILED` and fingerprinted
 * by method + path. Not reported:
 * - expected client outcomes (4xx: auth, validation, not-found, rate limit);
 * - client-side connectivity failures (see {@link isClientConnectivityFailure}),
 *   which are recorded as a breadcrumb instead.
 *
 * Import as `import { http as axios } from "@/lib/http"` to keep call sites
 * unchanged.
 */
export const http = axios.create();

const REPORTED = Symbol.for("trezu.sentryReported");

/** True when this error was already sent to Sentry (by the interceptor). */
export function isReportedError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as Record<symbol, unknown>)[REPORTED] === true
    );
}

export function markReportedError(error: unknown): void {
    if (typeof error === "object" && error !== null) {
        (error as Record<symbol, unknown>)[REPORTED] = true;
    }
}

function requestPath(error: AxiosError): string {
    const url = error.config?.url ?? "unknown";
    try {
        return new URL(url, "http://relative").pathname;
    } catch {
        return url;
    }
}

/**
 * Axios codes for requests that never got a response because of the user's
 * side: offline or flaky network, the browser dropping requests when the
 * page is hidden or left (common on iOS Safari), blockers, or our own
 * cancellation. Nothing to act on per event. Backend outages are caught
 * elsewhere: 5xx are reported by the backend itself, and uptime monitoring
 * covers the API being unreachable.
 */
const CLIENT_CONNECTIVITY_CODES: ReadonlySet<string> = new Set([
    AxiosError.ERR_NETWORK, // "Network Error": XHR onerror, no response
    AxiosError.ERR_CANCELED, // aborted by our code (AbortController)
    AxiosError.ECONNABORTED, // "Request aborted": browser aborted the XHR
]);

export function isClientConnectivityFailure(error: AxiosError): boolean {
    return (
        error.response === undefined &&
        error.code !== undefined &&
        CLIENT_CONNECTIVITY_CODES.has(error.code)
    );
}

function reportHttpError(error: AxiosError): void {
    const status = error.response?.status;
    // 4xx are expected client outcomes (auth rejection, validation,
    // not-found, rate limit) — Info by the error taxonomy, never reported.
    if (status !== undefined && status < 500) {
        return;
    }

    const method = (error.config?.method ?? "get").toUpperCase();
    const path = requestPath(error);

    if (isClientConnectivityFailure(error)) {
        // Keep it as context for any real error that follows, and mark it so
        // reportError / the React Query fallback do not capture it either.
        Sentry.addBreadcrumb({
            category: "http.client",
            level: "warning",
            message: `${method} ${path} failed: ${error.code}`,
            data: { method, path, code: error.code },
        });
        markReportedError(error);
        return;
    }

    Sentry.withScope((scope) => {
        scope.setTag("error_code", "FE_API_FAILED");
        scope.setTag("alert_priority", "p2");
        scope.setTag("endpoint", `${method} ${path}`);
        scope.setTag(
            "http_status",
            status !== undefined ? String(status) : "network",
        );
        scope.setFingerprint(["FE_API_FAILED", method, path]);
        scope.setContext("request", {
            status,
            code: error.code,
        });
        Sentry.captureException(error);
    });
    markReportedError(error);
}

http.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
        if (axios.isAxiosError(error)) {
            reportHttpError(error);
        }
        return Promise.reject(error);
    },
);

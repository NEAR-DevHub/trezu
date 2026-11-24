import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { InternalAxiosRequestConfig } from "axios";

const captured: unknown[] = [];
const breadcrumbs: { message?: string }[] = [];
const scope = {
    setTag: () => {},
    setFingerprint: () => {},
    setContext: () => {},
};
mock.module("@sentry/nextjs", () => ({
    captureException: (error: unknown) => captured.push(error),
    addBreadcrumb: (crumb: { message?: string }) => breadcrumbs.push(crumb),
    withScope: (fn: (s: typeof scope) => void) => fn(scope),
}));

const { AxiosError } = await import("axios");
const { http, isReportedError } = await import("./http");

/** Make the next request fail the way the browser adapter would. */
function failWith(make: (config: InternalAxiosRequestConfig) => unknown) {
    return http
        .get("/api/proposals/dao.near", {
            adapter: (config) => Promise.reject(make(config)),
        })
        .then(
            () => {
                throw new Error("expected the request to fail");
            },
            (error: unknown) => error,
        );
}

describe("http interceptor", () => {
    beforeEach(() => {
        captured.length = 0;
        breadcrumbs.length = 0;
    });

    for (const code of [
        AxiosError.ERR_NETWORK,
        AxiosError.ERR_CANCELED,
        AxiosError.ECONNABORTED,
    ]) {
        it(`keeps ${code} out of Sentry, as a breadcrumb`, async () => {
            const error = await failWith(
                (config) => new AxiosError("Network Error", code, config),
            );

            expect(captured).toHaveLength(0);
            expect(breadcrumbs).toHaveLength(1);
            expect(breadcrumbs[0].message).toBe(
                `GET /api/proposals/dao.near failed: ${code}`,
            );
            // reportError and the React Query fallback must skip it too.
            expect(isReportedError(error)).toBe(true);
        });
    }

    it("reports 5xx responses", async () => {
        const error = await failWith(
            (config) =>
                new AxiosError(
                    "Request failed with status code 500",
                    AxiosError.ERR_BAD_RESPONSE,
                    config,
                    undefined,
                    {
                        status: 500,
                        statusText: "Internal Server Error",
                        headers: {},
                        config,
                        data: "boom",
                    },
                ),
        );

        expect(captured).toEqual([error]);
        expect(breadcrumbs).toHaveLength(0);
    });

    it("reports unknown failures without a response", async () => {
        const error = await failWith(
            (config) =>
                new AxiosError(
                    "timeout of 1ms exceeded",
                    AxiosError.ETIMEDOUT,
                    config,
                ),
        );

        expect(captured).toEqual([error]);
    });
});

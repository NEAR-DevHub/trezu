import type { Page } from "@playwright/test";

/**
 * Registers a response waiter for a URL substring. Must be called BEFORE
 * `page.goto()`/the triggering action to avoid racing the real request.
 * `optional: true` resolves to `null` instead of throwing if the response
 * never arrives (e.g. a mocked endpoint the app conditionally skips).
 */
export function waitForResponseIncludes(
    page: Page,
    urlSubstring: string,
    options?: { timeout?: number; optional?: boolean },
) {
    const promise = page.waitForResponse(
        (r) => r.url().includes(urlSubstring),
        options?.timeout ? { timeout: options.timeout } : undefined,
    );
    return options?.optional ? promise.catch(() => null) : promise;
}

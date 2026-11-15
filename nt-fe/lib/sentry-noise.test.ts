import { describe, expect, it } from "bun:test";
import type { Event } from "@sentry/nextjs";
import {
    isBrowserExtensionError,
    isBrowserNetworkFailure,
} from "./sentry-noise";

function exception(type: string, value: string): Event {
    return { exception: { values: [{ type, value }] } };
}

describe("isBrowserNetworkFailure", () => {
    it("matches each browser's fetch network failure", () => {
        for (const message of [
            "Load failed",
            "Failed to fetch",
            "NetworkError when attempting to fetch resource.",
            "Load failed (api.trezu.app)",
            "Failed to fetch (api.trezu.app)",
        ]) {
            expect(
                isBrowserNetworkFailure(exception("TypeError", message)),
            ).toBe(true);
        }
    });

    it("keeps other errors", () => {
        for (const event of [
            exception("Error", "Load failed"),
            exception("TypeError", "Cannot read properties of undefined"),
            exception(
                "TypeError",
                "Failed to fetch dynamically imported module",
            ),
            exception("TypeError", "Load failed for chunk 42"),
            { message: "Load failed" },
            {
                exception: {
                    values: [
                        { type: "TypeError", value: "Load failed" },
                        { type: "Error", value: "Proposal submit failed" },
                    ],
                },
            },
        ] as Event[]) {
            expect(isBrowserNetworkFailure(event)).toBe(false);
        }
    });
});

function errorWithStack(stack: string): Error {
    const error = new TypeError("Cannot read properties of undefined");
    error.stack = stack;
    return error;
}

describe("isBrowserExtensionError", () => {
    it("matches errors thrown inside an extension script", () => {
        for (const stack of [
            // Chrome (Sentry issue 7664264669)
            "TypeError: Cannot read properties of undefined (reading 'M_ID')\n" +
                "    at Y (chrome-extension://abcdefghijklmnop/executors/200.js:1:761)\n" +
                "    at XMLHttpRequest.onreadystatechange (chrome-extension://abcdefghijklmnop/executors/200.js:1:2598)\n" +
                "    at r (https://trezu.app/_next/static/chunks/0a1b2c.js:1:5000)",
            // Firefox
            "Y@moz-extension://0f1e2d3c/content.js:1:761\n" +
                "r@https://trezu.app/_next/static/chunks/0a1b2c.js:1:5000",
            // Safari
            "Y@safari-web-extension://ABCDEF/script.js:3:14\n" +
                "global code@https://trezu.app/",
        ]) {
            expect(isBrowserExtensionError(errorWithStack(stack))).toBe(true);
        }
    });

    it("keeps errors thrown in our code, even when an extension is on the stack", () => {
        for (const stack of [
            "TypeError: Cannot read properties of undefined\n" +
                "    at handle (https://trezu.app/_next/static/chunks/0a1b2c.js:1:42)\n" +
                "    at XMLHttpRequest.onreadystatechange (chrome-extension://abcdefghijklmnop/executors/200.js:1:2598)",
            "handle@https://trezu.app/_next/static/chunks/0a1b2c.js:1:42\n" +
                "Y@moz-extension://0f1e2d3c/content.js:1:761",
            // A URL in the message line must not count as a frame.
            "TypeError: bad response from chrome-extension://abc/x.js\n" +
                "    at handle (https://trezu.app/_next/static/chunks/0a1b2c.js:1:42)",
        ]) {
            expect(isBrowserExtensionError(errorWithStack(stack))).toBe(false);
        }
    });

    it("keeps values without a usable stack", () => {
        expect(isBrowserExtensionError("chrome-extension://abc/x.js")).toBe(
            false,
        );
        expect(isBrowserExtensionError(errorWithStack(""))).toBe(false);
        expect(isBrowserExtensionError(undefined)).toBe(false);
    });
});

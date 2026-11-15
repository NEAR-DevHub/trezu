import { describe, expect, it } from "bun:test";
import type { Event } from "@sentry/nextjs";
import {
    foreignOrigin,
    isBrowserNetworkFailure,
    isClientDisconnect,
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

describe("foreignOrigin", () => {
    it("recognises errors thrown inside an extension script", () => {
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
            expect(foreignOrigin(errorWithStack(stack))).toBe(
                "browser-extension",
            );
        }
    });

    it("recognises errors thrown inside a NEAR Connect wallet executor", () => {
        for (const stack of [
            "Error: Action was cancelled\n" +
                "    at Object.signAndSendTransaction (about:srcdoc:412:17)\n" +
                "    at async HTMLDocument.<anonymous> (about:srcdoc:361:26)",
            "signAndSendTransaction@about:srcdoc:412:17\n" +
                "async*@about:srcdoc:361:26",
        ]) {
            expect(foreignOrigin(errorWithStack(stack))).toBe(
                "wallet-executor",
            );
        }
    });

    it("keeps errors thrown in our code, even with foreign code on the stack", () => {
        for (const stack of [
            "TypeError: Cannot read properties of undefined\n" +
                "    at handle (https://trezu.app/_next/static/chunks/0a1b2c.js:1:42)\n" +
                "    at XMLHttpRequest.onreadystatechange (chrome-extension://abcdefghijklmnop/executors/200.js:1:2598)",
            "handle@https://trezu.app/_next/static/chunks/0a1b2c.js:1:42\n" +
                "Y@moz-extension://0f1e2d3c/content.js:1:761",
            "Error: bad result\n" +
                "    at onResult (https://trezu.app/_next/static/chunks/0a1b2c.js:1:42)\n" +
                "    at about:srcdoc:12:3",
            // A location in the message line must not count as a frame.
            "TypeError: bad response from chrome-extension://abc/x.js\n" +
                "    at handle (https://trezu.app/_next/static/chunks/0a1b2c.js:1:42)",
        ]) {
            expect(foreignOrigin(errorWithStack(stack))).toBeNull();
        }
    });

    it("keeps values without a usable stack", () => {
        expect(foreignOrigin("chrome-extension://abc/x.js")).toBeNull();
        expect(foreignOrigin(errorWithStack(""))).toBeNull();
        expect(foreignOrigin(undefined)).toBeNull();
    });
});

describe("isClientDisconnect", () => {
    it("matches React's aborted-stream errors", () => {
        // Sentry issue 7709265260
        expect(
            isClientDisconnect(
                exception("Error", "The destination stream closed early."),
            ),
        ).toBe(true);
        expect(
            isClientDisconnect(
                exception(
                    "Error",
                    "The destination stream errored while writing data.",
                ),
            ),
        ).toBe(true);
    });

    it("keeps other server errors", () => {
        for (const event of [
            exception("Error", "Failed to load treasury config"),
            exception("Error", "The destination stream closed early"),
            { message: "The destination stream closed early." },
        ] as Event[]) {
            expect(isClientDisconnect(event)).toBe(false);
        }
    });
});

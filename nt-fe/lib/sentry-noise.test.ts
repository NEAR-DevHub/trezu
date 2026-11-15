import { describe, expect, it } from "bun:test";
import type { Event } from "@sentry/nextjs";
import { isBrowserNetworkFailure } from "./sentry-noise";

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

import { describe, expect, test } from "bun:test";
import { APP_EVENT_NAMES, APP_EVENT_TYPES, parseAppEvent } from "./app-events";

describe("parseAppEvent", () => {
    test("every event type is subscribed to", () => {
        expect(APP_EVENT_NAMES).toContain("treasury_projection_updated");
        expect(APP_EVENT_NAMES).toContain("relay_submission_updated");
    });

    test("reads a relay submission update with its status payload", () => {
        const event = parseAppEvent(
            JSON.stringify({
                type: "relay_submission_updated",
                accountId: "dao.sputnik-dao.near",
                emittedAt: "2026-10-29T10:00:00Z",
                data: {
                    submissionId: "0190",
                    treasuryId: "dao.sputnik-dao.near",
                    state: "failed",
                    txHash: "8xQk",
                    error: {
                        code: "TX_FAILED",
                        funds_state: "failed_onchain",
                        retryable: false,
                        details: { tx_hash: "8xQk", reason: "ALREADY_VOTED" },
                    },
                },
            }),
        );
        expect(event?.type).toBe(APP_EVENT_TYPES.relaySubmissionUpdated);
        if (event?.type !== APP_EVENT_TYPES.relaySubmissionUpdated) {
            throw new Error("expected a relay submission event");
        }
        expect(event.data.state).toBe("failed");
        expect(event.data.error?.details?.reason).toBe("ALREADY_VOTED");
    });

    test("rejects a relay update with an unknown state or no payload", () => {
        expect(
            parseAppEvent(
                JSON.stringify({
                    type: "relay_submission_updated",
                    accountId: "dao.sputnik-dao.near",
                    emittedAt: "2026-10-29T10:00:00Z",
                    data: { submissionId: "x", treasuryId: "t", state: "lost" },
                }),
            ),
        ).toBeNull();
        expect(
            parseAppEvent(
                JSON.stringify({
                    type: "relay_submission_updated",
                    accountId: "dao.sputnik-dao.near",
                    emittedAt: "2026-10-29T10:00:00Z",
                }),
            ),
        ).toBeNull();
    });
});

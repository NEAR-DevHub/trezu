import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { formatProposalStatusDate, formatRelativeTime } from "@/lib/utils";

const NOW = new Date("2026-09-30T12:00:00Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LABELS = { justNow: "Just now", locale: "en" };

const past = (ms: number) => new Date(NOW.getTime() - ms);
const future = (ms: number) => new Date(NOW.getTime() + ms);

describe("formatProposalStatusDate", () => {
    afterEach(() => setSystemTime());

    it("uses the shared scale for resolved (past) dates", () => {
        setSystemTime(NOW);
        expect(formatProposalStatusDate(past(30 * 1000), false, LABELS)).toBe(
            "30 seconds ago",
        );
        expect(formatProposalStatusDate(past(12 * MINUTE), false, LABELS)).toBe(
            "12 minutes ago",
        );
        expect(formatProposalStatusDate(past(3 * HOUR), false, LABELS)).toBe(
            "3 hours ago",
        );
        expect(formatProposalStatusDate(past(2 * DAY), false, LABELS)).toBe(
            "2 days ago",
        );
        expect(formatProposalStatusDate(past(6 * DAY), false, LABELS)).toBe(
            "6 days ago",
        );
    });

    it("collapses 7–13 days into last week, then shows the date", () => {
        setSystemTime(NOW);
        expect(formatProposalStatusDate(past(7 * DAY), false, LABELS)).toBe(
            "last week",
        );
        expect(formatProposalStatusDate(past(13 * DAY), false, LABELS)).toBe(
            "last week",
        );
        expect(formatProposalStatusDate(past(14 * DAY), false, LABELS)).toBe(
            "Sep 16, 2026",
        );
        expect(formatProposalStatusDate(past(200 * DAY), false, LABELS)).toBe(
            "Mar 14, 2026",
        );
    });

    it("uses the same scale for pending (future) expiry", () => {
        setSystemTime(NOW);
        expect(
            formatProposalStatusDate(future(45 * MINUTE), true, LABELS),
        ).toBe("in 45 minutes");
        expect(formatProposalStatusDate(future(5 * DAY), true, LABELS)).toBe(
            "in 5 days",
        );
        expect(formatProposalStatusDate(future(8 * DAY), true, LABELS)).toBe(
            "next week",
        );
        expect(formatProposalStatusDate(future(20 * DAY), true, LABELS)).toBe(
            "Oct 20, 2026",
        );
    });

    it("clamps a future date that already passed to the smallest unit", () => {
        setSystemTime(NOW);
        expect(formatProposalStatusDate(past(5 * MINUTE), true, LABELS)).toBe(
            "in 1 second",
        );
    });
});

describe("formatRelativeTime", () => {
    afterEach(() => setSystemTime());

    it("matches the status-date scale after the first minute", () => {
        setSystemTime(NOW);
        expect(formatRelativeTime(past(20 * 1000), LABELS)).toBe("Just now");
        expect(formatRelativeTime(past(12 * MINUTE), LABELS)).toBe(
            "12 minutes ago",
        );
        expect(formatRelativeTime(past(DAY), LABELS)).toBe("yesterday");
        expect(formatRelativeTime(past(8 * DAY), LABELS)).toBe("last week");
        expect(formatRelativeTime(past(15 * DAY), LABELS)).toBe("Sep 15, 2026");
    });

    it("returns an empty string for missing or invalid dates", () => {
        expect(formatRelativeTime(null, LABELS)).toBe("");
        expect(formatRelativeTime("not a date", LABELS)).toBe("");
    });
});

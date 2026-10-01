import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { formatProposalStatusDate, formatRelativeTime } from "@/lib/utils";

const NOW = new Date("2026-09-30T12:00:00Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LABELS = { justNow: "Just now", locale: "en" };

const past = (ms: number) => new Date(NOW.getTime() - ms);
const future = (ms: number) => new Date(NOW.getTime() + ms);
const status = (date: Date, isFuture: boolean) =>
    formatProposalStatusDate(date, isFuture, LABELS);

describe("formatProposalStatusDate", () => {
    afterEach(() => setSystemTime());

    it("steps through minutes, hours, days and months for resolved dates", () => {
        setSystemTime(NOW);
        expect(status(past(30 * 1000), false).text).toBe("30 seconds ago");
        expect(status(past(12 * MINUTE), false).text).toBe("12 minutes ago");
        expect(status(past(3 * HOUR), false).text).toBe("3 hours ago");
        expect(status(past(2 * DAY), false).text).toBe("2 days ago");
        expect(status(past(8 * DAY), false).text).toBe("8 days ago");
        expect(status(past(29 * DAY), false).text).toBe("29 days ago");
        expect(status(past(45 * DAY), false).text).toBe("last month");
        expect(status(past(100 * DAY), false).text).toBe("3 months ago");
        expect(status(past(100 * DAY), false).isAbsolute).toBe(false);
    });

    it("switches to an absolute date beyond six months", () => {
        setSystemTime(NOW);
        expect(status(past(180 * DAY), false).text).toBe("6 months ago");
        expect(status(past(181 * DAY), false)).toEqual({
            text: "Apr 2, 2026",
            isAbsolute: true,
        });
    });

    it("uses the same scale for pending expiry in the future", () => {
        setSystemTime(NOW);
        expect(status(future(45 * MINUTE), true).text).toBe("in 45 minutes");
        expect(status(future(5 * DAY), true).text).toBe("in 5 days");
        expect(status(future(8 * DAY), true).text).toBe("in 8 days");
        expect(status(future(70 * DAY), true).text).toBe("in 2 months");
        expect(status(future(200 * DAY), true)).toEqual({
            text: "Apr 18, 2027",
            isAbsolute: true,
        });
    });

    it("clamps a future date that already passed to the smallest unit", () => {
        setSystemTime(NOW);
        expect(status(past(5 * MINUTE), true).text).toBe("in 1 second");
    });
});

describe("formatRelativeTime", () => {
    afterEach(() => setSystemTime());

    it("keeps the two-week rule for activity timestamps", () => {
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

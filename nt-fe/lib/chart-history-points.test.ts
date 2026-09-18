import { describe, expect, test } from "bun:test";
import { precedesLocalDay } from "./chart-history-points";

// Local-time constructors keep the expectations independent of the TZ the
// test runner happens to use.
const local = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(y, m - 1, d, h, min);

describe("precedesLocalDay", () => {
    const endTime = local(2026, 9, 17, 22, 49);

    test("keeps buckets from earlier days", () => {
        expect(
            precedesLocalDay(local(2026, 9, 16).toISOString(), endTime),
        ).toBe(true);
        expect(
            precedesLocalDay(local(2026, 9, 16, 23, 59).toISOString(), endTime),
        ).toBe(true);
    });

    test("drops today's midnight bucket and the trailing end bucket", () => {
        expect(
            precedesLocalDay(local(2026, 9, 17).toISOString(), endTime),
        ).toBe(false);
        expect(precedesLocalDay(endTime.toISOString(), endTime)).toBe(false);
    });

    test("compares calendar days across month and year boundaries", () => {
        expect(
            precedesLocalDay(
                local(2026, 8, 31, 23, 0).toISOString(),
                local(2026, 9, 1, 0, 30),
            ),
        ).toBe(true);
        expect(
            precedesLocalDay(
                local(2025, 12, 31, 23, 0).toISOString(),
                local(2026, 1, 1, 0, 30),
            ),
        ).toBe(true);
        expect(
            precedesLocalDay(
                local(2026, 9, 1, 0, 0).toISOString(),
                local(2026, 8, 31, 23, 0),
            ),
        ).toBe(false);
    });
});

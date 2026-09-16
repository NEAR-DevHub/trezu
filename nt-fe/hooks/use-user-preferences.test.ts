import { describe, expect, it } from "bun:test";
import { parseUserPreferences } from "./use-user-preferences";

describe("parseUserPreferences", () => {
    it("reads the zone the old picker stored as `{ utc, value, name }`", () => {
        const stored = JSON.stringify({
            timeFormat: "24",
            autoTimezone: false,
            timezone: {
                utc: "UTC+01:00",
                value: "W. Europe Standard Time",
                name: "Europe/Berlin",
            },
        });

        expect(parseUserPreferences(stored)).toEqual({
            timeFormat: "24",
            autoTimezone: false,
            timezone: "Europe/Berlin",
        });
    });

    it("falls back to `value` when the old row has no name", () => {
        const stored = JSON.stringify({
            autoTimezone: false,
            timezone: { utc: "UTC+01:00", value: "Europe/Berlin" },
        });

        expect(parseUserPreferences(stored).timezone).toBe("Europe/Berlin");
    });

    it("keeps a zone already stored as a string", () => {
        const stored = JSON.stringify({
            autoTimezone: false,
            timezone: "Europe/Berlin",
        });

        expect(parseUserPreferences(stored).timezone).toBe("Europe/Berlin");
    });

    it("defaults anything it cannot read", () => {
        expect(parseUserPreferences(null).timezone).toBeNull();
        expect(parseUserPreferences("not json")).toEqual({
            timeFormat: "12",
            autoTimezone: true,
            timezone: null,
        });
        expect(
            parseUserPreferences(JSON.stringify({ timezone: {} })).timezone,
        ).toBeNull();
    });
});

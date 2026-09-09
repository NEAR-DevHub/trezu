import { describe, expect, it } from "bun:test";
import {
    CREATE_HREF,
    LANDING_HREF,
    WELCOME_QUERY,
    isWelcomeEntry,
} from "./welcome-entry";

describe("isWelcomeEntry", () => {
    it("treats any present welcome param as on", () => {
        expect(isWelcomeEntry("")).toBe(true);
        expect(isWelcomeEntry("1")).toBe(true);
    });

    it("ignores a missing param", () => {
        expect(isWelcomeEntry(null)).toBe(false);
        expect(isWelcomeEntry(undefined)).toBe(false);
    });

    it("reads the first value when Next passes an array", () => {
        expect(isWelcomeEntry([""])).toBe(true);
        expect(isWelcomeEntry([])).toBe(false);
    });

    it("exports same-origin public hrefs", () => {
        expect(WELCOME_QUERY).toBe("welcome");
        expect(LANDING_HREF).toBe("/?welcome");
        expect(CREATE_HREF).toBe("/create?welcome");
    });
});

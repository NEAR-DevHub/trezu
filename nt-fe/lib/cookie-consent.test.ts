import { describe, expect, it } from "bun:test";
import {
    ALL_CONSENT,
    COOKIE_CONSENT_COOKIE,
    ESSENTIAL_ONLY_CONSENT,
    parseConsentCookie,
    serializeConsentCookie,
} from "./cookie-consent";

describe("cookie consent", () => {
    it("round-trips preferences through the cookie value", () => {
        for (const prefs of [ALL_CONSENT, ESSENTIAL_ONLY_CONSENT]) {
            const header = `${COOKIE_CONSENT_COOKIE}=${serializeConsentCookie(prefs)}`;
            expect(parseConsentCookie(header)).toEqual(prefs);
        }
    });

    it("finds the consent cookie among other cookies", () => {
        const header = `NEXT_LOCALE=en; ${COOKIE_CONSENT_COOKIE}=${serializeConsentCookie(ALL_CONSENT)}; trezu_signed_in=1`;
        expect(parseConsentCookie(header)).toEqual(ALL_CONSENT);
    });

    it("returns null when the cookie is absent", () => {
        expect(parseConsentCookie("")).toBeNull();
        expect(parseConsentCookie("NEXT_LOCALE=en")).toBeNull();
    });

    it("rejects malformed, wrong-version, or non-boolean values", () => {
        const bad = [
            "not-json",
            encodeURIComponent('{"v":1}'),
            encodeURIComponent('{"v":2,"analytics":true}'),
            encodeURIComponent('{"v":1,"analytics":"yes"}'),
        ];
        for (const value of bad) {
            expect(
                parseConsentCookie(`${COOKIE_CONSENT_COOKIE}=${value}`),
            ).toBeNull();
        }
    });
});

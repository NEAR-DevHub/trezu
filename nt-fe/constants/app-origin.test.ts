import { describe, expect, it } from "bun:test";
import {
    APP_PRODUCTION_ORIGIN,
    APP_STAGING_ORIGIN,
    resolveAppOrigin,
    resolveAppOriginFromHostname,
} from "./app-origin";

describe("resolveAppOrigin", () => {
    it("uses the staging Near Business host", () => {
        expect(resolveAppOrigin(true)).toBe(
            "https://testenv.business.near.com",
        );
    });

    it("uses the production Near Business host", () => {
        expect(resolveAppOrigin(false)).toBe("https://business.near.com");
    });

    it("exports the two hosts without a trailing slash", () => {
        expect(APP_STAGING_ORIGIN).toBe("https://testenv.business.near.com");
        expect(APP_PRODUCTION_ORIGIN).toBe("https://business.near.com");
        expect(APP_STAGING_ORIGIN.endsWith("/")).toBe(false);
        expect(APP_PRODUCTION_ORIGIN.endsWith("/")).toBe(false);
    });
});

describe("resolveAppOriginFromHostname", () => {
    it("maps the staging and production hosts", () => {
        expect(resolveAppOriginFromHostname("testenv.business.near.com")).toBe(
            APP_STAGING_ORIGIN,
        );
        expect(resolveAppOriginFromHostname("business.near.com")).toBe(
            APP_PRODUCTION_ORIGIN,
        );
    });

    it("uses the local origin on localhost", () => {
        expect(
            resolveAppOriginFromHostname("localhost", "http://localhost:3000"),
        ).toBe("http://localhost:3000");
    });
});

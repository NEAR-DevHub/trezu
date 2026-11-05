import { describe, expect, it } from "bun:test";
import { sanitizeReturnTo } from "./auth-redirect";

describe("sanitizeReturnTo", () => {
    it("accepts relative paths with query and hash", () => {
        expect(sanitizeReturnTo("/foo?x=1")).toBe("/foo?x=1");
        expect(sanitizeReturnTo("/a/b")).toBe("/a/b");
        expect(sanitizeReturnTo("/settings?tab=voting#top")).toBe(
            "/settings?tab=voting#top",
        );
    });

    it("rejects absolute and protocol-relative URLs", () => {
        expect(sanitizeReturnTo("https://evil.com")).toBeNull();
        expect(sanitizeReturnTo("http://evil.com/path")).toBeNull();
        expect(sanitizeReturnTo("//evil.com")).toBeNull();
        expect(sanitizeReturnTo("//evil.com/path")).toBeNull();
    });

    it("rejects paths that a browser resolves to another hostname", () => {
        expect(sanitizeReturnTo("/\\evil.com")).toBeNull();
        expect(sanitizeReturnTo("/\t/evil.com")).toBeNull();
        expect(sanitizeReturnTo("/\n/evil.com")).toBeNull();
    });

    it("rejects paths that normalize to a protocol-relative URL", () => {
        expect(sanitizeReturnTo("/.//evil.com")).toBeNull();
        expect(sanitizeReturnTo("/a/..//evil.com")).toBeNull();
    });

    it("rejects values that do not parse as a URL", () => {
        expect(sanitizeReturnTo("/\\[")).toBeNull();
    });

    it("rejects empty and non-path values", () => {
        expect(sanitizeReturnTo(null)).toBeNull();
        expect(sanitizeReturnTo("")).toBeNull();
        expect(sanitizeReturnTo("foo")).toBeNull();
    });
});

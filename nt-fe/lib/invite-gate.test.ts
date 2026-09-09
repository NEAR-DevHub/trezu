import { describe, expect, it } from "bun:test";
import {
    inviteCodeAccepted,
    parseInviteCodes,
    readInviteGateConfig,
    resolveInviteRedirect,
} from "./invite-gate";

const enabled = { enabled: true, codes: new Set(["alpha", "Beta-2"]) };
const disabled = { enabled: false, codes: new Set<string>() };

describe("parseInviteCodes", () => {
    it("trims entries and drops empty ones", () => {
        expect([...parseInviteCodes(" alpha, Beta-2 ,, ,gamma")]).toEqual([
            "alpha",
            "Beta-2",
            "gamma",
        ]);
        expect(parseInviteCodes(undefined).size).toBe(0);
        expect(parseInviteCodes("").size).toBe(0);
    });
});

describe("readInviteGateConfig", () => {
    it("defaults to disabled with the landing page at /", () => {
        expect(readInviteGateConfig({})).toEqual({
            enabled: false,
            codes: new Set(),
            earlyAccessUrl: "/",
        });
    });

    it("reads the server-only variables", () => {
        const config = readInviteGateConfig({
            INVITE_ONLY_ENABLED: "true",
            INVITE_CODES: "alpha",
            EARLY_ACCESS_LANDING_URL: " https://near.com/business ",
        });
        expect(config.enabled).toBe(true);
        expect(config.codes.has("alpha")).toBe(true);
        expect(config.earlyAccessUrl).toBe("https://near.com/business");
    });
});

describe("inviteCodeAccepted", () => {
    it("accepts everything when the gate is off", () => {
        expect(inviteCodeAccepted(disabled, null)).toBe(true);
        expect(inviteCodeAccepted(disabled, "anything")).toBe(true);
    });

    it("requires an exact, case-sensitive configured code when on", () => {
        expect(inviteCodeAccepted(enabled, "alpha")).toBe(true);
        expect(inviteCodeAccepted(enabled, "Beta-2")).toBe(true);
        expect(inviteCodeAccepted(enabled, "beta-2")).toBe(false);
        expect(inviteCodeAccepted(enabled, "")).toBe(false);
        expect(inviteCodeAccepted(enabled, null)).toBe(false);
        expect(inviteCodeAccepted(enabled, undefined)).toBe(false);
    });

    it("admits nobody when enabled with an empty list", () => {
        expect(
            inviteCodeAccepted({ enabled: true, codes: new Set() }, "alpha"),
        ).toBe(false);
    });
});

describe("resolveInviteRedirect", () => {
    const url = (s: string) => new URL(s, "https://business.near.com");

    it("ignores traffic when the gate is off or there is no ref", () => {
        expect(
            resolveInviteRedirect(url("/create?ref=alpha"), disabled),
        ).toBeNull();
        expect(resolveInviteRedirect(url("/create"), enabled)).toBeNull();
        expect(
            resolveInviteRedirect(url("/dao.near?ref=alpha"), enabled),
        ).toBeNull();
    });

    it("strips an accepted ref from /create and keeps the other params", () => {
        const result = resolveInviteRedirect(
            url("/create?utm_source=x&ref=alpha&returnTo=%2Fdao.near"),
            enabled,
        );
        expect(result?.inviteCode).toBe("alpha");
        expect(result?.location.pathname).toBe("/create");
        expect(result?.location.searchParams.has("ref")).toBe(false);
        expect(result?.location.searchParams.get("utm_source")).toBe("x");
        expect(result?.location.searchParams.get("returnTo")).toBe("/dao.near");
    });

    it("strips a rejected ref without storing it", () => {
        const result = resolveInviteRedirect(url("/create?ref=nope"), enabled);
        expect(result?.inviteCode).toBeNull();
        expect(result?.location.search).toBe("");
    });

    it("sends /login?ref=code on to /create after login", () => {
        const result = resolveInviteRedirect(url("/login?ref=alpha"), enabled);
        expect(result?.inviteCode).toBe("alpha");
        expect(result?.location.pathname).toBe("/login");
        expect(result?.location.searchParams.get("returnTo")).toBe("/create");
    });

    it("keeps an explicit returnTo on /login", () => {
        const result = resolveInviteRedirect(
            url(
                "/login?ref=alpha&returnTo=%2Fcreate%3FreturnTo%3D%252Fdao.near",
            ),
            enabled,
        );
        expect(result?.location.searchParams.get("returnTo")).toBe(
            "/create?returnTo=%2Fdao.near",
        );
    });
});

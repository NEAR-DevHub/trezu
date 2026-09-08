/**
 * Invite-only treasury creation (NEAR business).
 *
 * `/create?ref=<code>` (or `/login?ref=<code>`) is validated once on the
 * server. An accepted code moves into a short-lived httpOnly cookie and the
 * `ref` parameter is stripped, so the code never reaches client JavaScript,
 * analytics, or browser history. `/create` then renders onboarding only when
 * the cookie holds an accepted code, and that code is sent to the backend,
 * which enforces the same list on `POST /api/treasury/create-stream`.
 *
 * `INVITE_CODES` is server-only by design: a `NEXT_PUBLIC_` variable would
 * ship the full list in the browser bundle.
 */

export const INVITE_REF_PARAM = "ref";
export const INVITE_COOKIE_NAME = "invite_code";
export const INVITE_COOKIE_MAX_AGE_SECONDS = 30 * 60;

/** Paths that accept `?ref=<code>`. */
const INVITE_ENTRY_PATHS = new Set(["/create", "/login"]);

export interface InviteGateConfig {
    enabled: boolean;
    codes: ReadonlySet<string>;
    /** Where the access message sends people to request early access. */
    earlyAccessUrl: string;
}

export function parseInviteCodes(raw: string | undefined): Set<string> {
    if (!raw) return new Set();
    return new Set(
        raw
            .split(",")
            .map((code) => code.trim())
            .filter((code) => code.length > 0),
    );
}

export function readInviteGateConfig(
    env: Record<string, string | undefined> = process.env,
): InviteGateConfig {
    return {
        enabled: env.INVITE_ONLY_ENABLED === "true",
        codes: parseInviteCodes(env.INVITE_CODES),
        earlyAccessUrl: env.EARLY_ACCESS_LANDING_URL?.trim() || "/",
    };
}

/** Codes are reusable and case-sensitive; an enabled gate with no codes admits nobody. */
export function inviteCodeAccepted(
    config: Pick<InviteGateConfig, "enabled" | "codes">,
    code: string | null | undefined,
): boolean {
    if (!config.enabled) return true;
    return !!code && config.codes.has(code);
}

export interface InviteRedirect {
    /** Same URL without `ref`; `/login` gains `returnTo=/create` when it had none. */
    location: URL;
    /** The code to store, or null when it was missing or not accepted. */
    inviteCode: string | null;
}

/**
 * Server-side handling of an invite link. Returns null when the gate is off
 * or the request is not an invite entry, so ordinary traffic is untouched.
 *
 * Only the top-level `ref` is stripped. A `ref` nested inside `returnTo`
 * (e.g. `/login?returnTo=%2Fcreate%3Fref%3Dcode`) stays in the URL and can
 * reach page-view analytics. The app never builds such links itself, so
 * handling nested codes is not necessary at this stage.
 */
export function resolveInviteRedirect(
    url: URL,
    config: Pick<InviteGateConfig, "enabled" | "codes">,
): InviteRedirect | null {
    if (!config.enabled) return null;
    if (!INVITE_ENTRY_PATHS.has(url.pathname)) return null;
    if (!url.searchParams.has(INVITE_REF_PARAM)) return null;

    const code = url.searchParams.get(INVITE_REF_PARAM);
    const location = new URL(url);
    location.searchParams.delete(INVITE_REF_PARAM);
    if (
        location.pathname === "/login" &&
        !location.searchParams.has("returnTo")
    ) {
        location.searchParams.set("returnTo", "/create");
    }

    return {
        location,
        inviteCode: inviteCodeAccepted(config, code) ? code : null,
    };
}

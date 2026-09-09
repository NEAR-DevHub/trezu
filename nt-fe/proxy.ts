import { type NextRequest, NextResponse } from "next/server";
import geoip from "geoip-lite";
import {
    SANCTIONED_COUNTRY_CODES,
    SANCTIONED_REGIONS,
} from "@/constants/sanctioned-countries";
import {
    LOCALE_COOKIE,
    isEnabledLocale,
    pickLocaleFromAcceptLanguage,
} from "@/i18n/config";
import {
    INVITE_COOKIE_MAX_AGE_SECONDS,
    INVITE_COOKIE_NAME,
    readInviteGateConfig,
    resolveInviteRedirect,
} from "@/lib/invite-gate";

const ATTRIBUTION_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
] as const;

/**
 * Extract the client's real IP address from request headers.
 */
function getClientIp(request: NextRequest): string | null {
    // X-Real-IP (set by reverse proxies including Render)
    const realIp = request.headers.get("x-real-ip");
    if (realIp) return realIp.trim();

    // X-Forwarded-For (leftmost = original client)
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        const first = forwarded.split(",")[0];
        if (first) return first.trim();
    }

    return null;
}

/**
 * Determine country and region from the request using geoip-lite.
 */
function getGeoInfo(request: NextRequest): {
    countryCode: string | null;
    regionCode: string | null;
} {
    const clientIp = getClientIp(request);
    if (!clientIp) {
        return { countryCode: null, regionCode: null };
    }

    const geo = geoip.lookup(clientIp);
    if (geo) {
        return {
            countryCode: geo.country ?? null,
            regionCode: geo.region ?? null,
        };
    }

    return { countryCode: null, regionCode: null };
}

/**
 * Check if the resolved geo information indicates a sanctioned location.
 */
function isSanctionedLocation(
    countryCode: string | null,
    regionCode: string | null,
): boolean {
    if (!countryCode) return false;

    if (SANCTIONED_COUNTRY_CODES.has(countryCode)) {
        return true;
    }

    // Sub-national region check (e.g., Crimea, Donetsk, Luhansk under UA)
    if (regionCode) {
        const sanctionedRegions = SANCTIONED_REGIONS.get(countryCode);
        if (sanctionedRegions?.has(regionCode)) {
            return true;
        }
    }

    return false;
}

function appendLoginAttributionFromReturnTo(request: NextRequest) {
    if (request.nextUrl.pathname !== "/login") return null;

    const loginUrl = request.nextUrl.clone();
    const searchParams = loginUrl.searchParams;
    const hasTopLevelAttribution = ATTRIBUTION_KEYS.some((key) =>
        searchParams.has(key),
    );
    if (hasTopLevelAttribution) return null;

    const returnTo = searchParams.get("returnTo");
    if (!returnTo) return null;

    let returnToUrl: URL;
    try {
        returnToUrl = new URL(returnTo, loginUrl.origin);
    } catch {
        return null;
    }

    let hasChanges = false;
    for (const key of ATTRIBUTION_KEYS) {
        const value = returnToUrl.searchParams.get(key);
        if (!value || searchParams.has(key)) continue;
        searchParams.set(key, value);
        hasChanges = true;
    }

    if (!hasChanges) return null;
    return NextResponse.redirect(loginUrl);
}

/**
 * Invite links: validate `?ref=` on the server, keep an accepted code in an
 * httpOnly cookie, and redirect to the same URL without the code so it never
 * reaches client JavaScript, analytics, or history. A rejected code is
 * dropped the same way; `/create` then shows the access message.
 */
function redirectInviteRef(
    request: NextRequest,
    gate: ReturnType<typeof readInviteGateConfig>,
) {
    const invite = resolveInviteRedirect(request.nextUrl, gate);
    if (!invite) return null;

    const response = NextResponse.redirect(invite.location);
    if (invite.inviteCode) {
        response.cookies.set(INVITE_COOKIE_NAME, invite.inviteCode, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: request.nextUrl.protocol === "https:",
            maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
        });
    }
    return response;
}

/**
 * An invite-only deployment is kept out of search results. The header (not
 * robots.txt) is what makes crawlers drop already-known URLs, and it also
 * covers redirects and rewrites.
 */
function withNoIndex(response: NextResponse, enabled: boolean) {
    if (enabled) response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
}

export function proxy(request: NextRequest) {
    const gate = readInviteGateConfig();
    return withNoIndex(handleRequest(request, gate), gate.enabled);
}

function handleRequest(
    request: NextRequest,
    gate: ReturnType<typeof readInviteGateConfig>,
) {
    const attributionRedirect = appendLoginAttributionFromReturnTo(request);
    if (attributionRedirect) return attributionRedirect;

    const inviteRedirect = redirectInviteRef(request, gate);
    if (inviteRedirect) return inviteRedirect;

    const { countryCode, regionCode } = getGeoInfo(request);

    if (isSanctionedLocation(countryCode, regionCode)) {
        // Rewrite (not redirect) to /blocked — serves blocked page content
        // without changing URL, preventing redirect loops
        const blockedUrl = new URL("/blocked", request.url);
        return NextResponse.rewrite(blockedUrl);
    }

    const response = NextResponse.next();
    const existingLocale = request.cookies.get(LOCALE_COOKIE)?.value;
    if (!isEnabledLocale(existingLocale)) {
        const detected = pickLocaleFromAcceptLanguage(
            request.headers.get("accept-language"),
        );
        response.cookies.set(LOCALE_COOKIE, detected, {
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            sameSite: "lax",
            secure: request.nextUrl.protocol === "https:",
        });
    }
    return response;
}

/**
 * Run proxy on all routes except:
 * - /blocked (the blocked page itself)
 * - /crash-report (Sentry proxy)
 * - /_next/static, /_next/image, /_next/data (Next.js internals)
 * - Static files with common extensions
 */
export const config = {
    matcher: [
        "/((?!blocked|crash-report|_next/static|_next/image|_next/data|favicon\\.ico|.*\\.svg$|.*\\.png$|.*\\.jpg$|.*\\.webp$).*)",
    ],
};

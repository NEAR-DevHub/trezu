export const COOKIE_CONSENT_COOKIE = "nearcom_biz_cookie_consent";

const COOKIE_CONSENT_VERSION = 1;
const COOKIE_CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export interface ConsentPreferences {
    analytics: boolean;
    personalization: boolean;
}

export const ALL_CONSENT: ConsentPreferences = {
    analytics: true,
    personalization: true,
};

export const ESSENTIAL_ONLY_CONSENT: ConsentPreferences = {
    analytics: false,
    personalization: false,
};

export function serializeConsentCookie(prefs: ConsentPreferences): string {
    return encodeURIComponent(
        JSON.stringify({
            v: COOKIE_CONSENT_VERSION,
            analytics: prefs.analytics,
            personalization: prefs.personalization,
        }),
    );
}

export function parseConsentCookie(
    cookieHeader: string,
): ConsentPreferences | null {
    const prefix = `${COOKIE_CONSENT_COOKIE}=`;
    const entry = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(prefix));
    if (!entry) return null;

    try {
        const parsed: unknown = JSON.parse(
            decodeURIComponent(entry.slice(prefix.length)),
        );
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            (parsed as { v?: unknown }).v !== COOKIE_CONSENT_VERSION
        ) {
            return null;
        }
        const { analytics, personalization } = parsed as Record<
            string,
            unknown
        >;
        if (
            typeof analytics !== "boolean" ||
            typeof personalization !== "boolean"
        ) {
            return null;
        }
        return { analytics, personalization };
    } catch {
        return null;
    }
}

export function readConsent(): ConsentPreferences | null {
    if (typeof document === "undefined") return null;
    return parseConsentCookie(document.cookie);
}

export function writeConsent(prefs: ConsentPreferences): void {
    if (typeof document === "undefined") return;
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: consent must be readable synchronously by instrumentation-client before React mounts, so a plain first-party cookie is the simplest path
    document.cookie = `${COOKIE_CONSENT_COOKIE}=${serializeConsentCookie(prefs)}; path=/; max-age=${COOKIE_CONSENT_MAX_AGE_SECONDS}; samesite=lax${secure}`;
}

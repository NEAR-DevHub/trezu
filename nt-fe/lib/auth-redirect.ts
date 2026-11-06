// Only used to resolve the value; it never reaches a redirect.
const PLACEHOLDER_ORIGIN = "https://return-to.invalid";

// Parsed the way a browser will, because a leading `/` is not enough to stay on
// this host: backslashes and stripped tabs or newlines turn `/\evil.com` and
// `/\t/evil.com` external, and dot segments collapse `/.//evil.com` into a
// protocol-relative `//evil.com` once normalized.
export function sanitizeReturnTo(raw: string | null): string | null {
    if (!raw?.startsWith("/")) return null;

    let url: URL;
    try {
        url = new URL(raw, PLACEHOLDER_ORIGIN);
    } catch {
        return null;
    }

    if (url.origin !== PLACEHOLDER_ORIGIN || url.pathname.startsWith("//")) {
        return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
}

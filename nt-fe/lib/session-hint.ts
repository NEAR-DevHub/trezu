/**
 * Client-visible hint that the visitor has a backend session.
 *
 * The real session cookie is httpOnly and scoped to the backend origin, so our
 * own server can't see it. This cookie carries no authority: it only lets `/`
 * server-render the loading screen instead of the marketing page for returning
 * users (see `app/(init)/page.tsx`). Every actual auth decision still goes
 * through `checkAuth`, which corrects a stale hint on the spot.
 */
export const SESSION_HINT_COOKIE = "trezu_signed_in";

// Mirrors the backend's default JWT_EXPIRY_HOURS. A hint that outlives its
// session only costs a loading screen before the landing page appears.
const SESSION_HINT_MAX_AGE_SECONDS = 72 * 60 * 60;

export function markSessionHint(): void {
    if (typeof document === "undefined") return;
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${SESSION_HINT_COOKIE}=1; path=/; max-age=${SESSION_HINT_MAX_AGE_SECONDS}; samesite=lax${secure}`;
}

export function clearSessionHint(): void {
    if (typeof document === "undefined") return;
    document.cookie = `${SESSION_HINT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

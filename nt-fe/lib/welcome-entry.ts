/** Shareable query flag that keeps `/` and `/create` from bouncing to a treasury. */
export const WELCOME_QUERY = "welcome";

/** Same-origin landing so staging stays on staging and prod on prod. */
export const LANDING_HREF = `/?${WELCOME_QUERY}`;

/** Create page that does not bounce a signed-in member back to a treasury. */
export const CREATE_HREF = `/create?${WELCOME_QUERY}`;

/** True when `welcome` is in the query (`?welcome` or `?welcome=1`). */
export function isWelcomeEntry(
    value: string | string[] | null | undefined,
): boolean {
    if (value == null) return false;
    if (Array.isArray(value)) return value[0] != null;
    return true;
}

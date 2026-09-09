import { isStaging } from "./features";

export const APP_PRODUCTION_ORIGIN = "https://business.near.com";
export const APP_STAGING_ORIGIN = "https://testenv.business.near.com";

/** Resolve the public app origin from the page host. */
export function resolveAppOriginFromHostname(
    hostname: string,
    localOrigin?: string,
): string {
    if (hostname === "testenv.business.near.com") return APP_STAGING_ORIGIN;
    if (hostname === "business.near.com") return APP_PRODUCTION_ORIGIN;
    if (localOrigin && (hostname === "localhost" || hostname === "127.0.0.1")) {
        return localOrigin;
    }
    return APP_PRODUCTION_ORIGIN;
}

/** App origin for dummy URL parsing and wallet metadata. */
export function resolveAppOrigin(staging = isStaging): string {
    return staging ? APP_STAGING_ORIGIN : APP_PRODUCTION_ORIGIN;
}

export const APP_ORIGIN = resolveAppOrigin();

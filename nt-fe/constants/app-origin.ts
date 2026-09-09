import { isStaging } from "./features";

export const APP_PRODUCTION_ORIGIN = "https://business.near.com";
export const APP_STAGING_ORIGIN = "https://testenv.business.near.com";

/** App origin for dummy URL parsing and wallet metadata. */
export function resolveAppOrigin(staging = isStaging): string {
    return staging ? APP_STAGING_ORIGIN : APP_PRODUCTION_ORIGIN;
}

export const APP_ORIGIN = resolveAppOrigin();

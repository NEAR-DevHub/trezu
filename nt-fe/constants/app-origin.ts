import {
    APP_PRODUCTION_ORIGIN,
    APP_STAGING_ORIGIN,
} from "../near-connect/src/app-origin";
import { isStaging } from "./features";

export {
    APP_PRODUCTION_ORIGIN,
    APP_STAGING_ORIGIN,
    resolveAppOriginFromHostname,
} from "../near-connect/src/app-origin";

/** App origin for dummy URL parsing and wallet metadata. */
export function resolveAppOrigin(staging = isStaging): string {
    return staging ? APP_STAGING_ORIGIN : APP_PRODUCTION_ORIGIN;
}

export const APP_ORIGIN = resolveAppOrigin();

/**
 * Feature flags for hiding features in production.
 *
 * Each flag reads from a NEXT_PUBLIC_FEATURE_* env variable.
 * When the variable is not set or is not "true", the feature is disabled.
 *
 * To enable a feature in staging, set the corresponding env variable:
 *   NEXT_PUBLIC_STAGING=true
 */

const staging =
    process.env.NEXT_PUBLIC_STAGING === "true" ||
    process.env.NODE_ENV === "development";

export const features = staging
    ? {
          integrations: true,
          confidential: true,
      }
    : {
          integrations: false,
          confidential: false,
      };

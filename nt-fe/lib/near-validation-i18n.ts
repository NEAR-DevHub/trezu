import type { NearValidationErrorCode } from "./near-validation";

type AccountInputTranslator = ((key: string) => string) & {
    has: (key: string) => boolean;
};

/**
 * Resolve NEAR validation error messages from accountInput namespace.
 */
export function translateNearValidationError(
    t: AccountInputTranslator,
    errorCode: NearValidationErrorCode,
    fallbackMessage?: string,
) {
    const nestedKey = `near.${errorCode}`;

    if (t.has(nestedKey)) {
        return t(nestedKey);
    }

    if (t.has(errorCode)) {
        return t(errorCode);
    }

    if (fallbackMessage) {
        return fallbackMessage;
    }

    if (t.has("failedValidation")) {
        return t("failedValidation");
    }

    return errorCode;
}

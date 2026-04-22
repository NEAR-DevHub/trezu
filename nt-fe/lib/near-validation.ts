/**
 * NEAR Address Validation Utilities
 */

import { checkAccountExists } from "./api";

export type NearValidationErrorCode =
    | "required"
    | "length"
    | "missingTld"
    | "invalidChars"
    | "accountMissing"
    | "verifyFailed";

const isHex64 = (str: string): boolean => /^[0-9a-fA-F]{64}$/.test(str);

const isEthereumLike = (str: string): boolean =>
    /^0x[0-9a-fA-F]{40}$/.test(str);

function validateNearAddressFormat(
    address: string,
): NearValidationErrorCode | null {
    if (!address || typeof address !== "string") {
        return "required";
    }

    const trimmed = address.trim();

    if (trimmed.length < 2 || trimmed.length > 64) {
        return "length";
    }

    if (isHex64(trimmed)) return null;
    if (isEthereumLike(trimmed)) return null;

    if (!trimmed.includes(".")) {
        return "missingTld";
    }

    const validChars = /^[a-z0-9._-]+$/;
    if (!validChars.test(trimmed)) {
        return "invalidChars";
    }

    const validTLDs = [".near", ".aurora", ".tg"];
    const hasValidTLD = validTLDs.some((tld) => trimmed.endsWith(tld));

    if (!hasValidTLD) {
        return "missingTld";
    }

    return null;
}

export async function validateNearAddress(
    address: string,
): Promise<NearValidationErrorCode | null> {
    const formatError = validateNearAddressFormat(address);
    if (formatError) {
        return formatError;
    }

    const trimmed = address.trim();

    if (isHex64(trimmed) || isEthereumLike(trimmed)) {
        return null;
    }

    try {
        const result = await checkAccountExists(trimmed);
        if (!result || !result.exists) {
            return "accountMissing";
        }
    } catch (error) {
        console.error("Error checking account existence:", error);
        return "verifyFailed";
    }

    return null;
}

/**
 * Simple boolean check if address is valid (async version with blockchain check)
 * @returns true if valid, false if invalid
 */
export const isValidNearAddress = async (address: string): Promise<boolean> => {
    const error = await validateNearAddress(address);
    return error === null;
};

/**
 * Synchronous format-only validation (doesn't check blockchain).
 * Use this for quick format checks without async.
 * @returns true if valid format, false if invalid
 */
export const isValidNearAddressFormat = (address: string): boolean => {
    return validateNearAddressFormat(address) === null;
};

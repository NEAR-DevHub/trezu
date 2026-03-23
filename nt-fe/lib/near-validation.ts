/**
 * NEAR Address Validation Utilities
 */

import { checkAccountExists } from "./api";

/**
 * Check if string is a valid 64-character hex string (implicit account)
 */
const isHex64 = (str: string): boolean => /^[0-9a-fA-F]{64}$/.test(str);

/**
 * Check if string is an Ethereum-like address (0x + 40 hex chars)
 */
const isEthereumLike = (str: string): boolean =>
    /^0x[0-9a-fA-F]{40}$/.test(str);

/**
 * Validates NEAR address format (local check only, doesn't verify blockchain existence)
 *
 * NEAR addresses can ONLY be:
 * 1. Implicit accounts (exactly 64-char hex): e.g., "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de"
 * 2. Named accounts with valid TLD: e.g., "alice.near", "app.alice.near", "bob.aurora", "charlie.tg"
 * 3. Ethereum-like accounts (0x + 40 hex): e.g., "0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4"
 *
 * @returns null if valid format, error message string if invalid
 */
function validateNearAddressFormat(address: string): string | null {
    if (!address || typeof address !== "string") {
        return "Address is required";
    }

    const trimmed = address.trim();

    if (trimmed.length < 2 || trimmed.length > 64) {
        return "Address must be between 2 and 64 characters";
    }

    // Check if it's a valid implicit account (exactly 64-char hex)
    if (isHex64(trimmed)) {
        return null;
    }

    // Check if it's an Ethereum-like address (0x + 40 hex chars)
    if (isEthereumLike(trimmed)) {
        return null;
    }

    // For any other format, it MUST be a named account with a dot and valid TLD
    if (!trimmed.includes(".")) {
        return "Named accounts must end with .near, .aurora, or .tg";
    }

    // Check for valid characters (lowercase letters, digits, and separators: ., -, _)
    const validChars = /^[a-z0-9._-]+$/;
    if (!validChars.test(trimmed)) {
        return "Address can only contain lowercase letters, digits, and separators (., -, _)";
    }

    // Must have a valid TLD
    const validTLDs = [".near", ".aurora", ".tg"];
    const hasValidTLD = validTLDs.some((tld) => trimmed.endsWith(tld));

    if (!hasValidTLD) {
        return "Named accounts must end with .near, .aurora, or .tg";
    }

    return null;
}

/**
 * Validates a NEAR address and returns an error message if invalid, or null if valid.
 * Performs both format validation and blockchain existence check.
 * Note: Implicit accounts (64-char hex) and Ethereum-like accounts (0x...) skip blockchain check.
 *
 * @returns null if valid, error message string if invalid
 */
export async function validateNearAddress(
    address: string,
): Promise<string | null> {
    // First check format
    const formatError = validateNearAddressFormat(address);
    if (formatError) {
        return formatError;
    }

    const trimmed = address.trim();

    // Skip blockchain check for implicit accounts (64-char hex) and Ethereum-like accounts
    // These are derived from public keys/addresses and are always valid
    if (isHex64(trimmed) || isEthereumLike(trimmed)) {
        return null;
    }

    // For named accounts, check if they exist on blockchain
    try {
        const result = await checkAccountExists(trimmed);
        if (!result || !result.exists) {
            return "Account does not exist on NEAR blockchain";
        }
    } catch (error) {
        console.error("Error checking account existence:", error);
        return "Failed to verify account existence";
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

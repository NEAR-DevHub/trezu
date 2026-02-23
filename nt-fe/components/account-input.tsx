"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { LargeInput } from "./large-input";
import { getAddressPattern, getAddressPlaceholder, getBlockchainDisplayName } from "@/lib/address-validation";
import { validateNearAddress, isValidNearAddressFormat } from "@/lib/near-validation";
import type { BlockchainType } from "@/lib/blockchain-utils";

/**
 * Unified Account Input Component
 * Validates recipient addresses for ALL blockchains (NEAR, Bitcoin, Ethereum, etc.)
 *
 * @param {BlockchainType} blockchain - Blockchain type (near, bitcoin, ethereum, etc.)
 * @param {string} value - Current address value
 * @param {Function} setValue - Callback to update value
 * @param {Function} setIsValid - Callback to update validation state
 * @param {boolean} disabled - Whether input is disabled
 * @param {boolean} borderless - Whether to show borderless style
 */

interface AccountInputProps {
    blockchain: BlockchainType;
    value: string;
    setValue: (value: string) => void;
    setIsValid: (isValid: boolean) => void;
    setIsValidating?: (isValidating: boolean) => void; // Expose validation state
    disabled?: boolean;
    borderless?: boolean;
    validateOnMount?: boolean; // Force validation on mount (for edit screens)
}

const AccountInput = ({
    blockchain,
    value,
    setValue,
    setIsValid,
    setIsValidating: setIsValidatingProp,
    disabled = false,
    borderless = false,
    validateOnMount = false,
}: AccountInputProps) => {
    const [isValidating, setIsValidating] = useState(false);
    const [validationError, setValidationError] = useState<string | undefined>();
    const [hasValidated, setHasValidated] = useState(false); // Track if validation completed
    const hasUserInteractedRef = useRef(false);

    const isNear = blockchain === "near";

    // Wrapper to set isValidating and notify parent
    const updateValidationState = useCallback((validating: boolean) => {
        setIsValidating(validating);
        if (setIsValidatingProp) {
            setIsValidatingProp(validating);
        }
    }, [setIsValidatingProp]);

    // Get blockchain-specific configuration
    const config = useMemo(() => {
        const placeholder = getAddressPlaceholder(blockchain);
        const regex = getAddressPattern(blockchain);

        return { placeholder, regex };
    }, [blockchain]);

    const validateNearFull = useCallback(async (address: string) => {
        if (!address || address.trim() === "") {
            setValidationError(undefined);
            setIsValid(false);
            setHasValidated(false);
            return;
        }

        updateValidationState(true);
        setHasValidated(false); // Reset validation state
        try {
            const error = await validateNearAddress(address);
            setValidationError(error || undefined);
            setIsValid(!error);
            setHasValidated(true); // Mark as validated
        } catch (err) {
            console.error("NEAR validation error:", err);
            setValidationError("Failed to validate address");
            setIsValid(false);
            setHasValidated(true);
        } finally {
            updateValidationState(false);
        }
    }, [setIsValid, updateValidationState]);

    useEffect(() => {
        const shouldValidate = validateOnMount || hasUserInteractedRef.current;
        if (!value || !shouldValidate) return;

        // NEAR validation (async)
        if (isNear) {
            // Quick format check first
            if (!isValidNearAddressFormat(value)) {
                setValidationError("Invalid NEAR account format");
                setIsValid(false);
                return;
            }

            // Debounce the async blockchain check
            const timeoutId = setTimeout(() => {
                validateNearFull(value);
            }, validateOnMount ? 0 : 500); // No debounce on mount

            return () => clearTimeout(timeoutId);
        }

        // Non-NEAR validation (sync with regex)
        if (config.regex) {
            const isValid = config.regex.test(value);
            setIsValid(isValid);
            if (!isValid) {
                const displayName = getBlockchainDisplayName(blockchain);
                setValidationError(`Please enter a valid ${displayName} address.`);
            } else {
                setValidationError(undefined);
            }
        } else {
            // No regex pattern (unknown blockchain) - accept any non-empty address
            setIsValid(!!value);
            setValidationError(undefined);
        }
    }, [value, blockchain, isNear, config.regex, validateOnMount, setIsValid, validateNearFull]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.trim(); // Remove whitespaces
        setValue(val);

        // Mark that user has interacted
        hasUserInteractedRef.current = true;

        if (isNear) {
            setHasValidated(false); // Reset validation state when value changes
            if (!val || val === "") {
                setValidationError(undefined);
                setIsValid(false);
            } else if (!isValidNearAddressFormat(val)) {
                setValidationError("Invalid NEAR account format");
                setIsValid(false);
            } else {
                setValidationError(undefined);
                // Don't set valid yet, wait for blockchain check
            }
            return;
        }

        // For other blockchains: Sync regex validation
        if (config.regex) {
            const isValid = config.regex.test(val);
            setIsValid(isValid);
            if (!isValid && val) {
                const displayName = getBlockchainDisplayName(blockchain);
                setValidationError(`Please enter a valid ${displayName} address.`);
            } else {
                setValidationError(undefined);
            }
        } else {
            // No regex pattern (e.g., unknown blockchain) - accept any non-empty address
            setIsValid(!!val);
            setValidationError(undefined);
        }
    };

    // Memoized validation state for border styling
    const validationBorderClass = useMemo(() => {
        if (!value) return "";

        if (isNear) {
            if (isValidating) return "border-yellow-500"; // Validating
            if (validationError) return "border-red-500"; // Invalid
            // For NEAR, only show green after full validation passes
            return validationError === undefined && value ? "border-green-500" : "";
        }

        // For other chains: immediate validation (or accept all if no pattern)
        if (!config.regex) {
            // No validation pattern - show green if non-empty (unknown blockchain)
            return value ? "border-green-500" : "";
        }

        const isValid = config.regex.test(value);
        return isValid ? "border-green-500" : "border-red-500";
    }, [value, isValidating, validationError, config.regex, isNear]);

    return (
        <div className="flex flex-col gap-1">
            <LargeInput
                type="text"
                className={validationBorderClass}
                placeholder={config.placeholder}
                value={value || ""}
                onChange={handleChange}
                disabled={disabled || isValidating}
                borderless={borderless}
            />
            {/* Show validation error or status */}
            {value && validationError && !isValidating && (
                <p className="text-xs text-destructive">
                    {validationError}
                </p>
            )}
            {/* Show validation status for NEAR */}
            {isNear && value && isValidating && (
                <p className="text-xs text-yellow-600">
                    Validating address...
                </p>
            )}
            {isNear && value && !isValidating && !validationError && hasValidated && (
                <p className="text-xs text-green-600">
                    Valid address
                </p>
            )}
        </div>
    );
};

export default AccountInput;
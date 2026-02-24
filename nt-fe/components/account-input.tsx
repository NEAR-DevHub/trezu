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

    // Get blockchain-specific configuration
    const config = useMemo(() => ({
        placeholder: getAddressPlaceholder(blockchain),
        regex: getAddressPattern(blockchain),
    }), [blockchain]);

    // Wrapper to set isValidating and notify parent
    const updateValidationState = useCallback((validating: boolean) => {
        setIsValidating(validating);
        setIsValidatingProp?.(validating);
    }, [setIsValidatingProp]);

    // Reset all validation states
    const resetValidation = useCallback(() => {
        setValidationError(undefined);
        setIsValid(false);
        setHasValidated(false);
        updateValidationState(false);
    }, [setIsValid, updateValidationState]);

    // NEAR full validation (format + blockchain check)
    const validateNearFull = useCallback(async (address: string) => {
        if (!address || address.trim() === "") {
            resetValidation();
            return;
        }

        updateValidationState(true);
        setHasValidated(false); // Reset validation state
        try {
            const error = await validateNearAddress(address);
            setValidationError(error || undefined);
            setIsValid(!error);
            setHasValidated(!error); // Only mark as validated if successful
        } catch (err) {
            console.error("NEAR validation error:", err);
            setValidationError("Failed to validate address");
            setIsValid(false);
            setHasValidated(false);
        } finally {
            updateValidationState(false);
        }
    }, [setIsValid, updateValidationState, resetValidation]);

    useEffect(() => {
        const shouldValidate = validateOnMount || hasUserInteractedRef.current;

        if (!shouldValidate) {
            // Don't validate yet - user hasn't interacted
            return;
        }

        if (!value) {
            resetValidation();
            return;
        }

        // NEAR validation (async)
        if (isNear) {
            if (!isValidNearAddressFormat(value)) {
                setValidationError("Invalid NEAR account format");
                setIsValid(false);
                setHasValidated(false);
                updateValidationState(false);
                return;
            }

            const timeoutId = setTimeout(() => {
                validateNearFull(value);
            }, validateOnMount ? 0 : 500);

            return () => {
                clearTimeout(timeoutId);
                updateValidationState(false);
            };
        }

        // Non-NEAR validation (sync with regex)
        if (config.regex) {
            const isValid = config.regex.test(value);
            setIsValid(isValid);
            setValidationError(isValid ? undefined : `Please enter a valid ${getBlockchainDisplayName(blockchain)} address.`);
        } else {
            // No regex pattern (unknown blockchain) - accept any non-empty address
            setIsValid(true);
            setValidationError(undefined);
        }
    }, [value, blockchain, isNear, config.regex, validateOnMount, setIsValid, validateNearFull, resetValidation, updateValidationState]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Remove all whitespace to prevent it from being entered
        const val = e.target.value.replace(/\s/g, '');

        // If value hasn't changed after removing whitespace, don't update
        // This prevents validation state reset when user types whitespace
        if (val === value) {
            return;
        }

        setValue(val);
        hasUserInteractedRef.current = true;

        // Immediate validation feedback for NEAR
        if (isNear) {
            setHasValidated(false);
            if (!val) {
                resetValidation();
            } else if (!isValidNearAddressFormat(val)) {
                setValidationError("Invalid NEAR account format");
                setIsValid(false);
                updateValidationState(false);
            } else {
                setValidationError(undefined);
                setIsValid(false); // Wait for blockchain check
            }
            return;
        }

        // Immediate validation feedback for other blockchains
        if (!val) {
            resetValidation();
            return;
        }

        if (config.regex) {
            const isValid = config.regex.test(val);
            setIsValid(isValid);
            setValidationError(isValid || !val ? undefined : `Please enter a valid ${getBlockchainDisplayName(blockchain)} address.`);
        } else {
            // No regex pattern (e.g., unknown blockchain) - accept any non-empty address
            setIsValid(!!val);
            setValidationError(undefined);
        }
    };

    // Memoized validation state for border styling
    const validationBorderClass = useMemo(() => {
        const trimmedValue = value?.trim();
        if (!trimmedValue) return "";

        if (isNear) {
            if (isValidating) return "border-yellow-500"; // Validating
            if (validationError) return "border-red-500"; // Invalid
            // For NEAR, only show green after full validation passes
            return hasValidated && !validationError ? "border-green-500" : "";
        }

        // For other chains: immediate validation (or accept all if no pattern)
        if (!config.regex) {
            // No validation pattern - show green if non-empty (unknown blockchain)
            return trimmedValue ? "border-green-500" : "";
        }

        const isValid = config.regex.test(trimmedValue);
        return isValid ? "border-green-500" : "border-red-500";
    }, [value, isValidating, validationError, hasValidated, config.regex, isNear]);

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
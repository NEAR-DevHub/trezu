import Papa from "papaparse";
import { MAX_RECIPIENTS_PER_BULK_PAYMENT } from "@/lib/bulk-payment-api";
import {
    validateNearAddress,
    isValidNearAddressFormat,
} from "@/lib/near-validation";
import { getBatchStorageDepositIsRegistered } from "@/lib/api";
import { isNearToken, getBlockchainType, BlockchainType } from "@/lib/blockchain-utils";
import { getBlockchainDisplayName, validateAddress } from "@/lib/address-validation";
import type { BulkPaymentData } from "../schemas";
import type { TreasuryAsset } from "@/lib/api";
import Big from "@/lib/big";

/**
 * Common Papa Parse configuration
 */
const PAPA_PARSE_CONFIG: Papa.ParseConfig = {
    delimiter: "", // auto-detect delimiter (tries comma, tab, pipe, semicolon, etc.)
    skipEmptyLines: "greedy", // Skip lines with only whitespace
    header: false, // We want arrays, not objects
    dynamicTyping: false, // Keep everything as strings for consistent parsing
};

/**
 * Check if Papa Parse result has critical errors
 */
function hasCriticalParseErrors(errors: Papa.ParseError[]): boolean {
    const criticalErrors = errors.filter(
        (err) => err.type === "FieldMismatch" || err.type === "Quotes",
    );
    return criticalErrors.length > 0;
}

/**
 * Parse CSV or paste data using Papa Parse
 */
export function parseCsv(raw: string): string[][] {
    if (!raw.trim()) return [];

    const result = Papa.parse<string[]>(raw, PAPA_PARSE_CONFIG);

    // Check for critical parsing errors
    if (result.errors && result.errors.length > 0) {
        console.warn("CSV parsing errors:", result.errors);
        if (hasCriticalParseErrors(result.errors)) {
            console.error("Critical CSV parsing errors:", result.errors);
            throw new Error(
                "Failed to parse CSV data. Please check formatting.",
            );
        }
    }

    return result.data.filter((row: any) => row && row.length > 0);
}

/**
 * Detect if the first row/line is a header and return parsing configuration
 * Handles both paste data (string array) and CSV data (2D array)
 */
export function detectHeaderAndGetConfig(data: string[] | string[][]): {
    hasHeader: boolean;
    startRow: number;
    recipientIdx: number;
    amountIdx: number;
} {
    if (data.length === 0) {
        return { hasHeader: false, startRow: 0, recipientIdx: 0, amountIdx: 1 };
    }

    const firstItem = data[0];

    // Case 1: Array of strings (paste data - raw lines)
    if (typeof firstItem === "string") {
        const firstLine = firstItem.toLowerCase().trim();
        // More flexible header detection
        const hasRecipientHeader = firstLine.includes("recipient") ||
            firstLine.includes("wallet") ||
            firstLine.includes("receiver") ||
            firstLine.includes("address");
        const hasAmountHeader = firstLine.includes("amount") ||
            firstLine.includes("value") ||
            firstLine.includes("token");
        const hasHeader = hasRecipientHeader && hasAmountHeader;
        return {
            hasHeader,
            startRow: hasHeader ? 1 : 0,
            recipientIdx: 0,
            amountIdx: 1,
        };
    }

    // Case 2: Array of arrays (CSV data - parsed cells)
    if (Array.isArray(firstItem)) {
        const firstRow = firstItem as string[];
        const hasHeader = firstRow.some((cell) => {
            const cellLower = (cell || "").trim().toLowerCase();
            return (
                cellLower.startsWith("recipient") ||
                cellLower.startsWith("amount") ||
                cellLower.startsWith("wallet") ||
                cellLower.startsWith("receiver") ||
                cellLower.startsWith("address") ||
                cellLower.startsWith("value")
            );
        });

        if (hasHeader) {
            const colIdx = (names: string[]) =>
                firstRow.findIndex((h) => {
                    const cellLower = (h || "").trim().toLowerCase();
                    return names.some(name => cellLower.startsWith(name.toLowerCase()));
                });

            const recipientIdx = colIdx(["Recipient", "Wallet", "Receiver", "Address"]);
            const amountIdx = colIdx(["Amount", "Value", "Token"]);

            return {
                hasHeader: true,
                startRow: 1,
                recipientIdx,
                amountIdx,
            };
        }

        return {
            hasHeader: false,
            startRow: 0,
            recipientIdx: 0,
            amountIdx: 1,
        };
    }

    return { hasHeader: false, startRow: 0, recipientIdx: 0, amountIdx: 1 };
}

/**
 * Extract token symbol from amount string
 * Handles various formats:
 * - "100 NEAR" -> "NEAR"
 * - "100NEAR" -> "NEAR"
 * - "100 near" -> "NEAR" (case insensitive)
 * - "100.5  NEAR" -> "NEAR" (multiple spaces)
 * Returns null if no token symbol is found
 */
export function extractTokenSymbol(amountStr: string): string | null {
    const trimmed = amountStr.trim();
    // Match token symbol at the end (letters only, 2-10 chars, with or without space)
    // This regex handles: "100 NEAR", "100NEAR", "100.5NEAR", etc.
    const match = trimmed.match(/\s*([A-Za-z]{2,10})$/);
    return match ? match[1].toUpperCase() : null;
}

/**
 * Parse amount string handling different formats and decimal separators
 * Returns a normalized string that can be safely used with Big.js
 * Also extracts token symbol if present
 * 
 * Accepts various formats:
 * - "100" / "100.50" / "100,50"
 * - "100 NEAR" / "100NEAR" / "100 near" (with/without space, case insensitive)
 * - "1,000.50" / "1.000,50" (thousand separators)
 * 
 * ONLY allows: digits, comma, dot, spaces, and letters (for token symbols)
 * REJECTS: currency symbols ($, €, etc.), special characters
 */
export function parseAmount(amountStr: string): {
    amount: string;
    tokenSymbol: string | null;
    error?: string;
} {
    const trimmed = amountStr.trim();

    // Check for invalid characters BEFORE processing
    // Allow: digits (0-9), comma, dot, space, letters (for token symbols), and plus sign at start
    const invalidChars = trimmed.match(/[^0-9,.\s\+A-Za-z]/g);
    if (invalidChars) {
        const uniqueChars = [...new Set(invalidChars)].join(', ');
        return {
            amount: "",
            tokenSymbol: null,
            error: `Please remove these characters: ${uniqueChars}. Only numbers, commas, and dots are allowed.`
        };
    }

    // Extract token symbol if present (e.g., "100 NEAR" or "100NEAR")
    const tokenSymbol = extractTokenSymbol(trimmed);

    // Remove token symbol from the string (with or without space)
    let normalized = tokenSymbol
        ? trimmed.replace(new RegExp(`\\s*${tokenSymbol}$`, 'i'), '').trim()
        : trimmed;

    // Remove leading plus sign if present
    if (normalized.startsWith('+')) {
        normalized = normalized.substring(1);
    }

    // Remove spaces and underscores (used as thousand separators)
    normalized = normalized.replace(/[_\s]/g, "");

    // Handle empty or invalid input
    if (!normalized) return { amount: "", tokenSymbol, error: "Amount cannot be empty." };

    // Handle different decimal separators
    const hasComma = normalized.includes(",");
    const hasDot = normalized.includes(".");

    if (hasComma && hasDot) {
        // Both separators present: last one is decimal, others are thousands
        const lastCommaIndex = normalized.lastIndexOf(",");
        const lastDotIndex = normalized.lastIndexOf(".");

        if (lastDotIndex > lastCommaIndex) {
            // Dot is decimal: "1,000.50" -> "1000.50"
            normalized = normalized.replace(/,/g, "");
        } else {
            // Comma is decimal: "1.000,50" -> "1000.50"
            normalized = normalized.replace(/\./g, "").replace(",", ".");
        }
    } else if (hasComma) {
        // Only comma: check if it's decimal or thousands separator
        const parts = normalized.split(",");
        if (parts.length === 2 && parts[1].length <= 8) {
            // Likely decimal separator: "10,5" or "10,50"
            normalized = normalized.replace(",", ".");
        } else {
            // Likely thousands separator: "1,000" or "1,000,000"
            normalized = normalized.replace(/,/g, "");
        }
    }
    // If only dot, keep as-is (standard format)

    return { amount: normalized, tokenSymbol };
}

/**
 * Validate recipient address format based on blockchain
 * Returns user-friendly error messages with actionable guidance
 */
function validateRecipientAddress(
    address: string,
    blockchainType: string = "near"
): string | null {
    if (!address || address.trim() === "") {
        return "Missing recipient address. Please add an address in the first column.";
    }

    // For NEAR blockchain, use NEAR-specific validation
    if (blockchainType === "near") {
        if (!isValidNearAddressFormat(address)) {
            return `The address "${address}" is not a valid NEAR account.`;
        }
        return null;
    }

    const result = validateAddress(address, blockchainType as any);
    if (result.error) {
        return `The address "${address}" is not valid ${getBlockchainDisplayName(blockchainType as BlockchainType)} account.`;
    }
    return null;
}

/**
 * Parse payment data from CSV rows
 */
export function parsePaymentData(
    rows: string[][],
    recipientIdx: number,
    amountIdx: number,
    startRow: number,
    blockchain: string = "near",
    expectedTokenSymbol?: string,
): {
    payments: BulkPaymentData[];
    errors: Array<{ row: number; message: string }>;
} {
    const errors: Array<{ row: number; message: string }> = [];
    const payments: BulkPaymentData[] = [];
    const tokenSymbolsFound = new Set<string>();

    // Parse all rows
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const actualRowNumber = i + startRow + 1; // Adjust for display (1-indexed for user)

        // Skip empty rows
        if (row.every((cell) => !cell || !cell.trim())) {
            continue;
        }

        // Check if row has enough columns
        if (row.length < 2) {
            errors.push({
                row: actualRowNumber,
                message: `Row ${actualRowNumber}: Each row needs two values separated by a comma. Example: alice.near, 100`,
            });
            continue;
        }

        const recipient = (row[recipientIdx] || "").trim();

        // Join all remaining columns as the amount (handles cases like "2,500.75" split by comma delimiter)
        // This way "dave.near,2,500.75" which gets split to ["dave.near", "2", "500.75"]
        // will be reconstructed as "2,500.75"
        const amountParts = row.slice(amountIdx).filter(part => part && part.trim());
        const amountStr = amountParts.join(",").trim();

        // Validate that both recipient and amount exist
        if (!recipient) {
            errors.push({
                row: actualRowNumber,
                message: `Row ${actualRowNumber}: Missing recipient address. Please add an address before the comma.`,
            });
            continue;
        }

        if (!amountStr) {
            errors.push({
                row: actualRowNumber,
                message: `Row ${actualRowNumber}: Missing amount. Please add a number after the comma. Example: ${recipient}, 100`,
            });
            continue;
        }

        const parsedResult = parseAmount(amountStr);

        // Check if parseAmount returned an error (invalid characters)
        if (parsedResult.error) {
            errors.push({
                row: actualRowNumber,
                message: `Row ${actualRowNumber}: ${parsedResult.error}`,
            });
            continue;
        }

        const parsedAmountStr = parsedResult.amount;
        const tokenSymbol = parsedResult.tokenSymbol;

        // Track token symbols found
        if (tokenSymbol) {
            tokenSymbolsFound.add(tokenSymbol);
        }

        // Validate token symbol matches expected token (if provided)
        if (expectedTokenSymbol && tokenSymbol && tokenSymbol !== expectedTokenSymbol.toUpperCase()) {
            errors.push({
                row: actualRowNumber,
                message: `Row ${actualRowNumber}: You entered "${tokenSymbol}" but ${expectedTokenSymbol.toUpperCase()} is selected above. Either remove the token symbol or select ${tokenSymbol} from the dropdown.`,
            });
            continue;
        }

        // Validate amount is a valid number
        let parsedAmount: Big;
        try {
            if (!parsedAmountStr) {
                throw new Error(`The amount "${amountStr}" is not a valid number. Please use only numbers and decimals (e.g., 100 or 100.50).`);
            }
            parsedAmount = Big(parsedAmountStr);

            // Validate amount is positive
            if (parsedAmount.lte(0)) {
                throw new Error(`The amount must be greater than 0. You entered "${amountStr}".`);
            }

            // Validate amount doesn't exceed safe limit
            const MAX_SAFE = Big(Number.MAX_SAFE_INTEGER);
            if (parsedAmount.gt(MAX_SAFE)) {
                throw new Error(`The amount "${amountStr}" is too large. Please use a smaller number.`);
            }
        } catch (error) {
            // Clean up error message - remove any technical jargon
            let errorMessage = error instanceof Error ? error.message : "Invalid amount";
            // Strip technical prefixes like "[big.js]" or "Error:"
            errorMessage = errorMessage.replace(/^\[.*?\]\s*/, '').replace(/^Error:\s*/i, '');

            errors.push({
                row: actualRowNumber,
                message: `Row ${actualRowNumber}: ${errorMessage}`,
            });
            continue;
        }

        const validationError = validateRecipientAddress(recipient, blockchain);
        if (validationError) {
            errors.push({
                row: actualRowNumber,
                message: `Row ${actualRowNumber}: ${validationError}`,
            });
            continue;
        }

        payments.push({
            recipient,
            amount: parsedAmountStr, // Store as string to preserve precision
            validationError: validationError || undefined,
        });
    }

    // Check if multiple different token symbols were used
    if (tokenSymbolsFound.size > 1) {
        const symbols = Array.from(tokenSymbolsFound).join(", ");
        errors.push({
            row: 0,
            message: `You're using multiple token symbols (${symbols}). Please use only one token type throughout your file, or remove the token symbols and let the selection above determine the token.`,
        });
    }

    // Check if there were any parsing errors
    if (errors.length > 0) {
        return { payments: [], errors };
    }

    if (payments.length === 0) {
        return {
            payments: [],
            errors: [{ row: 0, message: "No payment data found. Please add your payments in this format: recipient, amount" }],
        };
    }

    // Check if exceeds maximum recipients limit
    if (payments.length > MAX_RECIPIENTS_PER_BULK_PAYMENT) {
        const excess = payments.length - MAX_RECIPIENTS_PER_BULK_PAYMENT;
        return {
            payments: [],
            errors: [
                {
                    row: 0,
                    message: `You have ${payments.length} recipients, but the limit is ${MAX_RECIPIENTS_PER_BULK_PAYMENT} per batch. Please remove ${excess} recipient${excess > 1 ? 's' : ''} or split into multiple batches.`,
                },
            ],
        };
    }

    return { payments, errors: [] };
}

/**
 * Unified function to parse and validate data (CSV or paste)
 */
function parseAndValidateData(
    input: string,
    errorPrefix: string,
    blockchain: string = "near",
    expectedTokenSymbol?: string,
): {
    payments: BulkPaymentData[];
    errors: Array<{ row: number; message: string }>;
} {
    try {
        const rows = parseCsv(input);

        if (rows.length === 0) {
            return {
                payments: [],
                errors: [{ row: 0, message: "No payment data provided. Please enter your payments in this format: recipient, amount" }],
            };
        }

        // Detect header and get column configuration
        const { hasHeader, startRow, recipientIdx, amountIdx } =
            detectHeaderAndGetConfig(rows);

        // If header detected but columns are missing, show error
        if (hasHeader && (recipientIdx === -1 || amountIdx === -1)) {
            return {
                payments: [],
                errors: [
                    {
                        row: 1,
                        message:
                            "We detected a header row, but couldn't find the 'Recipient' and 'Amount' columns. Please use these column names, or remove the header row.",
                    },
                ],
            };
        }

        // Extract data rows (skip header if present)
        const dataRows = rows.slice(startRow);

        // Use unified parser with blockchain parameter
        return parsePaymentData(dataRows, recipientIdx, amountIdx, startRow, blockchain, expectedTokenSymbol);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : `Failed to parse ${errorPrefix}`;
        return {
            payments: [],
            errors: [
                {
                    row: 0,
                    message: errorMsg,
                },
            ],
        };
    }
}

/**
 * Parse and validate CSV data
 */
export function parseAndValidateCsv(
    csvData: string,
    selectedToken?: { symbol?: string; network?: string; residency?: string }
): {
    payments: BulkPaymentData[];
    errors: Array<{ row: number; message: string }>;
} {
    const blockchain = selectedToken?.network
        ? getBlockchainType(selectedToken.network)
        : "near";
    const tokenSymbol = selectedToken?.symbol;
    return parseAndValidateData(csvData, "CSV data", blockchain, tokenSymbol);
}

/**
 * Parse and validate paste data
 */
export function parseAndValidatePasteData(
    pasteData: string,
    selectedToken?: { symbol?: string; network?: string; residency?: string }
): {
    payments: BulkPaymentData[];
    errors: Array<{ row: number; message: string }>;
} {
    // Normalize line breaks
    const normalizedInput = pasteData.replace(/\\n/g, "\n").trim();
    const blockchain = selectedToken?.network
        ? getBlockchainType(selectedToken.network)
        : "near";
    const tokenSymbol = selectedToken?.symbol;
    return parseAndValidateData(normalizedInput, "paste data", blockchain, tokenSymbol);
}

/**
 * Check if token needs storage deposit check
 */
export function needsStorageDepositCheck(token: {
    residency?: string;
}): boolean {
    // Intents, Near tokens don't need storage deposits
    // FT tokens need storage deposits
    return token.residency === "Ft";
}

/**
 * Validate accounts and check storage deposits
 */
export async function validateAccountsAndStorage(
    payments: BulkPaymentData[],
    selectedToken: { address: string; residency?: string; network?: string },
): Promise<BulkPaymentData[]> {
    const isNear = isNearToken(selectedToken.network, selectedToken.residency);

    // Step 1: Validate account existence (only for NEAR)
    if (isNear) {
        const accountValidatedPayments = await Promise.all(
            payments.map(async (payment) => {
                // Skip if already has validation error
                if (payment.validationError) {
                    return payment;
                }

                try {
                    const validationError = await validateNearAddress(
                        payment.recipient,
                    );

                    return {
                        ...payment,
                        validationError: validationError || undefined,
                    };
                } catch (error) {
                    console.error(`Error validating ${payment.recipient}:`, error);
                    return {
                        ...payment,
                        validationError: "Failed to validate account",
                    };
                }
            }),
        );

        // Step 2: Check storage registration for FT tokens (only for valid accounts)
        if (!needsStorageDepositCheck(selectedToken)) {
            return accountValidatedPayments;
        }

        // Filter only valid accounts
        const validAccounts = accountValidatedPayments.filter(
            (payment) => !payment.validationError,
        );

        if (validAccounts.length === 0) {
            return accountValidatedPayments;
        }

        const tokenId = selectedToken.address;

        const storageRequests = validAccounts.map((payment) => ({
            accountId: payment.recipient,
            tokenId: tokenId,
        }));

        const storageRegistrations =
            await getBatchStorageDepositIsRegistered(storageRequests);

        const registrationMap = new Map<string, boolean>();
        storageRegistrations.forEach((reg) => {
            registrationMap.set(
                `${reg.accountId}-${reg.tokenId}`,
                reg.isRegistered,
            );
        });

        return accountValidatedPayments.map((payment) => {
            if (payment.validationError) {
                return payment;
            }

            const key = `${payment.recipient}-${tokenId}`;
            const isRegistered = registrationMap.get(key) ?? false;

            return {
                ...payment,
                isRegistered,
            };
        });
    }

    // For non-NEAR tokens, validation was done during CSV parsing
    // Just return payments as-is
    return payments;
}

import Big from "@/lib/big";
import { clsx, type ClassValue } from "clsx";
import { format } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function toBase64(json: any) {
    return Buffer.from(JSON.stringify(json)).toString("base64");
}

export function formatCurrency(value: number | Big) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
    }).format(typeof value === "number" ? value : Number(value.toString()));
}

/**
 * Format token amount with optimal precision based on USD value
 * Shows enough decimals to represent $0.01 equivalent accurately (truncated, never rounded up)
 *
 * @param bigIntAmount - Token amount in smallest unit as string (e.g., "30517641175187890330" for 30.517 ETH with 18 decimals)
 * @param tokenDecimals - Number of decimals for the token (e.g., 18 for ETH, 8 for BTC)
 * @param tokenPrice - USD price per token (e.g., 60000 for BTC)
 * @returns Formatted string with thousand separators and optimal decimals
 *
 * @example
 * // BTC @ $60,000:
 * formatTokenAmount("50000000", 8, 60000)    // "0.5" ($30,000)
 * formatTokenAmount("250000", 8, 60000)      // "0.0025" ($150)
 * formatTokenAmount("3333", 8, 60000)        // "0.00003333" ($2)
 *
 * // ETH @ $3,000:
 * formatTokenAmount("10000000000000000000", 18, 3000)  // "10" ($30,000)
 * formatTokenAmount("50000000000000000", 18, 3000)     // "0.05" ($150)
 */
export function formatTokenAmount(
    bigIntAmount: string,
    tokenDecimals: number,
    tokenPrice: number,
): string {
    // Step 1: Convert to Big decimal number
    const divisor = Big(10).pow(tokenDecimals);
    const tokenAmount = Big(bigIntAmount).div(divisor);

    // Step 2: Determine decimals needed to represent $0.01 equivalent
    // We need: tokenAmount * price to be accurate within $0.01
    // Required token precision = $0.01 / tokenPrice
    const requiredTokenPrecision = Big(0.01).div(tokenPrice);

    // Step 3: Calculate decimals needed: ceil(-log10(requiredTokenPrecision))
    // Using: -log10(x) = -ln(x) / ln(10)
    const log10Value =
        Math.log(Number(requiredTokenPrecision.toString())) / Math.log(10);
    const decimalsNeeded = Math.max(0, Math.ceil(-log10Value));

    // Cap at token's native decimals (e.g., 18 for ETH, 8 for BTC)
    const finalDecimals = Math.min(decimalsNeeded, tokenDecimals);

    // Step 4: Format with calculated decimals (truncate, don't round up)
    // We must never show more tokens than the user will actually receive
    const multiplier = Big(10).pow(finalDecimals);
    const truncated = tokenAmount
        .mul(multiplier)
        .round(0, Big.roundDown)
        .div(multiplier);
    let formatted = truncated.toFixed(finalDecimals);

    // Remove trailing zeros
    formatted = formatted.replace(/\.?0+$/, "");

    // Add thousand separators
    const parts = formatted.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    formatted = parts.join(".");

    return formatted;
}

/**
 * Format a proposal status-based date with relative time.
 * - Future dates (pending/expiring): "in X minutes/hours/days/months"
 * - Past dates (executed/rejected/etc): "X minutes/hours/days/months ago"
 * - After 6 months threshold: absolute date "Mar 12, 2026"
 *
 * @param date - The relevant date for the status (expiration, execution, etc.)
 * @param isFuture - Whether the date is in the future (for pending expiry)
 * @returns Formatted string
 */
export function formatProposalStatusDate(
    date: Date,
    isFuture: boolean,
): string {
    const now = new Date();
    const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

    const diffMs = isFuture
        ? date.getTime() - now.getTime()
        : now.getTime() - date.getTime();

    // If beyond 6 months, show absolute date
    if (diffMs > SIX_MONTHS_MS) {
        return format(date, "MMM d, yyyy");
    }

    const diffInSeconds = Math.floor(diffMs / 1000);
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    const diffInHours = Math.floor(diffInMinutes / 60);
    const diffInDays = Math.floor(diffInHours / 24);
    const diffInMonths = Math.floor(diffInDays / 30);

    let relative: string;

    if (diffInMonths >= 1) {
        relative = diffInMonths === 1 ? "1 month" : `${diffInMonths} months`;
    } else if (diffInDays >= 1) {
        relative = diffInDays === 1 ? "1 day" : `${diffInDays} days`;
    } else if (diffInHours >= 1) {
        relative = diffInHours === 1 ? "1 hour" : `${diffInHours} hours`;
    } else if (diffInMinutes >= 1) {
        relative =
            diffInMinutes === 1 ? "1 minute" : `${diffInMinutes} minutes`;
    } else {
        relative = "moments";
    }

    return isFuture ? `in ${relative}` : `${relative} ago`;
}

/**
 * Format a date as relative time (e.g., "2 minutes ago", "Yesterday")
 * After 1 week, returns static date format (e.g., "Feb 18, 2026")
 */
export function formatRelativeTime(date: Date | string | number): string {
    const dateObj =
        typeof date === "string" || typeof date === "number"
            ? new Date(date)
            : date;
    const now = new Date();
    const diffInSeconds = Math.floor(
        (now.getTime() - dateObj.getTime()) / 1000,
    );
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    const diffInHours = Math.floor(diffInMinutes / 60);
    const diffInDays = Math.floor(diffInHours / 24);
    const diffInWeeks = Math.floor(diffInDays / 7);

    // Just now (less than 1 minute)
    if (diffInSeconds < 60) {
        return "Just now";
    }

    // Minutes ago (1-59 minutes)
    if (diffInMinutes < 60) {
        return diffInMinutes === 1
            ? "1 minute ago"
            : `${diffInMinutes} minutes ago`;
    }

    // Hours ago (1-23 hours)
    if (diffInHours < 24) {
        return diffInHours === 1 ? "1 hour ago" : `${diffInHours} hours ago`;
    }

    // Yesterday
    if (diffInDays === 1) {
        return "Yesterday";
    }

    // Days ago (2-6 days)
    if (diffInDays < 7) {
        return `${diffInDays} days ago`;
    }

    // Week ago (exactly 7 days)
    if (diffInWeeks === 1) {
        return "1 week ago";
    }

    // After 1 week: static date format (e.g., "Feb 18, 2026")
    return format(dateObj, "MMM d, yyyy");
}

export function formatTimestamp(date: Date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime() * 1000000;
}

/**
 * Format date according to user preferences (timezone and time format)
 * @param date - Date to format
 * @param options - Formatting options
 * @returns Formatted date string
 */
export interface FormatUserDateOptions {
    /** User's timezone (e.g., "America/New_York", "UTC") */
    timezone?: string | null;
    /** Time format: 12-hour or 24-hour */
    timeFormat?: "12" | "24";
    /** Whether to include time in the output */
    includeTime?: boolean;
    /** Whether to include timezone abbreviation */
    includeTimezone?: boolean;
    /** Custom date-fns format string (overrides other options) */
    customFormat?: string;
}

export function formatUserDate(
    date: Date | string | number,
    options: FormatUserDateOptions = {},
): string {
    if (!date) return "";

    const {
        timezone = null,
        timeFormat = "12",
        includeTime = true,
        includeTimezone = true,
        customFormat,
    } = options;

    // Convert to Date object
    let dateObj: Date;
    if (typeof date === "string" || typeof date === "number") {
        dateObj = new Date(date);
    } else {
        dateObj = date;
    }

    // If custom format is provided, use date-fns format
    if (customFormat) {
        return format(dateObj, customFormat);
    }

    // Use Intl.DateTimeFormat for timezone-aware formatting
    try {
        const formatOptions: Intl.DateTimeFormatOptions = {
            month: "short",
            day: "numeric",
            year: "numeric",
            ...(timezone && { timeZone: timezone }),
        };

        // Add time formatting options if requested
        if (includeTime) {
            formatOptions.hour = "numeric";
            formatOptions.minute = "2-digit";
            formatOptions.hour12 = timeFormat === "12";
        }

        // Add timezone name if requested
        if (includeTimezone && includeTime) {
            formatOptions.timeZoneName = "short";
        }

        const formatter = new Intl.DateTimeFormat("en-US", formatOptions);
        return formatter.format(dateObj).replace("GMT", "UTC");
    } catch (error) {
        console.error("Error formatting date with Intl:", error);

        // Fallback to date-fns formatting
        let formatString = "MMM dd, yyyy";
        if (includeTime) {
            formatString += timeFormat === "12" ? " hh:mm a" : " HH:mm";
        }

        let formattedDate = format(dateObj, formatString);

        // Add timezone info as fallback
        if (includeTimezone) {
            const timezoneOffset = dateObj.getTimezoneOffset();
            const offsetHours = Math.abs(Math.floor(timezoneOffset / 60));
            const offsetMinutes = Math.abs(timezoneOffset % 60);

            let timezoneStr = "UTC";
            if (timezoneOffset !== 0) {
                const sign = timezoneOffset > 0 ? "-" : "+";
                timezoneStr = `UTC${sign}${offsetHours}${offsetMinutes > 0 ? `:${offsetMinutes.toString().padStart(2, "0")}` : ""}`;
            }
            formattedDate += ` ${timezoneStr}`;
        }

        // return formattedDate;
        return dateObj.toUTCString().replace("GMT", "UTC");
    }
}

export function formatGas(gas: string): string {
    return `${formatBalance(gas, 12, 2)}`;
}

export function formatBalance(
    balance: string | Big,
    decimals: number,
    displayDecimals: number = 5,
): string {
    // Handle null/undefined/empty values
    if (!balance || (typeof balance === "string" && balance.trim() === "")) {
        return "0";
    }

    let parsedBalance: Big;
    if (typeof balance === "string") {
        try {
            parsedBalance = Big(balance);
        } catch (error) {
            console.error(
                "[formatBalance] Error parsing balance string:",
                error,
                { balance },
            );
            return "0";
        }
    } else {
        parsedBalance = balance;
    }
    return parsedBalance
        .div(Big(10).pow(decimals))
        .toFixed(displayDecimals, 3)
        .replace(/\.?0+$/, "");
}

export function formatNearAmount(
    amount: string,
    displayDecimals: number = 5,
): string {
    return formatBalance(amount, 24, displayDecimals);
}

/**
 * Format a number with smart precision and thousand separators
 * - For numbers >= 1: shows up to 4 decimals
 * - For numbers < 1: shows up to 8 significant figures
 *
 * @param value - The value to format (number, string, or Big)
 * @returns Formatted string with smart precision and thousand separators
 *
 * @example
 * formatSmartAmount(1234.5678) => "1,234.5678"
 * formatSmartAmount(0.000123456) => "0.00012346"
 * formatSmartAmount(0.00000000012) => "0.00000000012"
 */
export function formatSmartAmount(value: number | string | Big): string {
    const num =
        typeof value === "number" || typeof value === "string"
            ? parseFloat(value.toString())
            : parseFloat(value.toString());

    // Handle zero
    if (num === 0) return "0";

    const absNum = Math.abs(num);
    const absBig =
        typeof value === "object" && "toFixed" in value
            ? value.abs()
            : Big(absNum.toString());

    let formatted: string;

    // For numbers >= 1, show up to 4 decimals
    if (absNum >= 1) {
        formatted = absBig.toFixed(4).replace(/\.?0+$/, "");
    } else {
        // For small numbers, find first significant digit and show up to 8 significant figures
        const str = absNum.toExponential();
        const [, exponent] = str.split("e");
        const exp = Math.abs(parseInt(exponent));

        // Show enough decimals to display ~6-8 significant figures
        const decimalPlaces = Math.min(exp + 6, 18);
        formatted = absBig.toFixed(decimalPlaces).replace(/\.?0+$/, "");
    }

    // Add thousands separator using locale formatting
    const parts = formatted.split(".");
    const integerPart = parseInt(parts[0]).toLocaleString();
    return parts[1] ? `${integerPart}.${parts[1]}` : integerPart;
}

/**
 * Format an activity amount with sign (+/-) for display in transaction lists
 * Uses smart precision: 4 decimals for amounts >= 1, up to 8 significant figures for smaller amounts
 * NOTE: Expects amount to already be in human-readable format (e.g., "0.000123" NEAR, not yoctoNEAR)
 *
 * @param amount - The amount in human-readable format (positive for received, negative for sent)
 * @returns Formatted amount with sign and smart precision, e.g., "+1,234.5678" or "-0.000123"
 */
export function formatActivityAmount(amount: string): string {
    const num = parseFloat(amount);

    // Handle zero
    if (num === 0) return "+0";

    const sign = num >= 0 ? "+" : "-";
    const formatted = formatSmartAmount(Math.abs(num));

    return `${sign}${formatted}`;
}

/**
 * Decodes base64 encoded function call arguments
 * @param args - Base64 encoded string
 * @returns Parsed JSON object or null if decoding fails
 */
export function decodeArgs(args: string): any {
    try {
        const decoded = atob(args);
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

/**
 * Parse key to readable format (snake_case/camelCase -> Title Case)
 */
export const parseKeyToReadableFormat = (key: string) => {
    return key
        .replace(/_/g, " ") // Replace underscores with spaces
        .replace(/([a-z])([A-Z])/g, "$1 $2") // Add spaces between camelCase or PascalCase words
        .replace(/\b\w/g, (c) => c.toUpperCase()); // Capitalize each word
};

/**
 * Encode data object to markdown format for DAO proposals
 */
export const encodeToMarkdown = (data: any) => {
    return Object.entries(data)
        .filter(([key, value]) => {
            return (
                key && // Key exists and is not null/undefined
                value !== null &&
                value !== undefined &&
                value !== ""
            );
        })
        .map(([key, value]) => {
            return `* ${parseKeyToReadableFormat(key)}: ${String(value)}`;
        })
        .join(" <br>");
};

/**
 * Decode proposal description to extract specific key value
 * Supports both JSON and markdown formats
 */
export const decodeProposalDescription = (key: string, description: string) => {
    // Try to parse as JSON
    let parsedData;
    try {
        parsedData = JSON.parse(description);
        if (parsedData && parsedData[key] !== undefined) {
            return parsedData[key]; // Return value from JSON if key exists
        }
    } catch (error) {
        // Not JSON, proceed to parse as markdown
    }

    // Handle as markdown
    const markdownKey = parseKeyToReadableFormat(key);

    const lines = description.split("<br>");
    for (const line of lines) {
        if (line.startsWith("* ")) {
            const rest = line.slice(2);
            const indexOfColon = rest.indexOf(":");
            if (indexOfColon !== -1) {
                const currentKey = rest.slice(0, indexOfColon).trim();
                const value = rest.slice(indexOfColon + 1).trim();

                if (currentKey.toLowerCase() === markdownKey.toLowerCase()) {
                    return value;
                }
            }
        }
    }

    return null; // Return null if key not found
};

/**
 * Format nanoseconds to human-readable duration
 * @param nanoseconds - Duration in nanoseconds as string
 * @returns Human-readable duration string (e.g., "7 days", "2 weeks, 3 days", "5 hours")
 */
export function formatNanosecondDuration(nanoseconds: string): string {
    const ns = BigInt(nanoseconds);

    // Convert to different units
    const seconds = Number(ns / BigInt(1_000_000_000));
    const minutes = seconds / 60;
    const hours = minutes / 60;
    const days = hours / 24;

    if (days >= 1) {
        const wholeDays = Math.floor(days);
        const remainingHours = Math.floor(hours % 24);
        if (remainingHours > 0) {
            return `${wholeDays} day${wholeDays !== 1 ? "s" : ""}, ${remainingHours} hour${remainingHours !== 1 ? "s" : ""}`;
        }
        return `${wholeDays} day${wholeDays !== 1 ? "s" : ""}`;
    } else if (hours >= 1) {
        const wholeHours = Math.floor(hours);
        return `${wholeHours} hour${wholeHours !== 1 ? "s" : ""}`;
    } else if (minutes >= 1) {
        const wholeMinutes = Math.floor(minutes);
        return `${wholeMinutes} minute${wholeMinutes !== 1 ? "s" : ""}`;
    } else {
        return `${seconds} second${seconds !== 1 ? "s" : ""}`;
    }
}

import { type ClassValue, clsx } from "clsx";
import { format } from "date-fns";
import { twMerge } from "tailwind-merge";
import { NEAR_NETWORK_ID } from "@/constants/network-ids";
import Big from "@/lib/big";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Built-in btoa() JS function fails on UTF8 inputs.
// `Buffer` polyfill brings +30kb to the minified bundle.
// https://stackoverflow.com/questions/23223718/failed-to-execute-btoa-on-window-the-string-to-be-encoded-contains-characte
export function jsonToBase64(json: any): string {
    const uint8Array = new TextEncoder().encode(JSON.stringify(json));
    let binary = "";

    for (let i = 0; i < uint8Array.length; ++i) {
        binary += String.fromCharCode(uint8Array[i]);
    }

    return btoa(binary);
}

export function base64ToJson(base64: string): any {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    return JSON.parse(decoded);
}

export interface RelativeTimeLabels {
    /** "Just now" for past dates under a minute old (formatRelativeTime only). */
    justNow: string;
    /** Locale BCP47 tag for Intl.RelativeTimeFormat + absolute date fallback. */
    locale: string;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function formatAbsoluteDate(date: Date, locale: string): string {
    return date.toLocaleDateString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function intlRelative(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    locale: string,
): string {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
        value,
        unit,
    );
}

/**
 * Single relative-time scale shared by every "X ago" / "in X" label:
 * - < 1 minute  → "30 seconds ago" / "in 30 seconds"
 * - < 1 hour    → "12 minutes ago" / "in 12 minutes"
 * - < 1 day     → "3 hours ago"
 * - < 1 week    → "2 days ago" ("yesterday" / "tomorrow" for 1 day)
 * - < 2 weeks   → "last week" / "next week"
 * - otherwise   → absolute date, e.g. "Sep 12, 2026"
 *
 * @param diffMs - Absolute distance from now, in ms
 * @param sign - -1 for past dates, 1 for future dates
 */
function formatRelativeDuration(
    date: Date,
    diffMs: number,
    sign: -1 | 1,
    locale: string,
): string {
    if (diffMs >= 2 * WEEK_MS) {
        return formatAbsoluteDate(date, locale);
    }
    if (diffMs >= WEEK_MS) {
        return intlRelative(sign, "week", locale);
    }
    if (diffMs >= DAY_MS) {
        return intlRelative(sign * Math.floor(diffMs / DAY_MS), "day", locale);
    }
    if (diffMs >= HOUR_MS) {
        return intlRelative(
            sign * Math.floor(diffMs / HOUR_MS),
            "hour",
            locale,
        );
    }
    if (diffMs >= MINUTE_MS) {
        return intlRelative(
            sign * Math.floor(diffMs / MINUTE_MS),
            "minute",
            locale,
        );
    }
    return intlRelative(
        sign * Math.max(1, Math.floor(diffMs / 1000)),
        "second",
        locale,
    );
}

/**
 * Relative time for a proposal status date (see formatRelativeDuration for
 * the scale). The caller prefixes the status verb: "Expires in 2 hours",
 * "Executed 2 days ago".
 *
 * @param date - The relevant date for the status (expiration, execution, etc.)
 * @param isFuture - Whether the date is in the future (pending expiry)
 */
export function formatProposalStatusDate(
    date: Date,
    isFuture: boolean,
    labels: RelativeTimeLabels,
): string {
    const now = Date.now();
    const diffMs = isFuture ? date.getTime() - now : now - date.getTime();
    return formatRelativeDuration(
        date,
        Math.max(0, diffMs),
        isFuture ? 1 : -1,
        labels.locale,
    );
}

function normalizeDate(
    date: Date | string | number | null | undefined,
): Date | null {
    if (date == null || date === "") {
        return null;
    }

    const dateObj =
        typeof date === "string" || typeof date === "number"
            ? new Date(date)
            : date;

    return Number.isNaN(dateObj.getTime()) ? null : dateObj;
}

/**
 * Relative time for a past date, e.g. "Just now", "2 minutes ago",
 * "yesterday", "last week", then the absolute date after two weeks.
 */
export function formatRelativeTime(
    date: Date | string | number | null | undefined,
    labels: RelativeTimeLabels,
): string {
    const dateObj = normalizeDate(date);
    if (!dateObj) {
        return "";
    }

    const diffMs = Date.now() - dateObj.getTime();
    if (diffMs < MINUTE_MS) {
        return labels.justNow;
    }
    return formatRelativeDuration(dateObj, diffMs, -1, labels.locale);
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
    date: Date | string | number | null | undefined,
    options: FormatUserDateOptions = {},
): string {
    const dateObj = normalizeDate(date);
    if (!dateObj) return "";

    const {
        timezone = null,
        timeFormat = "12",
        includeTime = true,
        includeTimezone = true,
        customFormat,
    } = options;

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
        return normalizeUtcTimezoneLabel(formatter.format(dateObj));
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

            let timezoneStr = "UTC+00:00";
            if (timezoneOffset !== 0) {
                const sign = timezoneOffset > 0 ? "-" : "+";
                timezoneStr = `UTC${sign}${offsetHours}${offsetMinutes > 0 ? `:${offsetMinutes.toString().padStart(2, "0")}` : ""}`;
            }
            formattedDate += ` ${timezoneStr}`;
        }

        return formattedDate;
    }
}

/** Prefer UTC+00:00 over bare GMT/UTC so zero-offset times show an explicit offset. */
function normalizeUtcTimezoneLabel(formatted: string): string {
    return formatted
        .replace("GMT", "UTC")
        .replace(/\bUTC\b(?![+-])/, "UTC+00:00");
}

export function formatGas(gas: string | null | undefined): string {
    try {
        return Big(gas ?? "")
            .div(Big(10).pow(12))
            .toFixed(2, Big.roundDown)
            .replace(/\.?0+$/, "");
    } catch {
        return "—";
    }
}

export function sumIntegerStrings(values: readonly string[]): string | null {
    try {
        return values
            .reduce((sum, value) => sum + BigInt(value), BigInt(0))
            .toString();
    } catch {
        return null;
    }
}

const NEAR_INTENTS_EXPLORER_BASE = "https://explorer.near-intents.org";

/**
 * Build the NEAR Intents explorer URL for a deposit address.
 *
 * Confidential treasuries use the privacy-preserving `/mask/{depositAddress}`
 * route; public treasuries use the standard `/transactions/{depositAddress}`
 * route.
 *
 * @param depositAddress - The 1Click deposit address for the swap.
 * @param isConfidential - Whether the proposal/treasury is confidential.
 * @returns The explorer URL, or null when no deposit address is available.
 */
export function getIntentsExplorerUrl(
    depositAddress: string | null | undefined,
    isConfidential: boolean,
): string | null {
    if (!depositAddress) return null;
    const path = isConfidential ? "mask" : "transactions";
    return `${NEAR_INTENTS_EXPLORER_BASE}/${path}/${depositAddress}`;
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

    return undefined;
};

/** Convert a nanosecond timestamp/duration (string) to milliseconds. */
export function nanosToMs(nanoseconds: string): number {
    return Big(nanoseconds).div(1_000_000).toNumber();
}

/** Convert milliseconds to a nanosecond string. */
export function msToNanos(ms: number): string {
    return Big(Math.round(ms)).times(1_000_000).toFixed(0);
}

/**
 * Normalize asset ids for NEAR FT comparisons.
 *
 * Some code paths use prefixed ids (e.g. "nep141:token.near") while others
 * use bare contract ids ("token.near"). This helper makes those comparable.
 */
export function normalizeNearAssetId(value?: string | null): string {
    const normalized = (value || "").trim().toLowerCase();
    // Keep 1Click Omni routing ids intact (do not strip as nep141 contracts).
    if (normalized.startsWith("1cs_v1:")) {
        return normalized;
    }
    return normalized.startsWith("nep141:")
        ? normalized.slice("nep141:".length)
        : normalized;
}

/**
 * Canonicalize token IDs across intents / NEAR prefixes for matching.
 *
 * Examples:
 * - intents.near:nep245:v2_1.omni.hot.tg:56_... -> v2_1.omni.hot.tg:56_...
 * - nep245:v2_1.omni.hot.tg:56_... -> v2_1.omni.hot.tg:56_...
 * - nep141:wrap.near -> wrap.near
 * - 1cs_v1:btc:native:coin -> 1cs_v1:btc:native:coin (unchanged)
 */
export function canonicalizeTokenIdForMatch(value?: string | null): string {
    const trimmed = (value || "").trim().toLowerCase();
    if (trimmed.startsWith("1cs_v1:")) {
        return trimmed;
    }
    return normalizeNearAssetId(value)
        .replace(/^intents\.near:/i, "")
        .replace(/^nep245:/i, "")
        .toLowerCase();
}

/**
 * Returns a human-readable NEAR token type label based on the tokenId.
 * - "" or "near" → "NEAR (Native Token)"
 * - starts with "nep141:" or "nep245:" → "NEAR (near.com)" or "near.com"
 * - anything else (contract address) → "NEAR (Fungible Token)"
 *
 * Returns null for non-NEAR networks so callers can fall back to the chain name.
 */
export function getNearTokenTypeLabel(
    tokenId: string,
    network?: string,
    options?: { expandNearComLabel?: boolean },
): string | null {
    const resolvedNetwork = network?.toLowerCase() ?? NEAR_NETWORK_ID;
    if (resolvedNetwork !== NEAR_NETWORK_ID) return null;

    const id = tokenId.toLowerCase();
    if (id === "" || id === NEAR_NETWORK_ID) return "NEAR (Native Token)";
    if (id.startsWith("nep141:") || id.startsWith("nep245:")) {
        return options?.expandNearComLabel === false
            ? "near.com"
            : "NEAR (near.com)";
    }
    return "NEAR (Fungible Token)";
}

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

/**
 * Format seconds using Intl.DurationFormat.
 * Returns null when input is invalid.
 */
export function formatDurationSeconds(
    value: number | string | null | undefined,
    locale: string,
): string | null {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return null;

    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;

    const formatter = new (Intl as any).DurationFormat(locale, {
        style: "long",
    });
    const duration: Record<string, number> = {};
    if (hours > 0) duration.hours = hours;
    if (minutes > 0) duration.minutes = minutes;
    if (remainingSeconds > 0 || Object.keys(duration).length === 0) {
        duration.seconds = remainingSeconds;
    }
    return formatter.format(duration);
}

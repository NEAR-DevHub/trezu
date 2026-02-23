/**
 * Format history duration based on months
 * Converts to years if it's a whole year (12, 24, 36, etc.)
 * 
 * @param historyMonths - Number of months of history allowed by the plan
 * @param includePrefix - Whether to include "last" prefix (default: true)
 * @returns Formatted duration string
 * 
 * @example
 * formatHistoryDuration(3) => "last 3 months"
 * formatHistoryDuration(12) => "last 1 year"
 * formatHistoryDuration(24) => "last 2 years"
 * formatHistoryDuration(null) => "unlimited history"
 * formatHistoryDuration(12, false) => "1 year"
 */
export function formatHistoryDuration(
    historyMonths: number | null | undefined,
    includePrefix: boolean = true
): string {
    if (!historyMonths) return "unlimited history";

    // Convert to years if it's a whole year (12, 24, 36, etc.)
    if (historyMonths % 12 === 0) {
        const years = historyMonths / 12;
        const duration = years === 1 ? "1 year" : `${years} years`;
        return includePrefix ? `last ${duration}` : duration;
    }

    // Otherwise show months
    const duration = `${historyMonths} months`;
    return includePrefix ? `last ${duration}` : duration;
}

/**
 * Get a full description for history including transaction type
 * 
 * @param historyMonths - Number of months of history allowed by the plan
 * @returns Full description string
 * 
 * @example
 * getHistoryDescription(3) => "Sent and received transactions (last 3 months)"
 * getHistoryDescription(12) => "Sent and received transactions (last 1 year)"
 * getHistoryDescription(null) => "View all your transaction history"
 */
export function getHistoryDescription(
    historyMonths: number | null | undefined
): string {
    if (!historyMonths) return "View all your transaction history";

    const duration = formatHistoryDuration(historyMonths, true);
    return `Sent and received transactions (${duration})`;
}

/**
 * Activity type for helper functions
 */
export interface ActivityAccount {
    counterparty: string | null;
    signerId: string | null;
    receiverId: string | null;
    swap?: any; // Swap object if this is a swap transaction
    actionKind?: string | null;
    methodName?: string | null;
    amount?: string;
}

/**
 * Get the display label for an activity based on its action kind.
 *
 * - Swaps → "Swap"
 * - FunctionCall → "Function Call"
 * - Transfer → "Transfer Received" / "Transfer Sent"
 * - Fallback (no action data) → "Payment Received" / "Payment Sent"
 */
export function getActivityLabel(activity: ActivityAccount): string {
    if (activity.swap) return "Swap";
    const isReceived = parseFloat(activity.amount ?? "0") > 0;

    if (activity.actionKind === "FunctionCall") {
        return "Function Call";
    }
    if (activity.actionKind === "Transfer") {
        return isReceived ? "Transfer Received" : "Transfer Sent";
    }
    // Fallback for records without action data
    return "";
}

/**
 * Get the sub-label (description line) for an activity.
 *
 * - Swaps → "via NEAR Intents"
 * - FunctionCall → "{methodName} on {contract}"
 * - Transfer / fallback → "from {sender}" or "to {recipient}"
 */
export function getActivitySubLabel(
    activity: ActivityAccount,
    treasuryId: string | null | undefined,
): string {
    if (activity.swap) return "via NEAR Intents";
    const isReceived = parseFloat(activity.amount ?? "0") > 0;

    if (activity.actionKind === "FunctionCall" && activity.methodName) {
        const contract = activity.receiverId || activity.counterparty || "unknown";
        return `${activity.methodName} on ${contract}`;
    }

    if (isReceived) {
        const from = activity.counterparty || activity.signerId || "unknown";
        return `from ${from}`;
    }
    const to = activity.receiverId || activity.counterparty || treasuryId || "unknown";
    return `to ${to}`;
}

/**
 * Determines the sender of a transaction
 * For swaps: show "via NEAR Intents"
 * For received payments: show the counterparty who sent funds
 * For sent payments: show the signer who initiated the transaction
 * 
 * @param activity - The activity object containing counterparty, signerId, and swap info
 * @param isReceived - Whether this is a received payment (amount > 0)
 * @returns The sender account ID or "—" if not available
 */
export function getFromAccount(activity: ActivityAccount, isReceived: boolean): string {
    if (activity.swap) return "via NEAR Intents";
    if (isReceived && activity.counterparty) {
        return activity.counterparty;
    }
    return activity.signerId || "—";
}

/**
 * Determines the recipient of a transaction
 * For swaps: show treasury (swaps are always treasury operations)
 * For sent payments: show receiverId (primary), fallback to counterparty, then treasuryId
 * For received payments: show treasuryId (the treasury is always the recipient)
 * 
 * @param activity - The activity object containing receiverId, counterparty, and swap info
 * @param isReceived - Whether this is a received payment (amount > 0)
 * @param treasuryId - The treasury account ID (recipient for received payments)
 * @returns The recipient account ID or "—" if not available
 */
export function getToAccount(
    activity: ActivityAccount,
    isReceived: boolean,
    treasuryId: string | null | undefined
): string {
    if (activity.swap) return treasuryId || "—";
    if (!isReceived) {
        return activity.receiverId || activity.counterparty || treasuryId || "—";
    }
    return treasuryId || "—";
}


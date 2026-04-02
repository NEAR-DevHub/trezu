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
    includePrefix: boolean = true,
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
    historyMonths: number | null | undefined,
): string {
    if (!historyMonths) return "View all your transaction history";

    const duration = formatHistoryDuration(historyMonths, true);
    return `Sent and received transactions (${duration})`;
}

const PROPOSAL_METHODS = ["add_proposal", "act_proposal"];

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
    tokenSymbol?: string;
}

/**
 * Get the display label for an activity based on its action kind.
 *
 * Priority order:
 * 1. Swaps → "Exchange"
 * 2. Staking rewards → "Staking Rewards"
 * 3. Proposal actions → "Proposal Action"
 * 4. Incoming → "Deposit [TOKEN]"
 * 5. Outgoing → "Payment Sent"
 * 6. No action data → "Transaction"
 */
export function getActivityLabel(activity: ActivityAccount): string {
    if (activity.swap) {
        return activity.swap.swapRole === "deposit"
            ? "Exchange Request"
            : "Exchange Fulfillment";
    }
    if (activity.actionKind === "StakingReward") return "Staking Rewards";

    if (
        activity.actionKind === "FunctionCall" &&
        activity.methodName &&
        PROPOSAL_METHODS.includes(activity.methodName)
    ) {
        return "Proposal Action";
    }

    const isReceived = parseFloat(activity.amount ?? "0") > 0;

    if (activity.actionKind) {
        if (isReceived) {
            const symbol = activity.tokenSymbol || "Token";
            return `Deposit ${symbol}`;
        }
        return "Payment Sent";
    }

    // Fallback for records without action data (not backfilled yet)
    return "Transaction";
}

/**
 * Get the sub-label (description line) for an activity.
 *
 * - Swaps → "via NEAR Intents"
 * - Staking rewards → pool address
 * - Proposal actions → method name
 * - Incoming → "from {counterparty}" (only if known)
 * - Outgoing → "to {counterparty}" (only if known)
 * - No action data → empty
 */
export function getActivitySubLabel(
    activity: ActivityAccount,
    _treasuryId: string | null | undefined,
): string {
    if (activity.swap) return "via NEAR Intents";

    if (activity.actionKind === "StakingReward") return "";

    if (
        activity.actionKind === "FunctionCall" &&
        activity.methodName &&
        PROPOSAL_METHODS.includes(activity.methodName)
    ) {
        return "";
    }

    const isReceived = parseFloat(activity.amount ?? "0") > 0;

    if (isReceived) {
        const from = activity.counterparty || activity.signerId;
        return from && from !== "UNKNOWN" ? `from ${from}` : "";
    }

    const to = activity.counterparty || activity.receiverId;
    return to && to !== "UNKNOWN" ? `to ${to}` : "";
}

/**
 * Determines the sender of a transaction
 * For swaps: show "via NEAR Intents"
 * For received payments: show the counterparty who sent funds (if known)
 * For sent payments: sender is always the DAO
 */
export function getFromAccount(
    activity: ActivityAccount,
    isReceived: boolean,
    treasuryId: string | null | undefined,
): string {
    if (activity.swap) return "via NEAR Intents";
    const knownCounterparty =
        activity.counterparty && activity.counterparty !== "UNKNOWN"
            ? activity.counterparty
            : null;
    if (isReceived) {
        return knownCounterparty || activity.signerId || "—";
    }
    return treasuryId || "—";
}

/**
 * Determines the recipient of a transaction
 * For swaps: show treasury
 * For sent payments: receiver is the counterparty
 * For received payments: receiver is treasuryId
 */
export function getToAccount(
    activity: ActivityAccount,
    isReceived: boolean,
    treasuryId: string | null | undefined,
): string {
    if (isReceived) return treasuryId || "—";
    const knownCounterparty =
        activity.counterparty && activity.counterparty !== "UNKNOWN"
            ? activity.counterparty
            : null;
    return knownCounterparty || activity.receiverId || "—";
}

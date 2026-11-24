/**
 * Classify wallet/signing errors: a user declining or closing their wallet is
 * an expected outcome (Info — never reported to Sentry); everything else from
 * a signing flow is a real failure worth reporting.
 */

// "action was cancelled": a wallet executor (Meteor via NEAR Connect) when
// the user dismisses the prompt. "wallet closed": near-connect's own
// rejection when the user closes the wallet iframe.
const REJECTION_PATTERNS =
    /user reject|rejected by user|user cancel|cancelled by user|canceled by user|action was cancell?ed|user denied|user closed|popup closed|window closed|wallet closed|modal closed|user abort|aborted by user|denied by user/i;

export function isUserRejection(error: unknown): boolean {
    if (typeof error === "string") {
        return REJECTION_PATTERNS.test(error);
    }
    if (error instanceof Error) {
        return REJECTION_PATTERNS.test(error.message);
    }
    if (typeof error === "object" && error !== null) {
        const message = (error as { message?: unknown }).message;
        return typeof message === "string" && REJECTION_PATTERNS.test(message);
    }
    return false;
}

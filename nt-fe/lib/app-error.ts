import { isAxiosError } from "axios";
import { isUserRejection } from "@/lib/wallet-errors";

export const APP_ERROR_CODES = [
    "SERVICE_UNAVAILABLE",
    "SPONSORSHIP_NOT_AVAILABLE",
    "NOT_AUTHORIZED",
    "REQUEST_REJECTED",
    "RPC_UNAVAILABLE",
    "TX_STATUS_UNKNOWN",
    "TX_FAILED",
    "WALLET_REJECTED",
    "WALLET_FAILED",
    "UNEXPECTED",
] as const;
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export const TX_FAILURE_REASONS = [
    "INSUFFICIENT_BALANCE",
    "REQUEST_EXPIRED",
    "REQUEST_NOT_ACTIVE",
    "ALREADY_VOTED",
    "RECIPIENT_NOT_REGISTERED",
    "INSUFFICIENT_PERMISSIONS",
    "OUT_OF_GAS",
    "UNKNOWN",
] as const;
export type TxFailureReason = (typeof TX_FAILURE_REASONS)[number];

const FUNDS_STATES = ["none", "not_sent", "unknown", "failed_onchain"] as const;
export type FundsState = (typeof FUNDS_STATES)[number];

export interface AppError {
    code: AppErrorCode;
    fundsState: FundsState;
    retryable: boolean;
    requestId?: string;
    txHash?: string;
    reason?: TxFailureReason;
}

const REQUEST_ID_HEADER = "x-request-id";

const SHOWN = Symbol.for("trezu.errorShownToUser");

/** Flag an error the user has already been told about, so callers further up
 * the stack that catch it again do not stack a second message on top. */
export function markShownToUser(error: unknown): void {
    if (typeof error === "object" && error !== null) {
        (error as Record<symbol, unknown>)[SHOWN] = true;
    }
}

export function wasShownToUser(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as Record<symbol, unknown>)[SHOWN] === true
    );
}

function oneOf<T extends string>(
    values: readonly T[],
    value: unknown,
): T | undefined {
    return values.find((candidate) => candidate === value);
}

/**
 * Normalize anything thrown by a user action into the error the UI renders.
 * The backend says which error and what state the funds are in; an envelope
 * it did not send (network failure, legacy string body) is classified here.
 */
export function toAppError(error: unknown): AppError {
    if (isUserRejection(error)) {
        return {
            code: "WALLET_REJECTED",
            fundsState: "not_sent",
            retryable: true,
        };
    }
    if (!isAxiosError(error)) {
        return {
            code: "WALLET_FAILED",
            fundsState: "not_sent",
            retryable: true,
        };
    }

    const response = error.response;
    if (!response) {
        return {
            code: "SERVICE_UNAVAILABLE",
            fundsState: "none",
            retryable: true,
        };
    }

    const headerValue = response.headers?.[REQUEST_ID_HEADER];
    const requestId = typeof headerValue === "string" ? headerValue : undefined;
    const envelope = (response.data as { error?: unknown } | undefined)?.error;

    if (typeof envelope === "object" && envelope !== null) {
        const body = envelope as Record<string, unknown>;
        const details = (body.details ?? {}) as Record<string, unknown>;
        const code = oneOf(APP_ERROR_CODES, body.code);
        return {
            code: code ?? "UNEXPECTED",
            fundsState: oneOf(FUNDS_STATES, body.funds_state) ?? "unknown",
            retryable: body.retryable === true,
            requestId,
            txHash:
                typeof details.tx_hash === "string"
                    ? details.tx_hash
                    : undefined,
            reason: oneOf(TX_FAILURE_REASONS, details.reason),
        };
    }

    // A body without the envelope proves nothing about a server-side failure,
    // so it is never reported as "not sent".
    const serverFailed = response.status >= 500;
    return {
        code: response.status === 503 ? "SERVICE_UNAVAILABLE" : "UNEXPECTED",
        fundsState: serverFailed ? "unknown" : "none",
        retryable: serverFailed,
        requestId,
    };
}

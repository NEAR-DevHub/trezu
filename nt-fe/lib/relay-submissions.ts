import { isAxiosError } from "axios";
import { getRelaySubmission, type RelaySubmissionStatus } from "@/lib/api";
import { RelaySubmissionFailedError } from "@/lib/app-error";

/**
 * Relays the backend accepted with `202`: their outcome arrives over the
 * treasury's SSE stream as `relay_submission_updated`. Pending ids are kept
 * in localStorage per treasury so a refresh, a reconnect or a tab coming
 * back to the foreground can fetch each one once; nothing polls on a timer.
 */

const STORAGE_PREFIX = "relay:pending:";
const MAX_REMEMBERED = 20;
const MAX_SETTLED = 50;
/// A lagging stream can skip events; while anyone is waiting, re-read the
/// pending set this often so a lost event delays a result instead of losing it.
const SAFETY_CHECK_MS = 60_000;

type Waiter = {
    treasuryId: string;
    resolve: (status: RelaySubmissionStatus) => void;
    reject: (error: Error) => void;
};

const waiters = new Map<string, Waiter[]>();
// One recovery per treasury at a time; concurrent triggers (stream open, tab
// visible, safety tick) share the run already in flight.
const recoveries = new Map<string, Promise<void>>();
let safetyTimer: ReturnType<typeof setInterval> | null = null;
// Terminal results seen before anyone waited on them (the event can beat the
// `202` response back to the caller).
const settled = new Map<string, RelaySubmissionStatus>();

function storageKey(treasuryId: string) {
    return `${STORAGE_PREFIX}${treasuryId}`;
}

function readRemembered(treasuryId: string): string[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(storageKey(treasuryId));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
            ? parsed.filter((id): id is string => typeof id === "string")
            : [];
    } catch {
        return [];
    }
}

function writeRemembered(treasuryId: string, ids: string[]) {
    if (typeof window === "undefined") return;
    try {
        if (ids.length === 0) {
            window.localStorage.removeItem(storageKey(treasuryId));
        } else {
            window.localStorage.setItem(
                storageKey(treasuryId),
                JSON.stringify(ids.slice(-MAX_REMEMBERED)),
            );
        }
    } catch {
        // Storage unavailable: the SSE event still settles live waiters.
    }
}

/** Submissions this tab is waiting on for the treasury, whatever storage says. */
function awaitedIds(treasuryId: string): string[] {
    const ids: string[] = [];
    for (const [submissionId, list] of waiters) {
        if (list.some((waiter) => waiter.treasuryId === treasuryId)) {
            ids.push(submissionId);
        }
    }
    return ids;
}

function runSafetyChecks() {
    const treasuries = new Set<string>();
    for (const list of waiters.values()) {
        for (const waiter of list) treasuries.add(waiter.treasuryId);
    }
    for (const treasuryId of treasuries) {
        void recoverPendingSubmissions(treasuryId);
    }
}

function syncSafetyTimer() {
    if (waiters.size > 0 && safetyTimer === null) {
        safetyTimer = setInterval(runSafetyChecks, SAFETY_CHECK_MS);
    } else if (waiters.size === 0 && safetyTimer !== null) {
        clearInterval(safetyTimer);
        safetyTimer = null;
    }
}

/** Remove and return everyone waiting on the submission. */
function takeWaiters(submissionId: string): Waiter[] {
    const list = waiters.get(submissionId) ?? [];
    waiters.delete(submissionId);
    syncSafetyTimer();
    return list;
}

/** Visible for tests: whether a safety check is scheduled. */
export function hasPendingWaiters(): boolean {
    return waiters.size > 0;
}

export function rememberPendingSubmission(
    treasuryId: string,
    submissionId: string,
) {
    const ids = readRemembered(treasuryId).filter((id) => id !== submissionId);
    ids.push(submissionId);
    writeRemembered(treasuryId, ids);
}

export function forgetPendingSubmission(
    treasuryId: string,
    submissionId: string,
) {
    writeRemembered(
        treasuryId,
        readRemembered(treasuryId).filter((id) => id !== submissionId),
    );
}

export function pendingSubmissionIds(treasuryId: string): string[] {
    return readRemembered(treasuryId);
}

export function isTerminalSubmission(status: RelaySubmissionStatus): boolean {
    return status.state !== "pending";
}

/** Hand a terminal status to everyone waiting on it and stop remembering it. */
export function settleRelaySubmission(status: RelaySubmissionStatus) {
    if (!isTerminalSubmission(status)) return;
    forgetPendingSubmission(status.treasuryId, status.submissionId);
    settled.set(status.submissionId, status);
    if (settled.size > MAX_SETTLED) {
        const oldest = settled.keys().next().value;
        if (oldest !== undefined) settled.delete(oldest);
    }
    for (const waiter of takeWaiters(status.submissionId)) {
        waiter.resolve(status);
    }
}

/**
 * The backend no longer knows the submission: nobody will ever get a terminal
 * status for it, so waiters fail with the outcome marked unknown.
 */
function abandonRelaySubmission(treasuryId: string, submissionId: string) {
    forgetPendingSubmission(treasuryId, submissionId);
    const pending = takeWaiters(submissionId);
    if (pending.length === 0) return;
    const error = new RelaySubmissionFailedError(
        {
            code: "TX_STATUS_UNKNOWN",
            funds_state: "unknown",
            retryable: false,
            details: {},
        },
        submissionId,
    );
    for (const waiter of pending) waiter.reject(error);
}

/**
 * Resolve when the submission's terminal state arrives, however it arrives;
 * reject when the backend reports it does not exist.
 */
export function awaitRelaySubmission(
    treasuryId: string,
    submissionId: string,
): Promise<RelaySubmissionStatus> {
    const known = settled.get(submissionId);
    if (known) return Promise.resolve(known);
    rememberPendingSubmission(treasuryId, submissionId);
    return new Promise((resolve, reject) => {
        const list = waiters.get(submissionId) ?? [];
        list.push({ treasuryId, resolve, reject });
        waiters.set(submissionId, list);
        syncSafetyTimer();
    });
}

/**
 * Fetch every remembered submission once, plus any this tab still waits on
 * (another tab may have cleared the shared storage). Called on stream
 * (re)connect, on the tab becoming visible, and on mount, because events
 * emitted while the stream was down are never replayed.
 */
export function recoverPendingSubmissions(
    treasuryId: string,
    fetchStatus: (
        submissionId: string,
    ) => Promise<RelaySubmissionStatus> = getRelaySubmission,
): Promise<void> {
    const inFlight = recoveries.get(treasuryId);
    if (inFlight) return inFlight;
    const run = recoverOnce(treasuryId, fetchStatus).finally(() => {
        recoveries.delete(treasuryId);
    });
    recoveries.set(treasuryId, run);
    return run;
}

async function recoverOnce(
    treasuryId: string,
    fetchStatus: (submissionId: string) => Promise<RelaySubmissionStatus>,
): Promise<void> {
    const ids = new Set([
        ...readRemembered(treasuryId),
        ...awaitedIds(treasuryId),
    ]);
    await Promise.all(
        [...ids].map(async (submissionId) => {
            try {
                const status = await fetchStatus(submissionId);
                if (isTerminalSubmission(status)) settleRelaySubmission(status);
            } catch (error) {
                if (isAxiosError(error) && error.response?.status === 404) {
                    abandonRelaySubmission(treasuryId, submissionId);
                }
            }
        }),
    );
}

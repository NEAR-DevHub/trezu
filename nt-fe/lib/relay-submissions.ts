import { isAxiosError } from "axios";
import { getRelaySubmission, type RelaySubmissionStatus } from "@/lib/api";

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

type Waiter = (status: RelaySubmissionStatus) => void;

const waiters = new Map<string, Waiter[]>();
const waitingTreasuries = new Map<string, number>();
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

function runSafetyChecks() {
    for (const treasuryId of waitingTreasuries.keys()) {
        void recoverPendingSubmissions(treasuryId);
    }
}

function trackWaiter(treasuryId: string) {
    waitingTreasuries.set(
        treasuryId,
        (waitingTreasuries.get(treasuryId) ?? 0) + 1,
    );
    if (safetyTimer === null) {
        safetyTimer = setInterval(runSafetyChecks, SAFETY_CHECK_MS);
    }
}

function untrackWaiters(treasuryId: string, count: number) {
    const left = (waitingTreasuries.get(treasuryId) ?? 0) - count;
    if (left > 0) {
        waitingTreasuries.set(treasuryId, left);
    } else {
        waitingTreasuries.delete(treasuryId);
    }
    if (waitingTreasuries.size === 0 && safetyTimer !== null) {
        clearInterval(safetyTimer);
        safetyTimer = null;
    }
}

/** Visible for tests: whether a safety check is scheduled. */
export function hasPendingWaiters(): boolean {
    return waitingTreasuries.size > 0;
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
    const pending = waiters.get(status.submissionId) ?? [];
    waiters.delete(status.submissionId);
    untrackWaiters(status.treasuryId, pending.length);
    for (const resolve of pending) resolve(status);
}

/** Resolve when the submission's terminal state arrives, however it arrives. */
export function awaitRelaySubmission(
    treasuryId: string,
    submissionId: string,
): Promise<RelaySubmissionStatus> {
    const known = settled.get(submissionId);
    if (known) return Promise.resolve(known);
    rememberPendingSubmission(treasuryId, submissionId);
    trackWaiter(treasuryId);
    return new Promise((resolve) => {
        const list = waiters.get(submissionId) ?? [];
        list.push(resolve);
        waiters.set(submissionId, list);
    });
}

/**
 * Fetch every remembered submission once. Called on stream (re)connect, on
 * the tab becoming visible, and on mount, because events emitted while the
 * stream was down are never replayed.
 */
export async function recoverPendingSubmissions(
    treasuryId: string,
    fetchStatus: (
        submissionId: string,
    ) => Promise<RelaySubmissionStatus> = getRelaySubmission,
): Promise<void> {
    await Promise.all(
        readRemembered(treasuryId).map(async (submissionId) => {
            try {
                const status = await fetchStatus(submissionId);
                if (isTerminalSubmission(status)) settleRelaySubmission(status);
            } catch (error) {
                if (isAxiosError(error) && error.response?.status === 404) {
                    forgetPendingSubmission(treasuryId, submissionId);
                }
            }
        }),
    );
}

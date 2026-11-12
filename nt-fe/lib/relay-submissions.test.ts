import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AxiosError, type AxiosResponse } from "axios";
import type { RelaySubmissionStatus } from "./api";
import { RelaySubmissionFailedError } from "./app-error";
import {
    awaitRelaySubmission,
    forgetPendingSubmission,
    hasPendingWaiters,
    pendingSubmissionIds,
    recoverPendingSubmissions,
    rememberPendingSubmission,
    settleRelaySubmission,
} from "./relay-submissions";

class MemoryStorage {
    private items = new Map<string, string>();
    getItem(key: string) {
        return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string) {
        this.items.set(key, value);
    }
    removeItem(key: string) {
        this.items.delete(key);
    }
}

const TREASURY = "dao.sputnik-dao.near";

function status(
    submissionId: string,
    state: RelaySubmissionStatus["state"],
): RelaySubmissionStatus {
    return { submissionId, treasuryId: TREASURY, state, txHash: "hash" };
}

function notFound(): AxiosError {
    const response = { status: 404, data: {} } as unknown as AxiosResponse;
    return new AxiosError("Not found", "ERR", undefined, null, response);
}

type WindowHost = { window?: unknown };
const hadWindow = "window" in globalThis;
const realWindow = (globalThis as WindowHost).window;

beforeEach(() => {
    (globalThis as WindowHost).window = {
        localStorage: new MemoryStorage(),
    };
});

afterEach(() => {
    if (hadWindow) {
        (globalThis as WindowHost).window = realWindow;
    } else {
        delete (globalThis as WindowHost).window;
    }
});

describe("relay submissions", () => {
    test("a waiter resolves when the terminal event arrives", async () => {
        const waiting = awaitRelaySubmission(TREASURY, "s1");
        expect(pendingSubmissionIds(TREASURY)).toEqual(["s1"]);
        expect(hasPendingWaiters()).toBe(true);

        settleRelaySubmission(status("s1", "pending"));
        expect(pendingSubmissionIds(TREASURY)).toEqual(["s1"]);

        settleRelaySubmission(status("s1", "succeeded"));
        expect((await waiting).state).toBe("succeeded");
        expect(pendingSubmissionIds(TREASURY)).toEqual([]);
        expect(hasPendingWaiters()).toBe(false);
    });

    test("an event that beats the waiter still resolves it", async () => {
        settleRelaySubmission(status("s2", "failed"));
        const late = await awaitRelaySubmission(TREASURY, "s2");
        expect(late.state).toBe("failed");
    });

    test("recovery fetches every remembered submission once and forgets unknown ones", async () => {
        rememberPendingSubmission(TREASURY, "done");
        rememberPendingSubmission(TREASURY, "still");
        rememberPendingSubmission(TREASURY, "gone");
        const waiting = awaitRelaySubmission(TREASURY, "done");
        const fetched: string[] = [];

        await recoverPendingSubmissions(TREASURY, async (id) => {
            fetched.push(id);
            if (id === "gone") throw notFound();
            return status(id, id === "done" ? "succeeded" : "pending");
        });

        expect(fetched.sort()).toEqual(["done", "gone", "still"]);
        expect((await waiting).state).toBe("succeeded");
        expect(pendingSubmissionIds(TREASURY)).toEqual(["still"]);
    });

    test("a 404 during recovery fails the waiter and stops tracking it", async () => {
        const waiting = awaitRelaySubmission(TREASURY, "vanished");
        await recoverPendingSubmissions(TREASURY, async () => {
            throw notFound();
        });
        const error = await waiting.catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RelaySubmissionFailedError);
        expect((error as RelaySubmissionFailedError).submissionId).toBe(
            "vanished",
        );
        expect(pendingSubmissionIds(TREASURY)).toEqual([]);
        expect(hasPendingWaiters()).toBe(false);
    });

    test("recovery still checks a waited submission another tab forgot", async () => {
        const waiting = awaitRelaySubmission(TREASURY, "shared");
        forgetPendingSubmission(TREASURY, "shared");
        expect(pendingSubmissionIds(TREASURY)).toEqual([]);

        const fetched: string[] = [];
        await recoverPendingSubmissions(TREASURY, async (id) => {
            fetched.push(id);
            return status(id, "succeeded");
        });

        expect(fetched).toEqual(["shared"]);
        expect((await waiting).state).toBe("succeeded");
        expect(hasPendingWaiters()).toBe(false);
    });

    test("overlapping recoveries for one treasury share a single run", async () => {
        rememberPendingSubmission(TREASURY, "r1");
        rememberPendingSubmission(TREASURY, "r2");
        const fetched: string[] = [];
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const fetchStatus = async (id: string) => {
            fetched.push(id);
            await gate;
            return status(id, "succeeded");
        };

        const first = recoverPendingSubmissions(TREASURY, fetchStatus);
        const second = recoverPendingSubmissions(TREASURY, fetchStatus);
        expect(second).toBe(first);
        release();
        await Promise.all([first, second]);
        expect(fetched.sort()).toEqual(["r1", "r2"]);

        await recoverPendingSubmissions(TREASURY, fetchStatus);
        expect(fetched.length).toBe(2);
    });

    test("recovery survives a failing status fetch", async () => {
        rememberPendingSubmission(TREASURY, "flaky");
        await recoverPendingSubmissions(TREASURY, async () => {
            throw new Error("offline");
        });
        expect(pendingSubmissionIds(TREASURY)).toEqual(["flaky"]);
    });
});

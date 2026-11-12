import type { QueryClient } from "@tanstack/react-query";
import type {
    RelaySubmissionError,
    RelaySubmissionState,
    RelaySubmissionStatus,
} from "@/lib/api";
import { settleRelaySubmission } from "@/lib/relay-submissions";

export const APP_EVENT_TYPES = {
    treasuryProjectionUpdated: "treasury_projection_updated",
    relaySubmissionUpdated: "relay_submission_updated",
} as const;

export const APP_EVENT_NAMES = Object.values(APP_EVENT_TYPES);

export type TreasuryProjectionUpdatedEvent = {
    type: typeof APP_EVENT_TYPES.treasuryProjectionUpdated;
    accountId: string;
    emittedAt: string;
};

export type RelaySubmissionUpdatedEvent = {
    type: typeof APP_EVENT_TYPES.relaySubmissionUpdated;
    accountId: string;
    emittedAt: string;
    data: RelaySubmissionStatus;
};

export type AppEvent =
    | TreasuryProjectionUpdatedEvent
    | RelaySubmissionUpdatedEvent;

const RELAY_SUBMISSION_STATES: readonly RelaySubmissionState[] = [
    "pending",
    "succeeded",
    "failed",
    "manual_review",
];

export type AppEventScope = {
    treasuryId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object";
}

function parseTreasuryProjectionUpdatedEvent(
    value: Record<string, unknown>,
): TreasuryProjectionUpdatedEvent | null {
    if (
        value.type !== APP_EVENT_TYPES.treasuryProjectionUpdated ||
        typeof value.accountId !== "string" ||
        typeof value.emittedAt !== "string"
    ) {
        return null;
    }

    return {
        type: APP_EVENT_TYPES.treasuryProjectionUpdated,
        accountId: value.accountId,
        emittedAt: value.emittedAt,
    };
}

function parseRelaySubmissionError(
    value: unknown,
): RelaySubmissionError | undefined {
    if (
        !isRecord(value) ||
        typeof value.code !== "string" ||
        typeof value.funds_state !== "string"
    ) {
        return undefined;
    }
    const details = isRecord(value.details) ? value.details : {};
    return {
        code: value.code,
        funds_state: value.funds_state,
        retryable: value.retryable === true,
        details: {
            tx_hash:
                typeof details.tx_hash === "string"
                    ? details.tx_hash
                    : undefined,
            reason:
                typeof details.reason === "string" ? details.reason : undefined,
        },
    };
}

function parseRelaySubmissionStatus(
    value: unknown,
): RelaySubmissionStatus | null {
    if (
        !isRecord(value) ||
        typeof value.submissionId !== "string" ||
        typeof value.treasuryId !== "string" ||
        typeof value.state !== "string"
    ) {
        return null;
    }
    const state = RELAY_SUBMISSION_STATES.find(
        (candidate) => candidate === value.state,
    );
    if (!state) {
        return null;
    }
    return {
        submissionId: value.submissionId,
        treasuryId: value.treasuryId,
        state,
        txHash: typeof value.txHash === "string" ? value.txHash : undefined,
        proposalIds: Array.isArray(value.proposalIds)
            ? value.proposalIds.filter(
                  (id): id is number => typeof id === "number",
              )
            : undefined,
        error: parseRelaySubmissionError(value.error),
    };
}

function parseRelaySubmissionUpdatedEvent(
    value: Record<string, unknown>,
): RelaySubmissionUpdatedEvent | null {
    if (
        value.type !== APP_EVENT_TYPES.relaySubmissionUpdated ||
        typeof value.accountId !== "string" ||
        typeof value.emittedAt !== "string"
    ) {
        return null;
    }
    const data = parseRelaySubmissionStatus(value.data);
    if (!data) {
        return null;
    }
    return {
        type: APP_EVENT_TYPES.relaySubmissionUpdated,
        accountId: value.accountId,
        emittedAt: value.emittedAt,
        data,
    };
}

export function parseAppEvent(raw: string): AppEvent | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }

    if (!isRecord(value) || typeof value.type !== "string") {
        return null;
    }

    switch (value.type) {
        case APP_EVENT_TYPES.treasuryProjectionUpdated:
            return parseTreasuryProjectionUpdatedEvent(value);
        case APP_EVENT_TYPES.relaySubmissionUpdated:
            return parseRelaySubmissionUpdatedEvent(value);
        default:
            return null;
    }
}

/**
 * Invalidate every query the projection-updated event covers. Also used as
 * a catch-up on SSE reconnect: events emitted while the stream was down are
 * never replayed, so a reconnect must assume state changed in the gap.
 */
export async function invalidateTreasuryScopedQueries(
    queryClient: QueryClient,
    accountId: string,
) {
    await Promise.all([
        queryClient.invalidateQueries({
            queryKey: ["recentActivity", accountId],
        }),
        queryClient.invalidateQueries({
            queryKey: ["treasuryAssets", accountId],
        }),
        queryClient.invalidateQueries({
            queryKey: ["balanceChart", accountId],
        }),
        queryClient.invalidateQueries({
            queryKey: ["recentActivitySenders", accountId],
        }),
        queryClient.invalidateQueries({
            queryKey: ["recentActivityRecipients", accountId],
        }),
        queryClient.invalidateQueries({
            queryKey: ["depositTracker", accountId],
        }),
    ]);
}

async function invalidateTreasuryProjectionQueries(
    queryClient: QueryClient,
    event: TreasuryProjectionUpdatedEvent,
    scope: AppEventScope,
) {
    if (!scope.treasuryId || event.accountId !== scope.treasuryId) {
        return;
    }

    await invalidateTreasuryScopedQueries(queryClient, event.accountId);
}

export async function handleAppEvent(
    queryClient: QueryClient,
    event: AppEvent,
    scope: AppEventScope,
) {
    switch (event.type) {
        case APP_EVENT_TYPES.treasuryProjectionUpdated:
            await invalidateTreasuryProjectionQueries(
                queryClient,
                event,
                scope,
            );
            return;
        case APP_EVENT_TYPES.relaySubmissionUpdated:
            // The stream is already scoped to one treasury; whoever awaits
            // this submission gets its terminal state here.
            settleRelaySubmission(event.data);
            return;
    }
}

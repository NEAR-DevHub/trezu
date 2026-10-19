import { useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import {
    getProposals,
    ProposalFilters,
    ProposalsResponse,
    getProposal,
    getProposalTransaction,
    Proposal,
    getSwapStatus,
    getQuoteByDepositAddress,
    getTokenPriceAtTimestamp,
} from "@/lib/proposals-api";
import { isTerminalSwapStatus } from "@/features/proposals/utils/receipt-utils";
import { isAxiosErrorWithStatus } from "@/lib/query-retry";
import { nanosToMs } from "@/lib/utils";
import { Policy } from "@/types/policy";

/**
 * How long after a request is submitted its swap can still settle. A 1Click
 * quote expires within this window (it is requested when the proposal is
 * created and outlives the voting period only by a few days), and past the
 * deadline the deposit is refunded rather than swapped. A status still in
 * flight after that is an orphan (a deposit that never arrived, a bridge
 * that never answered); polling it would pin the page to a heartbeat
 * forever, so it is read once per load instead.
 */
const SWAP_SETTLING_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

export function isWithinSwapSettlingWindow(
    proposal: Pick<Proposal, "submission_time"> | null | undefined,
): boolean {
    return (
        !!proposal &&
        nanosToMs(proposal.submission_time) + SWAP_SETTLING_WINDOW_MS > Date.now()
    );
}

/**
 * A request whose persisted 1Click outcome is not final yet. Its status is
 * read from the proposal itself, so the proposal query is what has to keep
 * refreshing until the backend stores a terminal outcome (or the settling
 * window closes).
 */
function hasSettlingSwap(proposal: Proposal | null | undefined): boolean {
    return (
        proposal?.status === "Approved" &&
        !!proposal.swap_status &&
        !isTerminalSwapStatus(proposal.swap_status) &&
        isWithinSwapSettlingWindow(proposal)
    );
}

const SETTLING_SWAP_POLL_MS = 10_000;

function refetchListWhileSettling(
    query: Query<ProposalsResponse>,
): number | false {
    return query.state.data?.proposals.some(hasSettlingSwap)
        ? SETTLING_SWAP_POLL_MS
        : false;
}

function refetchProposalWhileSettling(
    query: Query<Proposal | null>,
): number | false {
    return hasSettlingSwap(query.state.data) ? SETTLING_SWAP_POLL_MS : false;
}

/**
 * Query hook to get proposals for a specific DAO with optional filtering
 * Fetches from Sputnik DAO API with support for pagination, sorting, and various filters
 *
 * @param daoId - The DAO account ID to fetch proposals for
 * @param filters - Optional filters for proposals (status, search, types, pagination, etc.)
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { data, isLoading } = useProposals("example.sputnik-dao.near");
 *
 * // With filters
 * const { data } = useProposals("example.sputnik-dao.near", {
 *   statuses: ["InProgress", "Approved"],
 *   page: 0,
 *   page_size: 20,
 *   sort_by: "CreationTime",
 *   sort_direction: "desc"
 * });
 *
 * // With search and type filters
 * const { data } = useProposals("example.sputnik-dao.near", {
 *   search: "funding",
 *   proposal_types: ["Transfer", "FunctionCall"],
 *   proposers: ["alice.near"]
 * });
 * ```
 */
export function useProposals(
    daoId: string | null | undefined,
    filters?: ProposalFilters,
    enabled: boolean = true,
    options?: {
        refetchInterval?:
            | number
            | false
            | ((query: Query<ProposalsResponse>) => number | false);
        refetchOnMount?: boolean | "always";
    },
) {
    const filtersKey = filters ? JSON.stringify(filters) : null;
    return useQuery({
        queryKey: ["proposals", daoId, filtersKey],
        queryFn: () => getProposals(daoId!, filters),
        enabled: enabled && !!daoId,
        staleTime: 1000 * 10, // 10 seconds (proposals can change frequently)
        refetchOnMount: options?.refetchOnMount,
        refetchInterval: options?.refetchInterval ?? refetchListWhileSettling,
    });
}

export function useProposal(
    daoId: string | null | undefined,
    proposalId: string | null | undefined,
) {
    return useQuery({
        queryKey: ["proposal", daoId, proposalId],
        queryFn: () => getProposal(daoId!, proposalId!),
        enabled: !!daoId && !!proposalId,
        staleTime: 1000 * 10, // 10 seconds (proposals can change frequently)
        refetchInterval: refetchProposalWhileSettling,
    });
}

/** NearBlocks indexes shortly after execution — poll until the tx appears. */
const PROPOSAL_TX_POLL_MS = 5_000;
const PROPOSAL_TX_MAX_POLLS = 12; // ~1 minute

export function useProposalTransaction(
    daoId: string | null | undefined,
    proposal: Proposal | null | undefined,
    policy: Policy | null | undefined,
    enabled: boolean = true,
) {
    const queryClient = useQueryClient();
    // Only executed proposals (on-chain Approved) have an execution tx to wait
    // for. Rejected/Removed should surface N/A rather than keep polling.
    const expectsTransaction =
        proposal?.status === "Approved" || proposal?.status === "Failed";
    const isQueryEnabled = enabled && !!daoId && !!proposal && !!policy;
    const queryKey = [
        "proposal-transaction",
        daoId,
        proposal?.id,
        proposal?.status,
        proposal?.submission_time,
        policy?.proposal_period,
    ] as const;

    const query = useQuery({
        queryKey,
        queryFn: () => getProposalTransaction(daoId!, proposal!, policy!),
        enabled: isQueryEnabled,
        staleTime: 1000 * 60 * 5, // 5 minutes once we have the transaction
        refetchInterval: (q) => {
            // Keep polling while NearBlocks has not indexed the execution tx yet.
            if (!expectsTransaction) return false;
            if (q.state.data) return false;
            if (q.state.dataUpdateCount >= PROPOSAL_TX_MAX_POLLS) return false;
            return PROPOSAL_TX_POLL_MS;
        },
        retry: (failureCount, error) => {
            // Don't retry on 404 (not found) errors — polling handles indexer lag.
            if (isAxiosErrorWithStatus(error, 404)) {
                return false;
            }
            return failureCount < 3;
        },
    });

    const dataUpdateCount =
        queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0;

    // True while we still expect a transaction (including between poll intervals),
    // so callers can show a skeleton instead of "N/A".
    const isAwaitingTransaction =
        isQueryEnabled &&
        expectsTransaction &&
        !query.data &&
        (query.isLoading ||
            query.isFetching ||
            dataUpdateCount < PROPOSAL_TX_MAX_POLLS);

    return { ...query, isAwaitingTransaction };
}

/**
 * Query hook to get swap execution status for asset exchange proposals
 * Fetches from 1Click API via backend proxy
 *
 * @param depositAddress - The deposit address from the swap quote
 * @param depositMemo - Optional deposit memo if included in quote
 * @param enabled - Whether the query should be enabled (default: true if depositAddress exists)
 * @param daoId - Treasury/DAO id. The backend uses it to decide the status
 *   source: confidential treasuries read from our bronze history table, others
 *   use 1Click `/v0/status`.
 * @param proposal - The request the swap belongs to. Polling stops once its
 *   settling window has closed, see `isWithinSwapSettlingWindow`; without it
 *   an in-flight status polls until it settles.
 *
 */
export function useSwapStatus(
    depositAddress: string | null | undefined,
    depositMemo?: string | null,
    enabled: boolean = true,
    daoId?: string | null,
    proposal?: Pick<Proposal, "submission_time"> | null,
) {
    return useQuery({
        queryKey: ["swap-status", depositAddress, depositMemo, daoId],
        queryFn: () =>
            getSwapStatus(
                depositAddress!,
                depositMemo || undefined,
                daoId || undefined,
            ),
        enabled: enabled && !!depositAddress,
        staleTime: 1000 * 10, // 10 seconds
        refetchInterval: (query) => {
            const data = query.state.data;
            // If status is terminal (SUCCESS, REFUNDED, FAILED), stop polling
            if (isTerminalSwapStatus(data?.status)) {
                return false;
            }
            // An orphaned swap (still in flight past every quote deadline) is
            // read once per load, not polled.
            if (proposal && !isWithinSwapSettlingWindow(proposal)) {
                return false;
            }
            return 1000 * 10; // 10 seconds
        },
        retry: (failureCount, error) => {
            // Don't retry on 404 (deposit address not found)
            if (isAxiosErrorWithStatus(error, 404)) {
                return false;
            }
            return failureCount < 2;
        },
    });
}

export function useQuoteByDepositAddress(
    depositAddress: string | null | undefined,
    depositMemo?: string | null,
    enabled: boolean = true,
) {
    return useQuery({
        queryKey: ["quote-by-deposit-address", depositAddress, depositMemo],
        queryFn: () =>
            getQuoteByDepositAddress(depositAddress!, depositMemo || undefined),
        enabled: enabled && !!depositAddress,
        staleTime: 1000 * 60 * 5,
        retry: (failureCount, error) => {
            if (isAxiosErrorWithStatus(error, 404)) {
                return false;
            }
            return failureCount < 2;
        },
    });
}

export function useTokenPriceAtTimestamp(
    tokenId: string | null | undefined,
    timestamp: string | null | undefined,
    enabled: boolean = true,
) {
    return useQuery({
        queryKey: ["token-price-at-timestamp", tokenId, timestamp],
        queryFn: () => getTokenPriceAtTimestamp(tokenId!, timestamp!),
        enabled: enabled && !!tokenId && !!timestamp,
        staleTime: 1000 * 60 * 5,
        retry: 1,
    });
}

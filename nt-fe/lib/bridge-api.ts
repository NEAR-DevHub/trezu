import { http as axios } from "@/lib/http";

const BACKEND_API_BASE = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/api`;

export type TokenCatalogKind = "deposit" | "swap";

/**
 * Fetch deposit or swap token catalogs.
 * - deposit: near.com catalog + Bridge (no 1Click ∩)
 * - swap: catalog ∩ 1Click `/v0/tokens`
 */
export async function fetchTokenCatalog(kind: TokenCatalogKind = "deposit") {
    const path =
        kind === "swap" ? "/intents/swap-tokens" : "/intents/deposit-tokens";
    try {
        const response = await axios.get(`${BACKEND_API_BASE}${path}`);
        return response.data.assets || [];
    } catch (error) {
        console.error(`Error fetching ${kind} tokens:`, error);
        throw error;
    }
}

/** @deprecated Prefer {@link fetchTokenCatalog}("deposit"). */
export async function fetchBridgeTokens() {
    return fetchTokenCatalog("deposit");
}

/**
 * Fetch deposit address for a specific account and chain via backend
 * @param {string} accountId - NEAR account ID
 * @param {string} chainId - Chain identifier (e.g., "nep141:btc.omft.near")
 * @returns {Promise<Object>} Result object containing deposit address
 */
export type DepositAddressResponse = {
    address: string;
    memo?: string | null;
    minAmount?: string | null;
    /**
     * Confidential: the treasury's reusable 1Click quote address (the deposit
     * tracker scope). Differs from `address`, the funding address on the chain.
     */
    quoteDepositAddress?: string | null;
};

export const fetchDepositAddress = async (
    accountId: string,
    chainId: string,
    tokenId?: string,
    amount?: string,
): Promise<DepositAddressResponse | null> => {
    try {
        if (!accountId || !chainId) {
            throw new Error("Account ID and chain ID are required");
        }

        const response = await axios.post<DepositAddressResponse>(
            `${BACKEND_API_BASE}/intents/deposit-address`,
            {
                accountId: accountId,
                chain: chainId,
                tokenId: tokenId,
                amount: amount,
            },
            { withCredentials: true },
        );

        return response.data || null;
    } catch (error) {
        console.error("Error fetching deposit address from backend:", error);
        throw error;
    }
};

export type TrackedDepositStatus =
    | "detected"
    | "finalized"
    | "ledger_confirmed"
    | "failed";

export interface TrackedDeposit {
    id: number;
    status: TrackedDepositStatus;
    providerStatus: string;
    chain: string | null;
    tokenId: string;
    tokenMetadata: {
        symbol: string;
        decimals: number;
        price?: number | null;
    };
    /** Decimal-adjusted amount as a string, or null when unknown. */
    amount: string | null;
    originTxHash: string | null;
    detectedAt: string;
    finalizedAt: string | null;
    updatedAt: string;
}

export interface DepositTrackerResponse {
    deposits: TrackedDeposit[];
}

/**
 * In-process deposits the backend tracker has seen for one address scope:
 * a confidential quote address, or a public chain.
 */
export const fetchDepositTracker = async (
    accountId: string,
    scope: {
        chain?: string | null;
        quoteDepositAddress?: string | null;
        /** RFC 3339 lower bound on detection time; required for guests on a reusable address. */
        since?: string | null;
    },
): Promise<DepositTrackerResponse> => {
    if (!accountId) {
        throw new Error("Account ID is required");
    }
    const response = await axios.get<DepositTrackerResponse>(
        `${BACKEND_API_BASE}/intents/deposit-tracker`,
        {
            params: {
                accountId,
                chain: scope.chain ?? undefined,
                quoteDepositAddress: scope.quoteDepositAddress ?? undefined,
                since: scope.since ?? undefined,
            },
            withCredentials: true,
        },
    );
    return response.data;
};

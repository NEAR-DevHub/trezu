/**
 * Shared mock API response bodies for treasury E2E specs.
 *
 * Previously these objects (TREASURY_POLICY, SUBSCRIPTION, TREASURY_ASSETS,
 * EMPTY_PROPOSALS) were copy-pasted verbatim across requests-page.spec.ts and
 * onboarding-tour.spec.ts. Centralizing them here means a DAO-policy or
 * subscription schema change only needs updating in one place.
 */

export interface TreasurySummary {
    daoId: string;
    config: { name: string; purpose: string; metadata: Record<string, never> };
    isMember: boolean;
    isSaved: boolean;
    isHidden: boolean;
}

export interface ProposalsResponse {
    page: number;
    page_size: number;
    total: number;
    proposals: unknown[];
}

export function buildTreasurySummary(
    treasuryId: string,
    name: string,
): TreasurySummary {
    return {
        daoId: treasuryId,
        config: { name, purpose: "Testing", metadata: {} },
        isMember: true,
        isSaved: true,
        isHidden: false,
    };
}

export function buildTreasuryPolicy(accountId: string) {
    return {
        roles: [
            {
                name: "council",
                kind: { Group: [accountId] },
                permissions: [
                    "*:AddProposal",
                    "*:VoteApprove",
                    "*:VoteReject",
                    "*:VoteRemove",
                ],
                vote_policy: {},
            },
        ],
        default_vote_policy: {
            weight_kind: "RoleWeight",
            quorum: "0",
            threshold: [1, 2],
        },
        proposal_bond: "100000000000000000000000",
        proposal_period: "604800000000000",
        bounty_bond: "100000000000000000000000",
        bounty_forgiveness_period: "604800000000000",
    };
}

export function buildFreeSubscription(treasuryId: string) {
    return {
        accountId: treasuryId,
        planType: "free",
        planConfig: {
            planType: "free",
            name: "Free",
            description: "Free plan",
            limits: {
                monthlyVolumeLimitCents: null,
                overageRateBps: 0,
                exchangeFeeBps: 0,
                monthlyExportCredits: null,
                trialExportCredits: 100,
                monthlyBatchPaymentCredits: null,
                trialBatchPaymentCredits: 50,
                gasCoveredTransactions: null,
                historyLookupMonths: 3,
            },
            pricing: { monthlyPriceCents: null, yearlyPriceCents: null },
        },
        exportCredits: 100,
        batchPaymentCredits: 50,
        gasCoveredTransactions: 100,
        creditsResetAt: "2026-05-06T00:00:00Z",
        monthlyUsedVolumeCents: 0,
    };
}

export const EMPTY_PROPOSALS: ProposalsResponse = {
    page: 0,
    page_size: 15,
    total: 0,
    proposals: [],
};

export const DEFAULT_TREASURY_ASSETS = [
    {
        id: "near",
        contractId: null,
        residency: "Near",
        network: "near",
        chainName: "Near Protocol",
        symbol: "wNEAR",
        balance: {
            Standard: {
                total: "5000000000000000000000000",
                locked: "0",
            },
        },
        decimals: 24,
        price: "1.05",
        name: "Near",
        icon: "https://s2.coinmarketcap.com/static/img/coins/128x128/6535.png",
        chainIcons: {
            icon: "https://near.com/static/icons/network/near.svg",
        },
    },
];

export const EMPTY_ASSETS: typeof DEFAULT_TREASURY_ASSETS = [];

/**
 * Legacy-shaped single-proposal response used only by onboarding-tour specs
 * to flip the "has proposals" client-side check. Note this shape
 * (snake_case, no `proposalId`/`daoId`/`voteCounts`/`txHash`) does NOT match
 * the shape `buildExecutedProposalsResponse` below returns for
 * requests-page — that's a pre-existing discrepancy carried over verbatim
 * from the original specs, not something this refactor fixes. Worth a
 * follow-up to confirm which shape the real API actually returns.
 */
export function buildProposalsWithOneLegacyShape(
    accountId: string,
): ProposalsResponse {
    return {
        page: 0,
        page_size: 15,
        total: 1,
        proposals: [
            {
                id: 1,
                proposer: accountId,
                description: "Test payment",
                kind: {
                    Transfer: {
                        token_id: "",
                        receiver_id: "bob.near",
                        amount: "1000000000000000000000000",
                    },
                },
                status: "Approved",
                vote_counts: {},
                votes: {},
                submission_time: "1700000000000000000",
            },
        ],
    };
}

/** Full-shaped executed-proposal response used by requests-page's "all caught up" test. */
export function buildExecutedProposalsResponse(
    treasuryId: string,
    accountId: string,
): ProposalsResponse {
    return {
        page: 0,
        page_size: 15,
        total: 1,
        proposals: [
            {
                id: 1,
                proposalId: 1,
                daoId: treasuryId,
                proposer: accountId,
                kind: {
                    Transfer: {
                        tokenId: "",
                        receiverId: "bob.near",
                        amount: "1000000000000000000000000",
                        msg: null,
                    },
                },
                type: "Payments",
                status: "Approved",
                voteCounts: { council: [1, 0, 0] },
                votes: { [accountId]: "Approve" },
                submissionTime: "1712000000000000000",
                description: "Payment to bob",
                txHash: "abc123",
            },
        ],
    };
}

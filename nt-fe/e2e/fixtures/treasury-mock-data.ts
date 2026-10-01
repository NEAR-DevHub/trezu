/**
 * Shared mock API response bodies for treasury E2E specs, used with
 * `installTreasuryApiMocks`. Only requests-my-vote-filter.spec.ts uses them
 * today; the older specs still define their own copies inline.
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

export type DepositStep = "select" | "address";

export type ConfidentialOrigin = "trezu" | "nearcom";

export interface DepositInfo {
    address: string;
    memo: string | null;
    minDepositAmount: string | null;
    /** Confidential: the treasury's reusable quote address (tracker scope). */
    quoteDepositAddress: string | null;
}

export interface SelectOption {
    id: string;
    name: string;
    description?: string;
    symbol?: string;
    icon: string;
    gradient?: string;
    networks?: unknown[];
    chainId?: string;
}

type TokenQueryShape = {
    address: string;
    contractId?: string;
    id?: string;
};

export function buildTokenQueryParam(token: {
    symbol: string;
    network: string;
    decimals: number;
    icon: string;
    name: string;
    residency?: string;
    chainIcons?: unknown;
    contractId?: string;
    id?: string;
}): string {
    const address = token.contractId ?? token.id;

    return encodeURIComponent(
        JSON.stringify({
            symbol: token.symbol,
            address,
            network: token.network,
            decimals: token.decimals,
            residency: token.residency,
            icon: token.icon,
            name: token.name,
            chainIcons: token.chainIcons,
        }),
    );
}

export function parseTokenQueryParam<T extends TokenQueryShape>(
    param: string | null,
    fallback: T,
): T {
    if (!param) return fallback;

    try {
        const parsed = JSON.parse(decodeURIComponent(param)) as Record<
            string,
            unknown
        >;

        const address =
            (typeof parsed.address === "string" && parsed.address) ||
            (typeof parsed.contractId === "string" && parsed.contractId) ||
            (typeof parsed.id === "string" && parsed.id) ||
            "";

        if (!address) return fallback;

        return {
            ...fallback,
            ...(parsed as Partial<T>),
            address,
        };
    } catch {
        return fallback;
    }
}

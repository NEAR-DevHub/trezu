export function stripIntentsTokenPrefix(tokenId: string): string {
    return tokenId.replace(/^nep141:/, "").replace(/^nep245:/, "");
}

export function normalizeIntentsTokenIdForMatch(tokenId: string): string {
    return stripIntentsTokenPrefix(tokenId).toLowerCase();
}

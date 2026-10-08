/**
 * near.com's rules for Ondo stocks (`swapRestrictions.ts`), applied per member.
 *
 * Intents and 1Click are permissionless, so nothing here is enforced on chain:
 * the region rule only stops members in these countries from creating or
 * approving stock swaps in this UI, and the market-hours rule only stops
 * approvals while Ondo's market is closed. Creating a request is never blocked
 * by market hours.
 */

/** ISO 3166-1 alpha-2 codes, the same ones geoip-lite returns. */
export const STOCK_RESTRICTED_COUNTRY_CODES: ReadonlySet<string> = new Set([
    "CA",
    "US",
]);

/**
 * Set by `proxy.ts` from the visitor's IP. Readable by client JavaScript and
 * carries no authority beyond hiding UI.
 */
export const STOCK_REGION_COOKIE = "nearcom_stocks_restricted";

export function readStockRegionCookie(cookie: string): boolean {
    return cookie
        .split(";")
        .some((part) => part.trim() === `${STOCK_REGION_COOKIE}=1`);
}

const WEEKLY_OPEN_MINUTE = 20 * 60;
const WEEKLY_CLOSE_MINUTE = 19 * 60 + 59;
const HOUR_MS = 60 * 60 * 1000;

const easternClock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

/**
 * Ondo's 24/5 window: Sunday 20:00 ET through Friday 19:59 ET. Market holidays
 * are not modelled.
 */
export function isOndoMarketOpen(now: Date = new Date()): boolean {
    const parts = easternClock.formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((p) => p.type === type)?.value ?? "";
    const minute = Number(part("hour")) * 60 + Number(part("minute"));
    switch (part("weekday")) {
        case "Sun":
            return minute >= WEEKLY_OPEN_MINUTE;
        case "Fri":
            return minute < WEEKLY_CLOSE_MINUTE;
        case "Sat":
            return false;
        default:
            return true;
    }
}

/**
 * When the market next opens, or `null` while it is open. US Eastern offsets
 * are whole hours, so Sunday 20:00 ET always falls on a UTC hour.
 */
export function nextOndoMarketOpen(now: Date = new Date()): Date | null {
    if (isOndoMarketOpen(now)) return null;
    const candidate = new Date(now);
    candidate.setUTCMinutes(0, 0, 0);
    for (let hours = 0; hours < 24 * 8; hours++) {
        candidate.setTime(candidate.getTime() + HOUR_MS);
        if (isOndoMarketOpen(candidate)) return candidate;
    }
    return null;
}

export interface StockCatalogEntry {
    symbol: string;
    marketHoursOnly: boolean;
}

function normalizeAssetId(id: string): string {
    return id.toLowerCase().replace(/^nep141:/, "");
}

/** Stock catalog rows keyed by every id a proposal may carry for them. */
export function buildStockIndex(
    assets: ReadonlyArray<{
        symbol: string;
        assetClass?: "stock";
        marketHoursOnly?: boolean;
        networks: ReadonlyArray<{
            id: string;
            balanceAssetId?: string;
            quoteAssetId?: string;
        }>;
    }>,
): Map<string, StockCatalogEntry> {
    const index = new Map<string, StockCatalogEntry>();
    for (const asset of assets) {
        if (asset.assetClass !== "stock") continue;
        const entry = {
            symbol: asset.symbol,
            marketHoursOnly: asset.marketHoursOnly === true,
        };
        for (const network of asset.networks) {
            for (const id of [
                network.id,
                network.balanceAssetId,
                network.quoteAssetId,
            ]) {
                if (id) index.set(normalizeAssetId(id), entry);
            }
        }
    }
    return index;
}

export function findStock(
    index: ReadonlyMap<string, StockCatalogEntry>,
    assetId: string | null | undefined,
): StockCatalogEntry | undefined {
    return assetId ? index.get(normalizeAssetId(assetId)) : undefined;
}

import { decimalOrNull } from "@/lib/amount-format";

const MAX_FRACTION_DIGITS = 2;

/**
 * Typed custom-slippage text. Keeps partial decimals like "0." and caps the
 * fraction at 2 digits, which is what the quote sends (`Math.round(n * 100)`).
 * A comma is a decimal point. Extra dots are dropped.
 */
export function sanitizeSlippageDraft(value: string): string {
    const normalized = value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
    const dot = normalized.indexOf(".");
    const single =
        dot === -1
            ? normalized
            : normalized.slice(0, dot + 1) +
              normalized.slice(dot + 1).replace(/\./g, "");
    const stripped = single.replace(/^0+(?=\d)/, "");
    const fractionAt = stripped.indexOf(".");
    if (fractionAt === -1) return stripped;
    return (
        stripped.slice(0, fractionAt + 1) +
        stripped.slice(fractionAt + 1, fractionAt + 1 + MAX_FRACTION_DIGITS)
    );
}

/** Numeric form value for a draft. Incomplete drafts ("", ".") are 0. */
export function slippageFromDraft(draft: string): number {
    if (draft === "" || draft === ".") return 0;
    const parsed = decimalOrNull(draft);
    if (!parsed || parsed.lt(0)) return 0;
    return Number(parsed.toFixed(MAX_FRACTION_DIGITS));
}

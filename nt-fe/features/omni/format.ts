/** Presentation helpers for omni proposals. All amounts stay BigInt. */

/** "0xd025...D989" style truncation for long identifiers. */
export function truncateMiddle(value: string, head = 6, tail = 4): string {
    if (value.length <= head + tail + 3) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Exact decimal string for a base-unit BigInt (no rounding, trailing zeros trimmed). */
export function formatBaseUnits(value: bigint, decimals: number): string {
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const text = abs.toString().padStart(decimals + 1, "0");
    const whole = text.slice(0, text.length - decimals);
    let fraction = text.slice(text.length - decimals).replace(/0+$/, "");
    if (decimals === 0) fraction = "";
    const result = fraction ? `${whole}.${fraction}` : whole;
    return negative ? `-${result}` : result;
}

/** Wei to gwei as an exact decimal string. */
export function formatGwei(wei: bigint): string {
    return formatBaseUnits(wei, 9);
}

/** Cap untrusted text for compact list cells. */
export function capText(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
}

export function ensure0x(hex: string): `0x${string}` {
    return (hex.startsWith("0x") ? hex : `0x${hex}`) as `0x${string}`;
}

/** Stringify JSON with BigInt support, 2-space indented. */
export function prettyJson(value: unknown): string {
    try {
        return JSON.stringify(
            value,
            (_, v) => (typeof v === "bigint" ? v.toString() : v),
            2,
        );
    } catch {
        return String(value);
    }
}

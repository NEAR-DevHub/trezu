import type { EnvelopeParseResult, OmniEnvelope } from "./types";

/** omni-cli-rs warns above this size; we refuse to parse beyond it. */
export const ENVELOPE_MAX_BYTES = 16 * 1024;

function utf8Length(text: string): number {
    return new TextEncoder().encode(text).length;
}

/**
 * Cheap marker test used by proposal classification. True when the
 * description looks like an omni envelope (JSON object with an `omni` key).
 * Does not validate the rest of the envelope.
 */
export function hasOmniMarker(description: string | null | undefined): boolean {
    if (!description) return false;
    const trimmed = description.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes('"omni"')) return false;
    if (utf8Length(trimmed) > ENVELOPE_MAX_BYTES) {
        // Too big to parse safely; the marker regex is enough to route it to
        // the omni card, which then shows the size error.
        return /^\{\s*"omni"\s*:/.test(trimmed);
    }
    try {
        const parsed = JSON.parse(trimmed);
        return (
            typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed) &&
            "omni" in parsed
        );
    } catch {
        return false;
    }
}

/**
 * Parse a proposal description as an omni envelope. Never throws.
 */
export function parseEnvelope(
    description: string | null | undefined,
): EnvelopeParseResult {
    const text = (description ?? "").trim();
    const sizeBytes = utf8Length(text);
    if (sizeBytes > ENVELOPE_MAX_BYTES) {
        return { ok: false, reason: "too-large", sizeBytes };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: "not-json", sizeBytes };
    }
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
    ) {
        return { ok: false, reason: "not-object", sizeBytes };
    }
    const record = parsed as Record<string, unknown>;
    if (!("omni" in record)) {
        return { ok: false, reason: "missing-omni-marker", sizeBytes };
    }

    const missing: string[] = [];
    const omni = record.omni;
    if (typeof omni !== "number") missing.push("omni");
    const intent = record.intent;
    if (typeof intent !== "string") missing.push("intent");
    const family = record.family;
    if (typeof family !== "string" || family.length === 0)
        missing.push("family");
    const chain = record.chain;
    if (typeof chain !== "string" || chain.length === 0) missing.push("chain");
    const path = record.path;
    if (typeof path !== "string" || path.length === 0) missing.push("path");
    const unsignedTx = record.unsigned_tx;
    if (
        typeof unsignedTx !== "object" ||
        unsignedTx === null ||
        Array.isArray(unsignedTx)
    ) {
        missing.push("unsigned_tx");
    }

    const metaRaw = record.meta;
    const meta: OmniEnvelope["meta"] = {};
    if (typeof metaRaw === "object" && metaRaw !== null) {
        const m = metaRaw as Record<string, unknown>;
        if (typeof m.nonce === "number") meta.nonce = m.nonce;
        if (typeof m.builder_version === "string")
            meta.builder_version = m.builder_version;
        if (typeof m.after_broadcast === "string")
            meta.after_broadcast = m.after_broadcast;
    }

    if (missing.length > 0) {
        return {
            ok: false,
            reason: "missing-fields",
            sizeBytes,
            missing,
            partial: {
                omni: typeof omni === "number" ? omni : undefined,
                intent: typeof intent === "string" ? intent : undefined,
                family: typeof family === "string" ? family : undefined,
                chain: typeof chain === "string" ? chain : undefined,
                path: typeof path === "string" ? path : undefined,
                unsigned_tx: unsignedTx,
                meta,
            },
        };
    }

    return {
        ok: true,
        sizeBytes,
        envelope: {
            omni: omni as number,
            intent: intent as string,
            family: family as string,
            chain: chain as string,
            path: path as string,
            unsigned_tx: unsignedTx,
            meta,
        },
    };
}

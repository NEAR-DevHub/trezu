import type { FunctionCallAction } from "@/lib/proposals-api";
import type { OmniSignRequest } from "./types";

const HEX_RE = /^(?:[0-9a-fA-F]{2})+$/;

/** Lowercase hex without 0x, or null when not clean even-length hex. */
function normalizeHex(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const stripped =
        value.startsWith("0x") || value.startsWith("0X")
            ? value.slice(2)
            : value;
    return HEX_RE.test(stripped) ? stripped.toLowerCase() : null;
}

/**
 * Base64 -> UTF-8 -> JSON. `atob` yields a Latin-1 string, so the bytes must
 * go through TextDecoder or any non-ASCII derivation path ("казна-1",
 * "🏦-1") would be corrupted and produce a false path MISMATCH.
 */
function decodeBase64Json(args: string): unknown {
    try {
        const latin1 = atob(args);
        const bytes = Uint8Array.from(latin1, (c) => c.charCodeAt(0));
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/**
 * Decode the `sign` actions of an MPC FunctionCall proposal. Tolerant: a
 * malformed action yields nulls rather than a throw so the checklist can
 * report exactly which action is wrong.
 */
export function decodeSignActions(
    actions: FunctionCallAction[],
): OmniSignRequest[] {
    return actions.map((action, index) => {
        const raw = decodeBase64Json(action.args);
        const base: OmniSignRequest = {
            index,
            methodName: action.method_name,
            path: null,
            domainId: null,
            scheme: null,
            payloadHex: null,
            gas: action.gas,
            deposit: action.deposit,
            rawArgs: raw,
            argsDecodeError: raw === undefined,
        };
        if (typeof raw !== "object" || raw === null) return base;
        const request = (raw as Record<string, unknown>).request;
        if (typeof request !== "object" || request === null) return base;
        const r = request as Record<string, unknown>;
        if (typeof r.path === "string") base.path = r.path;
        if (typeof r.domain_id === "number") base.domainId = r.domain_id;
        const payload = r.payload_v2;
        if (typeof payload === "object" && payload !== null) {
            const p = payload as Record<string, unknown>;
            const ecdsa = normalizeHex(p.Ecdsa);
            const eddsa = normalizeHex(p.Eddsa);
            if (ecdsa !== null) {
                base.scheme = "Ecdsa";
                base.payloadHex = ecdsa;
            } else if (eddsa !== null) {
                base.scheme = "Eddsa";
                base.payloadHex = eddsa;
            }
        }
        return base;
    });
}

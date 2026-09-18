"use client";

import { Check, Loader2, Minus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";
import type { CheckState, VerificationCheck } from "../types";

/**
 * Payload hex is rendered as a block-level <code>. `whitespace-pre-wrap` is
 * explicit because the expanded view lives inside a table cell that sets
 * `white-space: nowrap`, and `break-all` does nothing under nowrap.
 */
export const PAYLOAD_CODE_CLASS =
    "block w-full min-w-0 whitespace-pre-wrap break-all wrap-anywhere font-mono text-xs";

export interface AsyncCheckRow {
    id: "sender";
    state: CheckState | "pending";
    detail?: Record<string, string | number>;
}

interface OmniChecklistProps {
    checks: VerificationCheck[];
    asyncChecks?: AsyncCheckRow[];
    /** Payload hex values that matched, shown under the pass row. */
    matchedPayloadsHex?: string[];
}

function StateIcon({ state }: { state: CheckState | "pending" }) {
    switch (state) {
        case "pass":
            return (
                <Check className="h-4 w-4 shrink-0 text-general-success-foreground" />
            );
        case "fail":
            return <X className="h-4 w-4 shrink-0 text-red-600" />;
        case "skip":
            return (
                <Minus className="h-4 w-4 shrink-0 text-general-warning-foreground" />
            );
        case "pending":
            return (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            );
    }
}

export function OmniChecklist({
    checks,
    asyncChecks = [],
    matchedPayloadsHex,
}: OmniChecklistProps) {
    const t = useTranslations("proposals.omni");
    const rows: Array<{
        key: string;
        state: CheckState | "pending";
        text: string;
        expected?: string;
        actual?: string;
        payloads?: string[];
    }> = [];

    for (const check of checks) {
        const detail = check.detail ?? {};
        rows.push({
            key: check.id,
            state: check.state,
            text: t(`checks.${check.id}.${check.state}`, detail),
            expected:
                check.id === "payload-bytes" && check.state === "fail"
                    ? String(detail.expected ?? "")
                    : undefined,
            actual:
                check.id === "payload-bytes" && check.state === "fail"
                    ? String(detail.actual ?? "")
                    : undefined,
            // On a pass, show the matched payload(s) so a reviewer can
            // cross-check them against the CLI output.
            payloads:
                check.id === "payload-bytes" && check.state === "pass"
                    ? matchedPayloadsHex
                    : undefined,
        });
    }
    for (const check of asyncChecks) {
        rows.push({
            key: check.id,
            state: check.state,
            text: t(`checks.${check.id}.${check.state}`, check.detail ?? {}),
        });
    }

    return (
        <ul
            className="flex flex-col gap-1.5 min-w-0 max-w-full"
            data-testid="omni-checklist"
        >
            {rows.map((row) => (
                <li
                    key={row.key}
                    className={cn(
                        "flex flex-col gap-1 text-sm min-w-0 wrap-anywhere",
                        row.state === "fail" && "text-red-600 font-medium",
                        row.state === "skip" && "text-muted-foreground",
                    )}
                >
                    <div className="flex items-start gap-2">
                        <span className="mt-0.5">
                            <StateIcon state={row.state} />
                        </span>
                        <span className="break-words">{row.text}</span>
                    </div>
                    {row.payloads && row.payloads.length > 0 && (
                        <div className="ml-6 flex flex-col gap-0.5 min-w-0 text-muted-foreground">
                            {row.payloads.map((payload) => (
                                <code
                                    key={payload}
                                    className={PAYLOAD_CODE_CLASS}
                                    data-testid="omni-payload-hex"
                                >
                                    {payload}
                                </code>
                            ))}
                        </div>
                    )}
                    {row.expected !== undefined && (
                        <div
                            className="ml-6 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 min-w-0"
                            data-testid="omni-payload-diff"
                        >
                            <span className="text-muted-foreground font-sans">
                                {t("checks.proposalSigns")}
                            </span>
                            <code
                                className={PAYLOAD_CODE_CLASS}
                                data-testid="omni-payload-hex"
                            >
                                {row.actual}
                            </code>
                            <CopyButton
                                text={row.actual ?? ""}
                                toastMessage={t("raw.copied")}
                                variant="ghost"
                                size="icon-sm"
                                className="h-6 w-6"
                                iconClassName="h-3 w-3"
                            />
                            <span className="text-muted-foreground font-sans">
                                {t("checks.envelopeNeeds")}
                            </span>
                            <code
                                className={PAYLOAD_CODE_CLASS}
                                data-testid="omni-payload-hex"
                            >
                                {row.expected}
                            </code>
                            <CopyButton
                                text={row.expected ?? ""}
                                toastMessage={t("raw.copied")}
                                variant="ghost"
                                size="icon-sm"
                                className="h-6 w-6"
                                iconClassName="h-3 w-3"
                            />
                        </div>
                    )}
                </li>
            ))}
        </ul>
    );
}

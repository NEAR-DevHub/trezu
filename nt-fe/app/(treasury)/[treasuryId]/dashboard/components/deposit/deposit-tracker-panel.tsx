"use client";

import { Check, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormattedAmount } from "@/components/formatted-amount";
import type { TrackedDeposit } from "@/lib/bridge-api";
import { cn } from "@/lib/utils";

interface DepositTrackerPanelProps {
    deposits: TrackedDeposit[];
    /** Show the "waiting" row while nothing has been detected yet. */
    waiting: boolean;
    className?: string;
}

type Tone = "pending" | "success" | "failed";

function toneFor(deposit: TrackedDeposit): Tone {
    switch (deposit.status) {
        case "ledger_confirmed":
            return "success";
        case "failed":
            return "failed";
        default:
            return "pending";
    }
}

function ToneIcon({ tone }: { tone: Tone }) {
    if (tone === "success") {
        return (
            <span className="size-5 shrink-0 rounded-full bg-general-success-foreground flex items-center justify-center">
                <Check className="size-3 text-white stroke-3" />
            </span>
        );
    }
    if (tone === "failed") {
        return (
            <span className="size-5 shrink-0 rounded-full bg-general-destructive-foreground flex items-center justify-center">
                <X className="size-3 text-white stroke-3" />
            </span>
        );
    }
    return (
        <Loader2 className="size-5 shrink-0 animate-spin text-general-orange-foreground" />
    );
}

/**
 * Live deposit progress under the address card: waiting → detected →
 * received (or failed). Data comes from the backend deposit tracker.
 */
export function DepositTrackerPanel({
    deposits,
    waiting,
    className,
}: DepositTrackerPanelProps) {
    const t = useTranslations("depositModal");

    if (deposits.length === 0 && !waiting) {
        return null;
    }

    return (
        <div
            className={cn("rounded-xl bg-muted p-3 space-y-3", className)}
            data-testid="deposit-tracker-panel"
        >
            {deposits.length === 0 ? (
                <div className="flex items-start gap-2.5">
                    <span className="relative flex size-5 shrink-0 items-center justify-center">
                        <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-general-orange-foreground opacity-60" />
                        <span className="relative inline-flex size-2.5 rounded-full bg-general-orange-foreground" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-sm font-medium">
                            {t("depositWaiting")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {t("depositWaitingHint")}
                        </p>
                    </div>
                </div>
            ) : (
                deposits.map((deposit) => {
                    const tone = toneFor(deposit);
                    const title =
                        tone === "success"
                            ? t("depositReceivedTitle")
                            : tone === "failed"
                              ? t("depositFailedTitle")
                              : t("depositDetectedTitle");
                    const hint =
                        tone === "success"
                            ? t("depositReceivedHint")
                            : tone === "failed"
                              ? t("depositFailedHint")
                              : t("depositDetectedHint");
                    return (
                        <div
                            key={deposit.id}
                            className="flex items-start gap-2.5"
                            data-testid={`deposit-tracker-row-${deposit.status}`}
                        >
                            <ToneIcon tone={tone} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                    <p className="text-sm font-medium">
                                        {title}
                                    </p>
                                    <span
                                        className={cn(
                                            "text-sm font-medium tabular-nums whitespace-nowrap",
                                            tone === "success" &&
                                                "text-general-success-foreground",
                                            tone === "failed" &&
                                                "text-general-destructive-foreground line-through",
                                        )}
                                    >
                                        {deposit.amount != null ? (
                                            <FormattedAmount
                                                kind="token"
                                                value={deposit.amount}
                                                symbol={
                                                    deposit.tokenMetadata.symbol
                                                }
                                                tokenDecimals={
                                                    deposit.tokenMetadata
                                                        .decimals
                                                }
                                                profile="compact"
                                            />
                                        ) : (
                                            t("depositAmountUnknown")
                                        )}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {hint}
                                </p>
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
}

"use client";

import { BorderBeam } from "border-beam";
import { Check, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { FormattedAmount } from "@/components/formatted-amount";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { TrackedDeposit } from "@/lib/bridge-api";
import { cn } from "@/lib/utils";
import { DepositOptionIcon } from "./deposit-option-icon";
import type { DepositReceiveCardTone } from "./deposit-receive-card";

interface DepositTrackerPanelProps {
    deposits: TrackedDeposit[];
    /** Asset icon shown on each tile (falls back to the token symbol). */
    assetIcon?: string | null;
    assetName?: string | null;
    /** Fixed tile theme matching the receive card above; app theme when unset. */
    theme?: DepositReceiveCardTone;
    className?: string;
}

function tileThemeClasses(theme?: DepositReceiveCardTone) {
    if (!theme) return null;
    return cn(
        theme === "dark" ? "dark" : "force-light-theme",
        "bg-secondary text-foreground",
    );
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

function StatusBadge({ tone }: { tone: Tone }) {
    return (
        <span
            className={cn(
                "absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full ring-2 ring-muted",
                tone === "success" && "bg-general-success-foreground",
                tone === "failed" && "bg-general-destructive-foreground",
                tone === "pending" && "bg-foreground",
            )}
        >
            {tone === "success" ? (
                <Check className="size-3 text-white stroke-3" />
            ) : tone === "failed" ? (
                <X className="size-3 text-white stroke-3" />
            ) : (
                <Loader2 className="size-3 animate-spin text-background" />
            )}
        </span>
    );
}

function DepositStatusTile({
    deposit,
    assetIcon,
    assetName,
    theme,
}: {
    deposit: TrackedDeposit;
    assetIcon?: string | null;
    assetName?: string | null;
    theme?: DepositReceiveCardTone;
}) {
    const t = useTranslations("depositModal");
    const tone = toneFor(deposit);
    const symbol = deposit.tokenMetadata.symbol;

    const title =
        tone === "success"
            ? t("depositCompletedTitle")
            : tone === "failed"
              ? t("depositFailedTitle")
              : t("depositProcessingTitle");

    const amount =
        deposit.amount != null ? (
            <FormattedAmount
                kind="token"
                value={deposit.amount}
                symbol={symbol}
                tokenDecimals={deposit.tokenMetadata.decimals}
                profile="compact"
            />
        ) : null;
    const bodyKey =
        tone === "success"
            ? "depositCompletedBody"
            : tone === "failed"
              ? "depositFailedBody"
              : "depositProcessingBody";
    const body = amount
        ? t.rich(bodyKey, { amount: () => amount })
        : t(`${bodyKey}NoAmount`);

    return (
        <div
            className={cn(
                "flex items-center gap-4 rounded-xl bg-muted p-4",
                tileThemeClasses(theme),
            )}
            data-testid={`deposit-tracker-row-${deposit.status}`}
        >
            <span className="relative shrink-0">
                <DepositOptionIcon
                    icon={assetIcon ?? ""}
                    name={assetName ?? symbol}
                    className="size-12 text-base"
                />
                <StatusBadge tone={tone} />
            </span>
            <div className="min-w-0 flex-1">
                <p className="font-semibold text-base leading-snug">{title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{body}</p>
            </div>
        </div>
    );
}

/**
 * Live deposit progress from the backend tracker: one tile per deposit,
 * processing → completed (or failed). A processing tile carries a travelling
 * border beam; nothing renders until a deposit has been detected.
 */
export function DepositTrackerPanel({
    deposits,
    assetIcon,
    assetName,
    theme,
    className,
}: DepositTrackerPanelProps) {
    const { resolvedTheme } = useTheme();
    const beamTheme = theme ?? (resolvedTheme === "dark" ? "dark" : "light");
    const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

    if (deposits.length === 0) {
        return null;
    }

    return (
        <div
            className={cn("space-y-3", className)}
            data-testid="deposit-tracker-panel"
        >
            {deposits.map((deposit) => {
                const tile = (
                    <DepositStatusTile
                        key={deposit.id}
                        deposit={deposit}
                        assetIcon={assetIcon}
                        assetName={assetName}
                        theme={theme}
                    />
                );
                if (toneFor(deposit) !== "pending") return tile;
                return (
                    <BorderBeam
                        key={deposit.id}
                        size="md"
                        colorVariant="mono"
                        theme={beamTheme}
                        active={!reducedMotion}
                        borderRadius={12}
                        className="rounded-xl"
                    >
                        {tile}
                    </BorderBeam>
                );
            })}
        </div>
    );
}

"use client";

import { useState } from "react";
import {
    BadgeDollarSign,
    Info,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { TreasuryAsset } from "@/lib/api";
import Big from "@/lib/big";
import { formatBalance, formatSmartAmount, formatUserDate } from "@/lib/utils";
import { useTreasuryLockup } from "@/hooks/use-lockup";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AmountSummary } from "./amount-summary";
import { Tooltip } from "./tooltip";

interface LockupDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onBack?: () => void;
    asset: TreasuryAsset | null;
    treasuryId: string | null;
}

function formatDateFromSeconds(seconds?: number): string {
    if (!seconds || Number.isNaN(seconds) || seconds <= 0) return "N/A";
    return formatUserDate(seconds * 1000, {
        includeTime: false,
        customFormat: "MMM dd, yyyy",
    });
}

function formatDateFromNanoseconds(nanos?: number | null): string {
    if (!nanos || Number.isNaN(nanos) || nanos <= 0) return "N/A";
    return formatUserDate(nanos / 1_000_000, {
        includeTime: false,
        customFormat: "MMM dd, yyyy",
    });
}

function formatReleaseInterval(seconds?: number): string {
    if (!seconds || seconds <= 0) return "N/A";

    if (seconds === 2592000) return "Every month";
    if (seconds === 7776000) return "Every quarter";

    const units = [
        { seconds: 31536000, label: "year" },
        { seconds: 86400, label: "day" },
        { seconds: 3600, label: "hour" },
        { seconds: 60, label: "minute" },
        { seconds: 1, label: "second" },
    ];

    let remaining = seconds;
    const parts: Array<{ count: number; label: string }> = [];

    for (const unit of units) {
        if (remaining < unit.seconds) continue;
        const count = Math.floor(remaining / unit.seconds);
        if (count <= 0) continue;
        parts.push({ count, label: unit.label });
        remaining %= unit.seconds;
    }

    if (parts.length === 1 && parts[0].count === 1) {
        return `Every ${parts[0].label}`;
    }

    const text = parts
        .map(
            (part) => `${part.count} ${part.label}${part.count > 1 ? "s" : ""}`,
        )
        .join(" ");

    return text ? `Every ${text}` : "N/A";
}

function calculateNextFtUnlockDate(
    startTimestamp?: number,
    roundInterval?: number,
    roundsTotal?: number,
): string {
    if (
        !startTimestamp ||
        Number.isNaN(startTimestamp) ||
        !roundInterval ||
        Number.isNaN(roundInterval) ||
        roundInterval <= 0
    ) {
        return "N/A";
    }

    const totalRounds = roundsTotal ?? 0;
    const nowSeconds = Math.floor(Date.now() / 1000);
    let nextUnlock = startTimestamp + roundInterval;
    let releaseIndex = 1;

    while (
        nextUnlock <= nowSeconds &&
        (totalRounds <= 0 || releaseIndex < totalRounds)
    ) {
        nextUnlock += roundInterval;
        releaseIndex += 1;
    }

    if (
        totalRounds > 0 &&
        releaseIndex >= totalRounds &&
        nextUnlock <= nowSeconds
    ) {
        return "Completed";
    }

    return formatDateFromSeconds(nextUnlock);
}

export function LockupDetailsModal({
    isOpen,
    onClose,
    onBack,
    asset,
    treasuryId,
}: LockupDetailsModalProps) {
    const [guideOpen, setGuideOpen] = useState(false);
    const isNearLockup = asset?.balance.type === "Vested";
    const isFtLockup = !isNearLockup && !!asset?.lockupInstanceId;

    const { data: lockupContract } = useTreasuryLockup(
        isOpen && isNearLockup && treasuryId ? treasuryId : null,
    );

    if (!asset || (!isNearLockup && !isFtLockup)) return null;

    let total = Big(0);
    let locked = Big(0);
    let unlocked = Big(0);
    let progressPct = 0;
    let progressLabel = "0%";
    let reservedStorage = Big(0);
    let lockupStaked = Big(0);
    // Used by progress/locked-unlocked math (falls back to total when missing).
    let allocatedForProgress = Big(0);
    // Raw `totalAllocated` from contract (no fallback), used for earned breakdown.
    let allocatedFromContract = Big(0);
    let summaryTotal = Big(0);

    if (isFtLockup && asset.balance.type === "Standard") {
        const totalRaw =
            asset.ftLockupSchedule?.totalAmount ??
            asset.balance.total.toFixed(0);
        const unlockedRaw = asset.ftLockupSchedule?.unlockedAmount ?? "0";
        const lockedRaw =
            asset.ftLockupSchedule?.lockedAmount ??
            asset.balance.locked.toFixed(0);
        const roundsDone = asset.ftLockupSchedule?.roundsCompleted ?? 0;
        const roundsTotal = asset.ftLockupSchedule?.roundsTotal ?? 0;

        total = Big(formatBalance(totalRaw, asset.decimals, asset.decimals));
        unlocked = Big(
            formatBalance(unlockedRaw, asset.decimals, asset.decimals),
        );
        locked = Big(formatBalance(lockedRaw, asset.decimals, asset.decimals));
        summaryTotal = total;

        progressPct = total.gt(0) ? unlocked.div(total).mul(100).toNumber() : 0;
        progressLabel =
            roundsTotal > 0
                ? `${roundsDone}/${roundsTotal} Rounds`
                : `${progressPct.toFixed(0)}%`;
    }

    if (isNearLockup && asset.balance.type === "Vested") {
        // NEAR lockup uses vesting-specific fields from lockup balance.
        const allocatedRaw = asset.balance.lockup.totalAllocated.gt(0)
            ? asset.balance.lockup.totalAllocated
            : asset.balance.lockup.total;
        const allocatedRawForBreakdown = asset.balance.lockup.totalAllocated;
        const lockedRaw = asset.balance.lockup.unvested;
        const unlockedRaw = allocatedRaw.sub(lockedRaw);
        lockupStaked = asset.balance.lockup.staked;
        allocatedForProgress = allocatedRaw;
        allocatedFromContract = Big(
            formatBalance(
                allocatedRawForBreakdown,
                asset.decimals,
                asset.decimals,
            ),
        );

        total = Big(
            formatBalance(allocatedRaw, asset.decimals, asset.decimals),
        );
        summaryTotal = Big(
            formatBalance(
                asset.balance.lockup.total,
                asset.decimals,
                asset.decimals,
            ),
        );
        locked = Big(formatBalance(lockedRaw, asset.decimals, asset.decimals));
        unlocked = Big(
            formatBalance(unlockedRaw, asset.decimals, asset.decimals),
        );
        progressPct = total.gt(0) ? unlocked.div(total).mul(100).toNumber() : 0;
        // Avoid showing 100% while a non-zero locked balance still exists.
        if (locked.gt(0)) {
            progressLabel = `${Math.min(progressPct, 99.9).toFixed(1)}%`;
        } else {
            progressLabel = "100%";
        }
        reservedStorage = Big(
            formatBalance(asset.balance.lockup.storageLocked, asset.decimals),
        );
    }

    const totalUsd = summaryTotal.mul(asset.price).toNumber();

    const roundsTotal = asset.ftLockupSchedule?.roundsTotal ?? 0;

    const nextUnlockDate = calculateNextFtUnlockDate(
        asset.ftLockupSchedule?.startTimestamp,
        asset.ftLockupSchedule?.roundInterval,
        asset.ftLockupSchedule?.roundsTotal,
    );

    const nearStartDate = formatDateFromNanoseconds(
        lockupContract?.vestingSchedule?.startTimestamp,
    );
    const nearEndDate = formatDateFromNanoseconds(
        lockupContract?.vestingSchedule?.endTimestamp,
    );
    const amountSummaryToken = {
        address: asset.contractId || "",
        symbol: asset.symbol,
        decimals: asset.decimals,
        name: asset.name,
        icon: asset.icon,
        network: asset.network,
        chainIcons: asset.chainIcons,
    };
    const allocatedAmountSummary = (
        <AmountSummary
            title={isNearLockup ? "Balance" : "Allocated Amount"}
            total={summaryTotal.toFixed(2)}
            totalUSD={totalUsd}
            token={amountSummaryToken}
        />
    );
    const hasLockupStakingNotice = isNearLockup && lockupStaked.gt(0);
    const lockupStakedDisplay = formatSmartAmount(
        Big(formatBalance(lockupStaked, asset.decimals)),
    );
    const isFullLockupStaked =
        allocatedForProgress.gt(0) && lockupStaked.gte(allocatedForProgress);
    const earnedFromStaking =
        allocatedFromContract.gt(0) && summaryTotal.gt(allocatedFromContract)
            ? summaryTotal.sub(allocatedFromContract)
            : Big(0);
    const showTokenBreakdown =
        isNearLockup && allocatedFromContract.gt(0) && earnedFromStaking.gt(0);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[560px] overflow-hidden">
                <DialogHeader>
                    <div className="flex items-center gap-1">
                        {onBack ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 -ml-1"
                                onClick={onBack}
                            >
                                <ChevronLeft className="size-4" />
                            </Button>
                        ) : null}
                        <DialogTitle className="text-left">
                            Lockup Details
                        </DialogTitle>
                    </div>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="space-y-6">
                        {isNearLockup ? (
                            <div className="overflow-hidden rounded-xl border border-border/70">
                                <div className="p-[3px]">
                                    {allocatedAmountSummary}
                                </div>

                                {reservedStorage.gt(0) ? (
                                    <div className="flex items-center justify-between px-2 py-2 text-sm">
                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                            Reserved For Storage{" "}
                                            <Tooltip content="NEAR reserved by the lockup account to pay storage costs.">
                                                <Info className="size-3.5" />
                                            </Tooltip>
                                        </div>
                                        <span className="text-foreground">
                                            {reservedStorage.toFixed(2)}{" "}
                                            {asset.symbol}
                                        </span>
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            allocatedAmountSummary
                        )}
                        {hasLockupStakingNotice ? (
                            <div className="rounded-xl bg-muted/60 px-4 py-3 text-sm flex items-start gap-2">
                                <Info className="size-4 mt-0.5 shrink-0" />
                                <p className="text-foreground">
                                    {isFullLockupStaked
                                        ? `All ${lockupStakedDisplay} ${asset.symbol} from your lockup is earning right now.`
                                        : `Part of your lockup (${lockupStakedDisplay} ${asset.symbol}) is earning right now.`}{" "}
                                    To use unlocked tokens, stop earning first
                                    and withdraw them.
                                </p>
                            </div>
                        ) : null}
                        {showTokenBreakdown ? (
                            <div className="space-y-2 text-sm">
                                <p className="font-semibold">Token Breakdown</p>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-muted-foreground">
                                            Allocated Amount
                                        </p>
                                        <p className="font-medium">
                                            {allocatedFromContract.toFixed(2)}{" "}
                                            {asset.symbol}
                                        </p>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-muted-foreground">
                                            Earned
                                        </p>
                                        <p className="text-general-success-foreground font-medium">
                                            +{earnedFromStaking.toFixed(2)}{" "}
                                            {asset.symbol}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="space-y-2 text-sm">
                            <div className="flex items-center justify-between ">
                                <p className="font-semibold">Progress</p>
                                <p>{progressLabel}</p>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-foreground"
                                    style={{
                                        width: `${Math.min(Math.max(progressPct, 0), 100)}%`,
                                    }}
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-muted-foreground">
                                        Unlocked
                                    </p>
                                    <p className="text-general-success-foreground font-medium">
                                        {unlocked.toFixed(2)} {asset.symbol}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-muted-foreground">
                                        Locked
                                    </p>
                                    <p className="font-medium">
                                        {locked.toFixed(2)} {asset.symbol}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 text-sm">
                            <p className="font-semibold">Schedule</p>
                            {isFtLockup ? (
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">
                                            Start Date
                                        </span>
                                        <span>
                                            {formatDateFromSeconds(
                                                asset.ftLockupSchedule
                                                    ?.startTimestamp,
                                            )}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">
                                            Rounds
                                        </span>
                                        <span>{roundsTotal || "N/A"}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">
                                            Release Interval
                                        </span>
                                        <span>
                                            {formatReleaseInterval(
                                                asset.ftLockupSchedule
                                                    ?.roundInterval,
                                            )}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">
                                            Next Unlock Date
                                        </span>
                                        <span>{nextUnlockDate}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">
                                            Start Date
                                        </span>
                                        <span>{nearStartDate}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">
                                            End Date
                                        </span>
                                        <span>{nearEndDate}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <Collapsible
                            open={guideOpen}
                            onOpenChange={setGuideOpen}
                            className="overflow-hidden lockup-grant-box"
                        >
                            <CollapsibleTrigger asChild>
                                <button
                                    type="button"
                                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium cursor-pointer"
                                >
                                    <span className="flex items-center gap-2">
                                        <BadgeDollarSign className="size-4 text-muted-foreground" />
                                        How your grant works
                                    </span>
                                    {guideOpen ? (
                                        <ChevronUp className="size-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronDown className="size-4 text-muted-foreground" />
                                    )}
                                </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="px-3 pb-3 text-xs text-muted-foreground">
                                {isFtLockup ? (
                                    <ol className="list-decimal pl-4 space-y-1">
                                        <li>
                                            You receive a grant for a specific
                                            period of time. Instead of getting
                                            the full amount at once, the assets
                                            become available in parts over time.
                                        </li>
                                        <li>
                                            When the date for the next release
                                            arrives, that portion of tokens is
                                            automatically unlocked and moved to
                                            your treasury balance.
                                        </li>
                                        <li>
                                            Once they appear in your balance,
                                            you can immediately use them for
                                            payments, transfers, or other
                                            transactions.
                                        </li>
                                    </ol>
                                ) : (
                                    <ol className="list-decimal pl-4 space-y-1">
                                        <li>
                                            You receive a grant for a set period
                                            of time with a defined start and end
                                            date.
                                        </li>
                                        <li>
                                            As tokens unlock, they automatically
                                            become available in your treasury
                                            balance.
                                        </li>
                                        <li>
                                            You can use the unlocked tokens
                                            immediately for payments, transfers,
                                            or other transactions.
                                        </li>
                                    </ol>
                                )}
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

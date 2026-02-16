import { cn } from "@/lib/utils";

/**
 * Formats the reset date for display
 */
function formatResetDate(resetAt?: string) {
    if (!resetAt) {
        return "";
    }

    const date = new Date(resetAt);
    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

interface CreditsQuotaDisplayProps {
    creditsAvailable: number;
    creditsUsed: number;
    creditsTotal: number;
    creditsResetAt?: string;
    isFree: boolean;
    isUnlimited?: boolean;
    className?: string;
}

/**
 * Reusable component for displaying credits quota with progress bar and reset date
 * Shows available/used credits, progress bar, and optional reset date for non-free plans
 */
export function CreditsQuotaDisplay({
    creditsAvailable,
    creditsUsed,
    creditsTotal,
    creditsResetAt,
    isFree,
    isUnlimited = false,
    className,
}: CreditsQuotaDisplayProps) {
    // Calculate progress percentage
    const progressPercentage = isUnlimited
        ? 0
        : creditsTotal === 0
            ? 0
            : Math.min(100, (creditsUsed / creditsTotal) * 100);

    // Format reset date
    const resetDate = formatResetDate(creditsResetAt);

    // Determine if credits are depleted
    const isDepleted = creditsAvailable === 0;

    return (
        <div
            className={cn(
                "space-y-2 border-b pb-4",
                isDepleted
                    ? "border-general-info-border"
                    : "border-general-unofficial-border",
                className,
            )}
        >
            <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">
                    {creditsAvailable} Available
                </span>
                <span className="text-muted-foreground text-xs">
                    {creditsUsed} Used
                </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 bg-general-unofficial-accent rounded-full overflow-hidden">
                <div
                    className="h-full bg-foreground transition-all"
                    style={{ width: `${progressPercentage}%` }}
                />
            </div>

            {!isFree && resetDate && isDepleted && (
                <p className="text-xs text-muted-foreground">
                    Limit will reset on {resetDate}
                </p>
            )}
        </div>
    );
}


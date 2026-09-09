"use client";

import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

interface ThresholdStepperProps {
    currentThreshold: number;
    memberCount: number;
    onValueChange: (value: number) => void;
    disabled?: boolean;
    className?: string;
}

/**
 * `−  n/total  +` control for how many of a role's members must approve.
 * The value is clamped to 1…memberCount, so the role can never end up with a
 * threshold nobody can reach.
 */
export function ThresholdStepper({
    currentThreshold,
    memberCount,
    onValueChange,
    disabled = false,
    className,
}: ThresholdStepperProps) {
    const t = useTranslations("thresholdStepper");
    const value = Math.min(Math.max(currentThreshold, 1), memberCount);

    return (
        <div className={cn("flex items-center gap-4", className)}>
            <Button
                type="button"
                variant="neutral"
                size="icon-sm"
                aria-label={t("decrease")}
                disabled={disabled || value <= 1}
                onClick={() => onValueChange(value - 1)}
            >
                <Icon icon={MinusSignIcon} />
            </Button>
            <span className="text-base font-medium tabular-nums text-foreground">
                {value}/{memberCount}
            </span>
            <Button
                type="button"
                variant="neutral"
                size="icon-sm"
                aria-label={t("increase")}
                disabled={disabled || value >= memberCount}
                onClick={() => onValueChange(value + 1)}
            >
                <Icon icon={PlusSignIcon} />
            </Button>
        </div>
    );
}

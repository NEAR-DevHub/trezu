"use client";

import { useTranslations } from "next-intl";
import { Pill } from "./pill";

interface GuestBadgeProps {
    showTooltip?: boolean;
    side?: "top" | "bottom" | "left" | "right";
    compact?: boolean;
    id?: string;
}

export function GuestBadge({
    showTooltip,
    side,
    compact,
    id,
}: GuestBadgeProps) {
    const t = useTranslations("guestBadge");
    return (
        <Pill
            id={id}
            title={t("title")}
            variant="info"
            info={showTooltip ? t("tooltip") : undefined}
            side={side}
            className={compact ? "px-1 py-0.5 text-xxs" : undefined}
        />
    );
}

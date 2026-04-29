"use client";

import { useTranslations } from "next-intl";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/pill";
import { EARN_ANNOUNCEMENT, useNewFeatureTour } from "../steps/page-tours";

interface NEWProps {
    id?: string;
    enabled?: boolean;
    pillLabel?: string;
    side?: "top" | "bottom" | "left" | "right";
    className?: string;
}

export function NEW({
    id = EARN_ANNOUNCEMENT.selector.slice(1),
    enabled = true,
    pillLabel,
    side,
    className,
}: NEWProps) {
    const t = useTranslations("newBadge");
    const isMobile = useMediaQuery("(max-width: 1023px)");

    useNewFeatureTour(enabled && !isMobile);

    if (!enabled) {
        return null;
    }

    return (
        <Pill
            id={id}
            title={pillLabel ?? t("label")}
            variant="info"
            side={side}
            className={cn("px-2.5 py-1 text-sm", className)}
        />
    );
}

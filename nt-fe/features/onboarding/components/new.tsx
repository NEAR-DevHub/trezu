"use client";

import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/pill";
import {
    NEW_FEATURE_ANNOUNCEMENT,
    useNewFeatureTour,
} from "../steps/page-tours";

interface NEWProps {
    id?: string;
    enabled?: boolean;
    pillLabel?: string;
    side?: "top" | "bottom" | "left" | "right";
    className?: string;
}

export function NEW({
    id = NEW_FEATURE_ANNOUNCEMENT.selector.slice(1),
    enabled = true,
    pillLabel = "New",
    side,
    className,
}: NEWProps) {
    const isMobile = useMediaQuery("(max-width: 1023px)");

    useNewFeatureTour(enabled && !isMobile);

    if (!enabled) {
        return null;
    }

    return (
        <Pill
            id={id}
            title={pillLabel}
            variant="info"
            side={side}
            className={cn("px-2.5 py-1 text-sm", className)}
        />
    );
}

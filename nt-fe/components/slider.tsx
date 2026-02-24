"use client";

import * as React from "react";
import { Slider as BaseSlider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * Mobile-friendly Slider wrapper.
 * Increases the track height and thumb size so touch targets meet
 * the ~44px minimum recommended by WCAG / Apple HIG.
 */
function Slider({
    className,
    thumbClassName,
    trackClassName,
    ...props
}: React.ComponentProps<typeof BaseSlider>) {
    return (
        <BaseSlider
            className={cn("py-3", className)}
            thumbClassName={cn(
                "size-5 border-2 after:absolute after:inset-[-12px] after:content-[''] after:rounded-full",
                thumbClassName,
            )}
            trackClassName={cn("h-2", trackClassName)}
            {...props}
        />
    );
}

export { Slider };

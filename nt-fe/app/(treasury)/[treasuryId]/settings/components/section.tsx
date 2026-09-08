"use client";

import type { Coins01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

/** Tile + glyph that leads every settings section; callers own the surface. */
export function SectionIcon({
    icon,
    className,
}: {
    icon: typeof Coins01Icon;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex size-10 shrink-0 items-center justify-center",
                className,
            )}
        >
            <Icon icon={icon} className="size-[18px]" />
        </div>
    );
}

export function SectionText({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold leading-[1.2]">{title}</h3>
            <p className="text-sm font-medium leading-[1.5] text-general-secondary-foreground">
                {description}
            </p>
        </div>
    );
}

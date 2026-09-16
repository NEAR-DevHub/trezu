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

/**
 * The accent tile every settings section leads with. Dark mode flips the tile
 * to a light surface, so the brand green (#00EC97) loses its contrast there and
 * the glyph drops to green-700 (#009660).
 */
export const sectionIconAccentClasses =
    "rounded-full bg-general-bg-primary text-green-500 dark:text-green-700";

/**
 * Settings actions render their disabled state as a flat grey fill (#D4D4D4 on
 * #A1A1A1) rather than the global 50% fade, so a blocked Save reads as inert
 * instead of as a washed-out primary button.
 */
export const disabledActionClasses =
    "disabled:opacity-100 disabled:bg-gray-300 disabled:text-gray-400";

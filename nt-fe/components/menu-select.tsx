"use client";

import { ArrowDown01Icon, CheckIcon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { Input } from "@/components/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MenuSelectOption {
    value: string;
    label: string;
}

interface MenuSelectProps {
    value: string;
    options: readonly MenuSelectOption[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
    /** Adds a filter field above the list; the string is its placeholder. */
    searchPlaceholder?: string;
    emptyMessage?: string;
    /** Shown when `value` matches no option. */
    placeholder?: string;
    id?: string;
    className?: string;
}

/**
 * A long list would otherwise open scrolled to the top, hiding the current
 * choice; the design shows the ticked row in view instead. Declared out here so
 * the ref keeps one identity: an inline callback is a fresh ref on every
 * keystroke in the filter, and React would re-run it and yank the list back.
 */
function revealSelected(node: HTMLButtonElement | null) {
    node?.scrollIntoView({ block: "center" });
}

/**
 * A field that reads like an `Input` and opens the app's menu surface: one
 * row per option, a tick against the current one, and an optional filter for
 * long lists. Backed by a popover rather than a native `<select>` so the rows
 * can carry the design's own type and spacing.
 */
export function MenuSelect({
    value,
    options,
    onValueChange,
    disabled,
    searchPlaceholder,
    emptyMessage,
    placeholder,
    id,
    className,
}: MenuSelectProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const selectedLabel =
        options.find((option) => option.value === value)?.label ?? placeholder;

    const visibleOptions = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return options;
        return options.filter((option) =>
            option.label.toLowerCase().includes(query),
        );
    }, [options, search]);

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) setSearch("");
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <button
                    id={id}
                    type="button"
                    disabled={disabled}
                    className={cn(
                        "flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg bg-muted px-4 text-left text-sm font-medium transition-colors",
                        "hover:bg-general-unofficial-ghost-hover disabled:pointer-events-none disabled:opacity-50",
                        className,
                    )}
                >
                    <span className="min-w-0 flex-1 truncate">
                        {selectedLabel}
                    </span>
                    <Icon
                        icon={ArrowDown01Icon}
                        className={cn(
                            "size-5 shrink-0 text-muted-foreground transition-transform",
                            open && "rotate-180",
                        )}
                    />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="w-(--radix-popover-trigger-width) rounded-2xl border-general-border p-1.5 shadow-lg"
            >
                {searchPlaceholder && (
                    <div className="pb-2">
                        <Input
                            search
                            autoFocus
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={searchPlaceholder}
                            clearable={false}
                            inputClassName="h-9 rounded-lg bg-card! border border-general-border"
                        />
                    </div>
                )}
                <div className="flex max-h-66 flex-col gap-0.5 overflow-y-auto">
                    {visibleOptions.map((option) => (
                        <button
                            key={option.value}
                            ref={
                                option.value === value
                                    ? revealSelected
                                    : undefined
                            }
                            type="button"
                            onClick={() => {
                                onValueChange(option.value);
                                handleOpenChange(false);
                            }}
                            className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold transition-colors hover:bg-general-unofficial-ghost-hover"
                        >
                            <span className="min-w-0 flex-1 truncate">
                                {option.label}
                            </span>
                            {option.value === value && (
                                <Icon icon={CheckIcon} className="shrink-0" />
                            )}
                        </button>
                    ))}
                    {visibleOptions.length === 0 && (
                        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                            {emptyMessage}
                        </p>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

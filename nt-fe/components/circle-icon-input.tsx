"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { type ChangeEvent, type ComponentProps, forwardRef } from "react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

interface CircleIconInputProps
    extends Omit<ComponentProps<"input">, "className" | "type"> {
    icon: IconSvgElement;
    invalid?: boolean;
    clearLabel: string;
    onClear?: () => void;
}

export const CircleIconInput = forwardRef<
    HTMLInputElement,
    CircleIconInputProps
>(function CircleIconInput(
    {
        icon,
        invalid,
        clearLabel,
        onClear,
        value,
        onChange,
        "aria-label": ariaLabel,
        placeholder,
        ...props
    },
    ref,
) {
    const hasValue = String(value ?? "").length > 0;

    return (
        <label
            className={cn(
                "group flex h-16 items-center gap-3 rounded-3xl border bg-card py-2 pr-4 pl-3 transition-colors",
                invalid
                    ? "border-destructive"
                    : "border-general-border focus-within:border-general-unofficial-border-4",
            )}
        >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-green-700">
                <Icon icon={icon} className="size-4.5 text-white" />
            </span>
            <input
                ref={ref}
                type="text"
                value={value}
                onChange={onChange}
                aria-label={ariaLabel ?? placeholder}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent text-xl leading-[1.2] font-semibold tracking-[-0.02em] text-general-foreground outline-none placeholder:text-general-muted-foreground"
                {...props}
            />
            {hasValue ? (
                <button
                    type="button"
                    aria-label={clearLabel}
                    className="hidden size-5 shrink-0 items-center justify-center text-general-muted-foreground group-focus-within:flex"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                        onChange?.({
                            target: { value: "" },
                        } as ChangeEvent<HTMLInputElement>);
                        onClear?.();
                    }}
                >
                    <Icon icon={Cancel01Icon} className="size-5" />
                </button>
            ) : null}
        </label>
    );
});

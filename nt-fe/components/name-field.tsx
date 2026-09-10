"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { type ComponentProps, type ReactNode, forwardRef } from "react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export const nameFieldShellClassName =
    "group flex h-16 w-full items-center gap-3 rounded-3xl border bg-card pr-4 pl-3";

const nameFieldValueClassName =
    "min-w-0 flex-1 truncate bg-transparent text-left font-sans text-base font-semibold leading-[1.2] text-general-foreground outline-none placeholder:text-general-muted-foreground";

const heroValueClassName =
    "min-w-0 flex-1 bg-transparent text-xl leading-[1.2] font-semibold tracking-[-0.02em] text-general-foreground outline-none placeholder:text-general-muted-foreground";

type IconTextFieldVariant = "default" | "hero";

function FieldIcon({
    icon,
    variant,
}: {
    icon: IconSvgElement;
    variant: IconTextFieldVariant;
}) {
    return (
        <span
            className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                variant === "hero"
                    ? "bg-green-700"
                    : "border border-general-unofficial-border-2 bg-general-bg-secondary",
            )}
        >
            <Icon
                icon={icon}
                className={cn(
                    "size-4.5 shrink-0",
                    variant === "hero"
                        ? "text-white"
                        : "text-general-secondary-foreground",
                )}
            />
        </span>
    );
}

interface NameFieldProps
    extends Omit<ComponentProps<"input">, "className" | "type"> {
    icon: IconSvgElement;
    invalid?: boolean;
    clearLabel: string;
    onClear: () => void;
    /** `hero` is the create-treasury name field (green well, larger type). */
    variant?: IconTextFieldVariant;
}

export const NameField = forwardRef<HTMLInputElement, NameFieldProps>(
    function NameField(
        {
            icon,
            invalid,
            clearLabel,
            onClear,
            variant = "default",
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
                    nameFieldShellClassName,
                    "transition-colors",
                    variant === "hero" && "py-2",
                    invalid
                        ? "border-destructive"
                        : "border-general-border focus-within:border-general-unofficial-border-4",
                )}
            >
                <FieldIcon icon={icon} variant={variant} />
                <input
                    ref={ref}
                    type="text"
                    value={value}
                    onChange={onChange}
                    aria-label={ariaLabel ?? placeholder}
                    placeholder={placeholder}
                    className={
                        variant === "hero"
                            ? heroValueClassName
                            : nameFieldValueClassName
                    }
                    {...props}
                />
                {hasValue ? (
                    <button
                        type="button"
                        aria-label={clearLabel}
                        className="hidden size-5 shrink-0 items-center justify-center text-general-muted-foreground group-focus-within:flex"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onClear}
                    >
                        <Icon icon={Cancel01Icon} className="size-5" />
                    </button>
                ) : null}
            </label>
        );
    },
);

interface NameFieldButtonProps extends ComponentProps<"button"> {
    icon?: IconSvgElement;
    leading?: ReactNode;
    invalid?: boolean;
    empty?: boolean;
}

export function NameFieldButton({
    icon,
    leading,
    invalid,
    empty,
    className,
    children,
    ...props
}: NameFieldButtonProps) {
    return (
        <button
            type="button"
            className={cn(
                nameFieldShellClassName,
                invalid ? "border-destructive" : "border-general-border",
                className,
            )}
            {...props}
        >
            {leading ??
                (icon ? <FieldIcon icon={icon} variant="default" /> : null)}
            <span
                className={cn(
                    nameFieldValueClassName,
                    empty && "text-general-muted-foreground",
                )}
            >
                {children}
            </span>
        </button>
    );
}

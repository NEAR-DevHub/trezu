import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
    "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-base font-bold leading-none tracking-tight transition-all duration-100 active:not-disabled:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
    {
        variants: {
            variant: {
                // Surface and label are a token pair (`--primary` /
                // `--primary-foreground`), both theme-aware and both re-written
                // together by `PrimaryColorProvider` for branded treasuries.
                // Never override just the background at a call site — that's how
                // white labels ended up on white buttons in the dark theme.
                default:
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                destructive:
                    "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
                outline:
                    "border bg-background shadow-xs hover:bg-foreground/10 dark:bg-input/30 dark:border-input dark:hover:bg-foreground/20",
                // The design system's secondary button: borderless grey surface
                // with a grey label that darkens to near-black on hover. Always
                // 14px/700, whatever the size. Disabled keeps the resting label
                // colour — only the base `disabled:opacity-50` fades it.
                secondary:
                    "bg-gray-125 text-sm text-gray-500 hover:text-gray-900 disabled:text-gray-500 dark:bg-white/10 dark:text-gray-400 dark:hover:text-gray-100 dark:disabled:text-gray-400",
                // Legacy generic grey button, kept because ~30 call sites layer
                // their own surface/label colours on top of it. Prefer
                // `secondary` for anything new.
                muted: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
                link: "text-primary underline-offset-4 hover:underline",
                pill: "rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20",
                unstyled: "",
            },
            size: {
                default: "h-11 px-5 has-[>svg]:px-4",
                sm: "h-9 gap-1.5 px-3.5 text-sm has-[>svg]:px-3",
                lg: "h-12 px-6 has-[>svg]:px-5",
                xl: "h-13 px-5 gap-2.5",
                mini: "h-7 gap-1 px-2.5 text-sm has-[>svg]:px-2",
                icon: "size-11",
                "icon-sm": "size-9",
                "icon-lg": "size-12",
            },
        },
        // The secondary button ships its own height scale (mini 28 / sm 36 /
        // default 40 / lg 44 / xl 52). It diverges from the shared scale at
        // `default` and `lg` only, so those two are patched here rather than
        // globally — retuning the shared sizes would move every other button.
        compoundVariants: [
            { variant: "secondary", size: "default", className: "h-10" },
            { variant: "secondary", size: "lg", className: "h-11" },
        ],
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

function Button({
    className,
    variant = "default",
    size = "default",
    asChild = false,
    ...props
}: React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
        asChild?: boolean;
    }) {
    const Comp = asChild ? Slot : "button";

    return (
        <Comp
            data-slot="button"
            data-variant={variant}
            data-size={size}
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    );
}

export { Button, buttonVariants };

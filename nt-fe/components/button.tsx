import { cn } from "@/lib/utils";
import { Button as ShadcnButton, buttonVariants } from "./ui/button";
import { VariantProps } from "class-variance-authority";
import { Tooltip } from "./tooltip";
import { Icon } from "./icon";
import { LoaderCircleIcon } from "@hugeicons/core-free-icons";

type ShadcnVariant = VariantProps<typeof buttonVariants>["variant"];

/**
 * The loading state's skin: gray-500 (#737373) surface, white label and spinner,
 * 14px/500 at 150% line height, 8px radius. It's split in two so the layering
 * works out: the surface goes *before* the call site's `className`, letting a
 * button that must stay on brand (a destructive red, say) keep its own
 * background, while the rest goes *after*, so every loading button agrees on
 * type and radius no matter what the call site asked for when idle.
 *
 * Height is deliberately not part of this — it stays with the button's `size`,
 * because resizing a button the moment it's clicked moves the layout under the
 * user's cursor.
 *
 * `disabled:opacity-100` is also deliberate: a loading button is always
 * disabled, and the design wants these exact colours, not the base 50% fade.
 */
// `dark:bg-gray-500` is not redundant with `bg-gray-500`: a `dark:bg-*` from
// the underlying variant would out-specify a plain `bg-*` here, so
// `destructive` would stay red in dark mode only. Call sites that genuinely
// want to keep their colour override both (see the "Remove member" modal).
// No hover pair is needed — a loading button is disabled, and the base sets
// `disabled:pointer-events-none`.
const LOADING_SURFACE_CLASS = "bg-gray-500 dark:bg-gray-500";
const LOADING_SKIN_CLASS =
    "text-white rounded-[8px] text-sm font-medium leading-normal disabled:opacity-100";

interface ButtonProps
    extends Omit<React.ComponentProps<typeof ShadcnButton>, "variant"> {
    variant?: ShadcnVariant | "outline-destructive" | "card";
    size?: VariantProps<typeof buttonVariants>["size"];
}

interface ButtonPropsWithTooltip extends ButtonProps {
    tooltipContent?: React.ReactNode;
    side?: "top" | "bottom" | "left" | "right";
    /**
     * Swaps in the loading skin, prepends a 16px spinner and disables the
     * button. Callers only pass their idle/loading label — the spinner is not
     * theirs to render.
     */
    loading?: boolean;
}

export function Button({
    variant,
    className: classNameOverride,
    size,
    tooltipContent,
    side,
    loading = false,
    children,
    ...props
}: ButtonPropsWithTooltip) {
    const disabled = props.disabled || loading;
    let className = "";
    switch (variant ?? "default") {
        case "link":
            className =
                "hover:no-underline font-semibold text-foreground/80 hover:text-foreground";
            break;
        case "card":
            className = "bg-card text-foreground hover:bg-card/80";
            break;
        case "ghost":
            className = "hover:bg-muted-foreground/5";
            break;
        case "outline":
            className = "hover:bg-muted-foreground/5 border";
            break;
        case "outline-destructive":
            className =
                "border text-destructive hover:text-destructive hover:bg-destructive/10";
            break;
    }

    // Geometry (height/padding/radius) is owned by `ui/button`'s cva. This
    // wrapper only layers variant colors on top — emitting geometry here would
    // win the `twMerge` and defeat the design system's sizes at every call site.
    const shadcnVariant: ShadcnVariant =
        variant === "outline-destructive"
            ? "outline"
            : variant === "card"
              ? "muted"
              : variant;

    const button = (
        <ShadcnButton
            variant={shadcnVariant}
            className={cn(
                className,
                loading && LOADING_SURFACE_CLASS,
                classNameOverride,
                loading && LOADING_SKIN_CLASS,
            )}
            size={size}
            {...props}
            disabled={disabled}
        >
            {/* A ternary, not `{loading && <Icon/>}{children}`: the latter hands
                down a two-element array (`[false, children]`) even when idle,
                and `asChild` call sites feed that to Radix's `Slot`, which
                requires exactly one element child. Idle buttons must pass
                their children through untouched. */}
            {loading ? (
                <>
                    <Icon
                        icon={LoaderCircleIcon}
                        className="size-4 animate-spin"
                    />
                    {children}
                </>
            ) : (
                children
            )}
        </ShadcnButton>
    );

    if (tooltipContent) {
        // When disabled, wrap in a span to avoid nested <button> elements (TooltipTrigger renders a button when asChild=false)
        const triggerChild = disabled ? (
            <span className={cn("inline-flex", classNameOverride)}>
                {button}
            </span>
        ) : (
            button
        );
        return (
            <Tooltip
                content={tooltipContent}
                triggerProps={{ asChild: true }}
                side={side}
            >
                {triggerChild}
            </Tooltip>
        );
    }

    return button;
}

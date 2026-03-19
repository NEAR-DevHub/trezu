import { useThemeStore } from "@/stores/theme-store";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const networkBadgeVariants = cva(
    "inline-flex items-center gap-1 rounded-lg font-medium",
    {
        variants: {
            variant: {
                default: "bg-secondary text-secondary-foreground px-2 py-0.5",
                ghost: "text-secondary-foreground px-2 py-0.5",
                secondary:
                    "bg-secondary/50 text-secondary-foreground border border-border px-2 py-0.5",
            },
            size: {
                lg: "text-xl md:px-3 p-1",
                default: "text-base md:px-2 p-1",
                sm: "text-xs md:px-2 p-1",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "sm",
        },
    },
);

const iconSizeMap = {
    lg: "size-6",
    default: "size-4",
    sm: "size-3",
} as const;

interface NetworkBadgeProps extends VariantProps<typeof networkBadgeVariants> {
    name: string;
    iconDark: string;
    iconLight: string;
    className?: string;
}

export function NetworkBadge({
    name,
    iconDark,
    iconLight,
    variant,
    size,
    className,
}: NetworkBadgeProps) {
    const { theme } = useThemeStore();
    const icon = theme === "dark" ? iconDark : iconLight;
    const iconSize = iconSizeMap[size ?? "sm"];
    return (
        <span
            className={cn(networkBadgeVariants({ variant, size }), className)}
        >
            <img
                src={icon}
                alt={name}
                className={cn(
                    iconSize,
                    name.toLowerCase() === "near protocol"
                        ? "p-0.5"
                        : "rounded-full",
                )}
            />
            <span className="hidden md:block">{name}</span>
        </span>
    );
}

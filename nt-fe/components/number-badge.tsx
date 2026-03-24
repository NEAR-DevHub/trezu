import { cn } from "@/lib/utils";
import { cva } from "class-variance-authority";

const styles = cva(
    "flex items-center justify-center rounded-[8px] text-xs font-semibold",
    {
        variants: {
            variant: {
                default: "bg-orange-500 text-white",
                secondary: "bg-muted text-muted-foreground",
                accent: "bg-general-unofficial-border text-foreground",
                error: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
            },
            sizes: {
                default: "size-5 px-2 py-[3px]",
                sm: "size-4 px-1 py-px",
            },
        },
        defaultVariants: {
            variant: "default",
            sizes: "default",
        },
    },
);

export function NumberBadge({
    number,
    variant = "default",
    sizes = "default",
}: {
    number: number;
    variant?: "default" | "secondary" | "accent" | "error";
    sizes?: "default" | "sm";
}) {
    return (
        <span
            aria-label={`${number} pending requests`}
            className={styles({ variant, sizes })}
        >
            {number}
        </span>
    );
}

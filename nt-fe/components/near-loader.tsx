import { cn } from "@/lib/utils";

/** Staggered so the three dots read as a left-to-right wave. */
const DOT_DELAYS = ["0ms", "160ms", "320ms"] as const;

/**
 * Branded loading indicator: the 72px NEAR mark with three pulsing dots below.
 * Purely decorative — callers own the accessible "loading" label.
 */
export function NearLoader({ className }: { className?: string }) {
    return (
        <div
            aria-hidden
            className={cn("flex flex-col items-center gap-6", className)}
        >
            <img
                src="/near.com-square.svg"
                alt=""
                className="size-18 rounded-2xl"
            />
            <div className="flex items-center gap-1.5">
                {DOT_DELAYS.map((delay) => (
                    <span
                        key={delay}
                        style={{ animationDelay: delay }}
                        className="size-1.5 animate-loading-dot rounded-full bg-muted-foreground motion-reduce:animate-none"
                    />
                ))}
            </div>
        </div>
    );
}

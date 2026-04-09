import { Check } from "lucide-react";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";

export interface SelectableOption {
    label: string;
    iconSrc?: string;
    iconClassName?: string;
}

interface SelectableOptionButtonProps {
    option: SelectableOption;
    selected: boolean;
    onClick: () => void;
}

export function SelectableOptionButton({
    option,
    selected,
    onClick,
}: SelectableOptionButtonProps) {
    return (
        <Button
            type="button"
            variant="unstyled"
            onClick={onClick}
            className={cn(
                "w-full rounded-lg border px-3.5 py-2 h-auto justify-between hover:bg-general-secondary/30",
                selected
                    ? "border-foreground bg-general-secondary"
                    : "border-input",
            )}
        >
            <div className="flex items-center gap-3 min-w-0">
                {option.iconSrc ? (
                    <img
                        src={option.iconSrc}
                        alt={option.label}
                        className="size-6 rounded-full object-cover shrink-0"
                    />
                ) : option.iconClassName ? (
                    <div
                        className={cn(
                            "size-6 rounded-full grid place-content-center text-xs font-semibold shrink-0",
                            option.iconClassName,
                        )}
                    />
                ) : null}
                <span className="text-base font-normal text-foreground truncate">
                    {option.label}
                </span>
            </div>
            <div
                className={cn(
                    "size-6 rounded-md border grid place-content-center shrink-0",
                    selected
                        ? "bg-foreground border-foreground text-background"
                        : "bg-muted/30 border-input text-transparent",
                )}
            >
                <Check className="size-4" />
            </div>
        </Button>
    );
}

import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";
import { Info } from "lucide-react";

interface InputBlockProps {
    title?: string;
    info?: string;
    topRightContent?: React.ReactNode;
    children: React.ReactNode;
    invalid: boolean;
    className?: string;
    interactive?: boolean;
}

export function InputBlock({
    children,
    title,
    info,
    topRightContent,
    invalid,
    interactive,
    className,
}: InputBlockProps) {
    return (
        <div
            className={cn(
                "px-3.5 py-3 rounded-xl bg-muted",
                invalid && "border-destructive border bg-destructive/5",
                interactive &&
                    "focus-within:bg-general-tertiary hover:bg-general-tertiary transition-colors",
                className,
            )}
        >
            <div className="flex justify-between items-center gap-2">
                <div className="flex items-center gap-1">
                    {title && (
                        <p className="text-xs text-muted-foreground">{title}</p>
                    )}
                    {info && (
                        <Tooltip content={info}>
                            <Info className="size-3 text-muted-foreground" />
                        </Tooltip>
                    )}
                </div>
                {topRightContent}
            </div>
            {children}
        </div>
    );
}

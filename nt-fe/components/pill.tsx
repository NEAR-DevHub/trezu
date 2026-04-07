import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

interface PillProps {
    id?: string;
    title: string;
    info?: string;
    icon?: React.ReactNode;
    variant?: "default" | "card" | "secondary" | "info" | "primary";
    side?: "top" | "bottom" | "left" | "right";
    className?: string;
}

const variants = {
    default: "",
    primary: "bg-primary text-primary-foreground",
    card: "bg-card text-card-foreground",
    secondary: "bg-secondary text-secondary-foreground",
    info: "bg-general-info-background-faded text-general-info-foreground",
};

export function Pill({
    id,
    title,
    info,
    icon,
    variant = "default",
    side,
    className,
}: PillProps) {
    const pill = (
        <div
            id={id}
            className={cn(
                "flex rounded-md items-center py-[3px] px-2 gap-1.5 w-fit text-xs font-medium text-center",
                variants[variant],
                className,
            )}
        >
            {info && <Info className="size-3 shrink-0" />}
            {!info && icon}
            {title}
        </div>
    );
    if (info) {
        return (
            <Tooltip content={info} side={side}>
                {pill}
            </Tooltip>
        );
    }
    return pill;
}

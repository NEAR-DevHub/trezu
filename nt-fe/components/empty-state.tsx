import { cn } from "@/lib/utils";
import { isValidElement } from "react";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
    icon: LucideIcon | React.ReactNode;
    title: string;
    description: string;
    className?: string;
}

export function EmptyState({
    icon,
    title,
    description,
    className,
}: EmptyStateProps) {
    const renderIcon = () => {
        if (isValidElement(icon)) return icon;
        const Icon = icon as LucideIcon;
        return <Icon className="size-5 text-muted-foreground" />;
    };

    return (
        <div
            className={cn(
                "flex flex-col gap-2 items-center justify-center py-12",
                className,
            )}
        >
            <div className="size-9 rounded-full bg-secondary flex items-center justify-center">
                {renderIcon()}
            </div>
            <div className="flex flex-col gap-0.5 items-center text-center">
                <p className="text-base font-semibold text-foreground">
                    {title}
                </p>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {description}
                </p>
            </div>
        </div>
    );
}

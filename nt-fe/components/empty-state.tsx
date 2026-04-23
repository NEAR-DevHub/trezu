import { cn } from "@/lib/utils";
import { isValidElement } from "react";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
    icon: LucideIcon | React.ReactNode;
    title: string;
    description: string;
    className?: string;
    iconWrapperClassName?: string;
    contentClassName?: string;
    titleClassName?: string;
    descriptionClassName?: string;
}

export function EmptyState({
    icon,
    title,
    description,
    className,
    iconWrapperClassName,
    contentClassName,
    titleClassName,
    descriptionClassName,
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
            <div
                className={cn(
                    "size-9 rounded-full bg-secondary flex items-center justify-center",
                    iconWrapperClassName,
                )}
            >
                {renderIcon()}
            </div>
            <div
                className={cn(
                    "flex flex-col gap-0.5 items-center text-center",
                    contentClassName,
                )}
            >
                <p
                    className={cn(
                        "text-base font-semibold text-foreground",
                        titleClassName,
                    )}
                >
                    {title}
                </p>
                <p
                    className={cn(
                        "text-xs text-muted-foreground whitespace-pre-wrap",
                        descriptionClassName,
                    )}
                >
                    {description}
                </p>
            </div>
        </div>
    );
}

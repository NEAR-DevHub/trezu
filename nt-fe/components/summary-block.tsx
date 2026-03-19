import { cn } from "@/lib/utils";
import { InputBlock } from "./input-block";

interface SummaryBlockProps {
    title?: string;
    icon?: React.ReactNode;
    secondRow?: React.ReactNode;
    subRow?: React.ReactNode;
    children?: React.ReactNode;
    className?: string;
    /**
     * When true, wraps content in an InputBlock
     * When false, renders a standalone bordered card
     * Default: true
     */
    useInputBlock?: boolean;
}

export function SummaryBlock({
    title,
    icon,
    secondRow,
    subRow,
    children,
    className,
    useInputBlock = true,
}: SummaryBlockProps) {
    const content = (
        <div
            className={cn(
                "flex flex-col gap-2 p-2 text-xs text-muted-foreground text-center justify-center items-center",
                className,
            )}
        >
            {title && <p className="font-medium text-xs">{title}</p>}
            {icon}
            {secondRow && (
                <div className="flex flex-col gap-0.5 max-w-full">
                    {secondRow}
                    {subRow}
                </div>
            )}
            {children && <div>{children}</div>}
        </div>
    );

    if (!useInputBlock) {
        return (
            <div className="w-full max-w-[280px] rounded-lg border bg-muted h-[180px] flex items-center justify-center">
                {content}
            </div>
        );
    }

    return (
        <InputBlock title="" invalid={false}>
            {content}
        </InputBlock>
    );
}

import {
    Dialog,
    DialogContent as BaseDialogContent,
    DialogHeader as BaseDialogHeader,
    DialogTitle as BaseDialogTitle,
    DialogTrigger,
    DialogClose as BaseDialogClose,
    DialogDescription,
    DialogFooter as BaseDialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";

interface DialogHeaderProps extends React.ComponentProps<typeof BaseDialogHeader> {
    centerTitle?: boolean;
    closeButton?: boolean;
}

function DialogHeader({ className, children, centerTitle = false, closeButton = true, ...props }: DialogHeaderProps) {
    return (
        <BaseDialogHeader
            {...props}
            className={cn("border-b border-border px-3 pb-3.5 -mx-3 flex flex-row items-center justify-between text-center gap-4", className)}
        >
            <div className={cn(centerTitle && "flex-1")}>
                {children}
            </div>
            {closeButton && (
                <BaseDialogClose className="rounded-xs opacity-70 transition-opacity hover:opacity-100 ">
                    <XIcon className="size-4" />
                    <span className="sr-only">Close</span>
                </BaseDialogClose>
            )}
        </BaseDialogHeader>
    );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof BaseDialogTitle>) {
    return (
        <BaseDialogTitle
            {...props}
            className={cn("text-lg font-semibold text-center", className)}
        />
    );
}

function DialogFooter({ className, ...props }: React.ComponentProps<typeof BaseDialogFooter>) {
    return (
        <BaseDialogFooter
            {...props}
            className={cn("px-3 -mx-3 pt-3 shrink-0", className)}
        />
    );
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof BaseDialogContent>) {
    return (
        <BaseDialogContent
            {...props}
            showCloseButton={false}
            className={cn(
                "bg-card p-3.5",
                // Mobile: bottom drawer (full width, no margins)
                "max-w-none! w-full inset-x-0 left-0 right-0 bottom-0 top-auto translate-x-0 translate-y-0 max-h-[85vh] rounded-t-2xl rounded-b-none",
                "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                "data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100",
                // Desktop: centered modal
                "sm:max-w-lg! sm:inset-x-auto sm:top-[50%] sm:left-[50%] sm:bottom-auto sm:right-auto",
                "sm:w-full sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg",
                "sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0",
                "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
                className
            )}
        >
            {children}
        </BaseDialogContent>
    );
}

export {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogTrigger,
    DialogDescription,
};

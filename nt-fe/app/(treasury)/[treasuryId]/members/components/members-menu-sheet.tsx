"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/button";
import { SheetHandle } from "@/components/mobile-shell/sheet-handle";
import { Dialog, DialogContent, DialogTitle } from "@/components/modal";
import { cn } from "@/lib/utils";

const ITEM_CLASS =
    "h-14 w-full justify-start gap-3 rounded-full bg-gray-100 px-5 text-base font-semibold text-foreground shadow-none hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20";

interface MembersMenuSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    children: ReactNode;
}

export function MembersMenuSheet({
    open,
    onOpenChange,
    title,
    children,
}: MembersMenuSheetProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="gap-2"
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <SheetHandle />
                <DialogTitle className="sr-only">{title}</DialogTitle>
                <div className="flex flex-col gap-2">{children}</div>
            </DialogContent>
        </Dialog>
    );
}

export function MembersMenuSheetItem({
    className,
    ...props
}: ComponentProps<typeof Button>) {
    return (
        <Button
            variant="unstyled"
            className={cn(ITEM_CLASS, className)}
            {...props}
        />
    );
}

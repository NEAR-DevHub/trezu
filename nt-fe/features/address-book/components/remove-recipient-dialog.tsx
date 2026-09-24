"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    mobileInsetSheetClassName,
} from "@/components/modal";
import { cn } from "@/lib/utils";
import type { AddressBookEntry } from "../types";

interface RemoveRecipientDialogProps {
    entries: AddressBookEntry[];
    onConfirm: () => Promise<void>;
    onClose: () => void;
}

export function RemoveRecipientDialog({
    entries,
    onConfirm,
    onClose,
}: RemoveRecipientDialogProps) {
    const t = useTranslations("addressBook.removeDialog");
    const tCommon = useTranslations("common");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            await onConfirm();
        } finally {
            setIsSubmitting(false);
        }
    };

    const names = entries
        .map((entry) => entry.name.trim())
        .filter(Boolean)
        .join(", ");

    return (
        <Dialog
            open={entries.length > 0}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent
                className={cn(
                    mobileInsetSheetClassName,
                    "gap-4 max-sm:gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md!",
                )}
            >
                <DialogHeader className="mx-0 border-0 px-0 pb-0" />
                <div className="flex flex-col items-center gap-2 text-center">
                    <DialogTitle className="text-xl font-bold leading-[1.2] tracking-[-0.4px]">
                        {t("title", { count: entries.length })}
                    </DialogTitle>
                    <DialogDescription className="text-sm font-medium text-general-secondary-foreground">
                        {t.rich("body", {
                            names,
                            bold: (chunks) => (
                                <span className="font-semibold text-foreground break-all overflow-wrap-anywhere text-wrap">
                                    {chunks}
                                </span>
                            ),
                        })}
                    </DialogDescription>
                </div>
                <DialogFooter className="mx-0 px-0 pt-0">
                    <Button
                        type="button"
                        variant="destructive"
                        className="h-10 w-full rounded-2xl bg-general-error-foreground hover:bg-general-error-foreground/90 dark:bg-general-error-foreground"
                        loading={isSubmitting}
                        onClick={handleConfirm}
                    >
                        {isSubmitting ? tCommon("removing") : tCommon("remove")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/modal";
import { Button } from "@/components/button";
import type { AddressBookEntry } from "../types";

interface RemoveRecipientDialogProps {
    entry: AddressBookEntry | null;
    count?: number;
    onConfirm: () => Promise<void>;
    onClose: () => void;
}

export function RemoveRecipientDialog({
    entry,
    count,
    onConfirm,
    onClose,
}: RemoveRecipientDialogProps) {
    const t = useTranslations("addressBook.removeDialog");
    const tCommon = useTranslations("common");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isBulk = typeof count === "number" && entry === null && count > 0;
    const isOpen = isBulk ? count > 0 : entry !== null;

    async function handleConfirm() {
        setIsSubmitting(true);
        try {
            await onConfirm();
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md gap-4">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                </DialogHeader>
                <DialogDescription>
                    {isBulk
                        ? t.rich("bulk", {
                              count: count ?? 0,
                              bold: (chunks) => (
                                  <span className="font-semibold">
                                      {chunks}
                                  </span>
                              ),
                          })
                        : t.rich("single", {
                              name: entry?.name ?? "",
                              bold: (chunks) => (
                                  <span className="font-semibold">
                                      {chunks}
                                  </span>
                              ),
                          })}
                </DialogDescription>
                <DialogFooter>
                    <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={handleConfirm}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? tCommon("removing") : tCommon("remove")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

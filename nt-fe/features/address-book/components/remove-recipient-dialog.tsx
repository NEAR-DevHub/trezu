"use client";

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
                    <DialogTitle>Remove Recipient</DialogTitle>
                </DialogHeader>
                <DialogDescription>
                    {isBulk ? (
                        <>
                            This will remove{" "}
                            <span className="font-semibold">
                                {count} recipient{count > 1 ? "s" : ""}
                            </span>{" "}
                            from your address book. You can add them again
                            anytime.
                        </>
                    ) : (
                        <>
                            This will remove{" "}
                            <span className="font-semibold">{entry?.name}</span>{" "}
                            from your address book. You can add this recipient
                            again anytime.
                        </>
                    )}
                </DialogDescription>
                <DialogFooter>
                    <div className="flex gap-2 w-full">
                        <Button
                            variant="outline"
                            className="flex-1"
                            onClick={onClose}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            className="flex-1"
                            onClick={handleConfirm}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? "Removing..." : "Remove"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

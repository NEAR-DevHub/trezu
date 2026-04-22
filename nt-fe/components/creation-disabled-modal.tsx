"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { submitWhitelistRequest } from "@/lib/api";
import { useNear } from "@/stores/near-store";
import { Input } from "./input";

interface CreationDisabledModalProps {
    open: boolean;
    onClose: () => void;
}

export function CreationDisabledModal({
    open,
    onClose,
}: CreationDisabledModalProps) {
    const tL = useTranslations("landing");
    const tP = useTranslations("progressModal");
    const tI = useTranslations("proposals.insufficientBalance");
    const { accountId } = useNear();
    const [contact, setContact] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async () => {
        if (!contact.trim()) return;
        setIsSubmitting(true);
        try {
            await submitWhitelistRequest({
                contact: contact.trim(),
                accountId: accountId ?? undefined,
            });
            setSubmitted(true);
        } catch {
            toast.error(tL("waitlistSubmitFailed"));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOpenChange = (o: boolean) => {
        if (!o) {
            onClose();
            setContact("");
            setSubmitted(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-md!">
                <DialogHeader>
                    <DialogTitle>
                        {submitted
                            ? tL("waitlistSubmittedTitle")
                            : tL("waitlistTitle")}
                    </DialogTitle>
                </DialogHeader>
                {submitted ? (
                    <>
                        <p className="text-sm text-muted-foreground">
                            {tL("waitlistSubmittedDescription")}
                        </p>
                        <Button className="w-full mt-3" onClick={onClose}>
                            {tI("gotIt")}
                        </Button>
                    </>
                ) : (
                    <div className="flex flex-col gap-3">
                        <p className="text-sm text-muted-foreground">
                            {tL("waitlistDescription")}
                        </p>
                        <div className="flex flex-col gap-1">
                            <Input
                                type="text"
                                placeholder={tL("waitlistInputPlaceholder")}
                                value={contact}
                                onChange={(e) => setContact(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                {tL("waitlistPrivacyNote")}
                            </p>
                        </div>
                        <Button
                            className="w-full"
                            onClick={handleSubmit}
                            disabled={isSubmitting || !contact.trim()}
                        >
                            {isSubmitting && (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                            {tL("waitlistSubmit")}
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

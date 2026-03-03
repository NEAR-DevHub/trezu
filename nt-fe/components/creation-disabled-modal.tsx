"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
            toast.error("Failed to submit. Please try again.");
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
                            ? "You're on the list 🎉"
                            : "Join the Trezu Waitlist"}
                    </DialogTitle>
                </DialogHeader>
                {submitted ? (
                    <>
                        <p className="text-sm text-muted-foreground">
                            Thanks! We&apos;ll notify you as soon as treasury
                            creation becomes available.
                        </p>
                        <Button className="w-full mt-3" onClick={onClose}>
                            Got It
                        </Button>
                    </>
                ) : (
                    <div className="flex flex-col gap-3">
                        <p className="text-sm text-muted-foreground">
                            We&apos;ve hit today&apos;s treasury limit. No
                            worries - try again later or leave your contact to
                            join the waitlist. We&apos;ll let you know when a
                            spot opens.
                        </p>
                        <div className="flex flex-col gap-1">
                            <Input
                                type="text"
                                placeholder="Email address or Telegram (e.g. @username)"
                                value={contact}
                                onChange={(e) => setContact(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                We will only use this to notify you
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
                            Join the Waitlist
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

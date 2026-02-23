"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { Button } from "@/components/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useNear } from "@/stores/near-store";
import { Loader2 } from "lucide-react";
import Link from "next/link";

interface AcceptTermsModalProps {
    open: boolean;
}

export function AcceptTermsModal({ open }: AcceptTermsModalProps) {
    const [accepted, setAccepted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { acceptTerms } = useNear();

    const handleAccept = async () => {
        if (!accepted) return;

        setIsSubmitting(true);
        try {
            await acceptTerms();
        } catch (error) {
            console.error("Failed to accept terms:", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open}>
            <DialogContent
                className="sm:max-w-lg"
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                showCloseButton={false}
            >
                <DialogHeader closeButton={false}>
                    <DialogTitle>Accept Terms to Continue</DialogTitle>
                </DialogHeader>

                <DialogDescription asChild>
                    <div className="space-y-3 text-sm text-muted-foreground">
                        <ul className="space-y-4">
                            <li>
                                <p className="text-foreground mb-1">
                                    Your Privacy at Trezu
                                </p>
                                Trezu is a non-custodial interface. We
                                prioritize your privacy while ensuring the
                                platform stays secure and functional.
                            </li>
                            <li>
                                <p className="text-foreground mb-1">
                                    Minimal Data
                                </p>
                                We collect limited information, such as public
                                wallet addresses, IP addresses, and usage
                                analytics, to operate and improve the Interface.
                            </li>
                            <li>
                                <p className="text-foreground mb-1">
                                    No Custody
                                </p>
                                We never have access to your private keys,
                                recovery phrases, or digital assets.
                            </li>
                            <li>
                                <p className="text-foreground mb-1">
                                    Public Records
                                </p>
                                Remember that all blockchain transactions are
                                inherently public and are not controlled by us.
                            </li>
                            <li>
                                <p className="text-foreground mb-1">
                                    Your Responsibility
                                </p>
                                You are solely responsible for monitoring your
                                wallet activity and securing your credentials.
                            </li>
                            <li>
                                <p className="text-foreground mb-1">
                                    Future Updates
                                </p>
                                If you opt-in to future notifications (like
                                email or Telegram), we will only use that data
                                to keep you informed.
                            </li>
                        </ul>
                        <p className="text-foreground">
                            By connecting your wallet, you acknowledge that you
                            have read and agree to our{" "}
                            <Link
                                href="/terms"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary underline underline-offset-4 hover:text-primary/80"
                            >
                                Terms of Service
                            </Link>{" "}
                            and our{" "}
                            <Link
                                href="/privacy"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary underline underline-offset-4 hover:text-primary/80"
                            >
                                Privacy Policy
                            </Link>
                            .
                        </p>
                    </div>
                </DialogDescription>

                <div className="flex items-start gap-3">
                    <Checkbox
                        id="terms"
                        checked={accepted}
                        className="mt-0.5"
                        onCheckedChange={(checked) =>
                            setAccepted(checked === true)
                        }
                        disabled={isSubmitting}
                    />
                    <Label
                        htmlFor="terms"
                        className="text-sm text-foreground font-normal inline-block leading-relaxed cursor-pointer"
                    >
                        I have read and agree to the{" "}
                        <Link
                            href="/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-4 hover:text-primary/80"
                        >
                            Terms of Service
                        </Link>{" "}
                        and{" "}
                        <Link
                            href="/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-4 hover:text-primary/80"
                        >
                            Privacy Policy
                        </Link>
                    </Label>
                </div>

                <DialogFooter>
                    <Button
                        onClick={handleAccept}
                        disabled={!accepted || isSubmitting}
                        className="w-full"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Accepting...
                            </>
                        ) : (
                            "Continue"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

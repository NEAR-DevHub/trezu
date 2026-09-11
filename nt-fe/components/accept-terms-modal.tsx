"use client";

import { LoaderCircleIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    mobileInsetSheetClassName,
} from "@/components/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PRIVACY_POLICY_HREF, TERMS_OF_SERVICE_HREF } from "@/constants/config";
import { cn } from "@/lib/utils";
import { useNear } from "@/stores/near-store";

interface AcceptTermsModalProps {
    open: boolean;
    variant: "firstTime" | "returning";
}

export function AcceptTermsModal({ open, variant }: AcceptTermsModalProps) {
    const t = useTranslations("acceptTerms");
    const [accepted, setAccepted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { acceptTerms } = useNear();
    const isReturningUser = variant === "returning";

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
                className={cn(
                    mobileInsetSheetClassName,
                    "gap-4 max-sm:gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md!",
                )}
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
            >
                <DialogHeader
                    closeButton={false}
                    className="mx-0 border-0 px-0 pb-0"
                />
                <div className="flex flex-col items-center gap-2 text-center">
                    <DialogTitle className="text-xl font-bold leading-[1.2] tracking-[-0.4px]">
                        {isReturningUser
                            ? t("returningTitle")
                            : t("firstTimeTitle")}
                    </DialogTitle>
                    <DialogDescription asChild>
                        <div className="flex w-full items-start gap-3 text-left">
                            <Checkbox
                                id="terms"
                                checked={accepted}
                                className="mt-[5px]"
                                onCheckedChange={(checked) =>
                                    setAccepted(checked === true)
                                }
                                disabled={isSubmitting}
                            />
                            <Label
                                htmlFor="terms"
                                className="text-sm font-medium text-general-secondary-foreground inline-block leading-relaxed cursor-pointer"
                            >
                                {t.rich("agreement", {
                                    terms: (chunks) => (
                                        <Link
                                            href={TERMS_OF_SERVICE_HREF}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                                        >
                                            {chunks}
                                        </Link>
                                    ),
                                    privacy: (chunks) => (
                                        <Link
                                            href={PRIVACY_POLICY_HREF}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                                        >
                                            {chunks}
                                        </Link>
                                    ),
                                })}
                            </Label>
                        </div>
                    </DialogDescription>
                </div>
                <DialogFooter className="mx-0 px-0 pt-0">
                    <Button
                        onClick={handleAccept}
                        disabled={!accepted || isSubmitting}
                        className="h-10 w-full"
                    >
                        {isSubmitting ? (
                            <>
                                <Icon
                                    icon={LoaderCircleIcon}
                                    className="mr-2 animate-spin"
                                />
                                {t("accepting")}
                            </>
                        ) : (
                            t("agreeAndContinue")
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

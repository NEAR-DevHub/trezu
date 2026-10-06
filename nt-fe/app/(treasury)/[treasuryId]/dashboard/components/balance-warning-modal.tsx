"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
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
import {
    parseWarningCopy,
    renderWithLinks,
} from "@/components/warning-message";
import { useWarningMessage, useWarnings } from "@/hooks/use-warnings";
import { cn } from "@/lib/utils";

/**
 * Shows a one-time-per-session modal when balances are temporarily
 * unavailable (`data.balances` warning). Same inset sheet on small screens
 * and centered dialog on large screens. After dismissal the persistent
 * banner keeps the user informed.
 */
export function BalanceWarningModal() {
    const t = useTranslations("warnings");
    const { getWarning } = useWarnings();
    const warning = getWarning("data.balances");
    const message = useWarningMessage(warning, "data.balances");
    const [open, setOpen] = useState(false);

    const warningId = warning?.id ?? null;
    const { heading, body } = useMemo(
        () => parseWarningCopy(message),
        [message],
    );

    useEffect(() => {
        if (warningId == null) {
            setOpen(false);
            return;
        }
        if (typeof window === "undefined") return;
        const dismissed = sessionStorage.getItem(
            `balance-warning-dismissed-${warningId}`,
        );
        if (!dismissed) {
            setOpen(true);
        }
    }, [warningId]);

    if (!message) return null;

    const handleClose = () => {
        setOpen(false);
        if (typeof window !== "undefined" && warningId != null) {
            sessionStorage.setItem(
                `balance-warning-dismissed-${warningId}`,
                "1",
            );
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) handleClose();
            }}
        >
            <DialogContent
                className={cn(
                    "gap-4 max-sm:gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md!",
                    mobileInsetSheetClassName,
                )}
            >
                <DialogHeader className="mx-0 border-0 px-0 pb-0" />
                <div className="flex flex-col items-center gap-2 text-center">
                    <DialogTitle className="text-xl font-bold leading-[1.2] tracking-[-0.4px]">
                        {heading || body}
                    </DialogTitle>
                    {heading && body ? (
                        <DialogDescription className="text-sm font-medium text-general-secondary-foreground">
                            {renderWithLinks(body)}
                        </DialogDescription>
                    ) : null}
                </div>
                <DialogFooter className="mx-0 px-0 pt-0">
                    <Button
                        type="button"
                        className="h-10 w-full rounded-2xl focus-visible:border-transparent focus-visible:ring-0"
                        onClick={handleClose}
                        data-testid="balance-warning-dismiss"
                    >
                        {t("gotIt")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { SheetHandle } from "@/components/mobile-shell/sheet-handle";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
    mobileInsetSheetClassName,
} from "@/components/modal";
import {
    parseWarningCopy,
    renderWithLinks,
    warningIconClassName,
} from "@/components/warning-message";
import { useWarningMessage, useWarnings } from "@/hooks/use-warnings";
import { cn } from "@/lib/utils";

/** Copy for the app-wide warning, or an empty result when none is live. */
export function useAppWarningCopy() {
    const { getWarning } = useWarnings();
    const warning = getWarning("app");
    const message = useWarningMessage(warning, "app");
    return useMemo(() => parseWarningCopy(message), [message]);
}

/**
 * Small-screen trigger for the app-wide warning. Sits beside the profile
 * when that control is shown, and in the header's top-right when it is not.
 * Opens the warning text; large screens keep the sidebar banner instead.
 */
export function AppWarningMobileControl() {
    const t = useTranslations("warnings");
    const { heading, body } = useAppWarningCopy();
    const [open, setOpen] = useState(false);

    if (!heading && !body) {
        return null;
    }

    return (
        <>
            <Button
                type="button"
                variant="warning"
                size="icon"
                onClick={() => setOpen(true)}
                aria-label={heading || body}
                data-testid="app-warning-trigger"
            >
                <Icon icon={Alert02Icon} className={warningIconClassName} />
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent
                    className={cn(
                        "gap-4 max-sm:gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md!",
                        mobileInsetSheetClassName,
                    )}
                >
                    <div className="-mb-2 sm:hidden">
                        <SheetHandle />
                    </div>
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
                            className="h-10 w-full rounded-2xl"
                            onClick={() => setOpen(false)}
                            data-testid="app-warning-dismiss"
                        >
                            {t("gotIt")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

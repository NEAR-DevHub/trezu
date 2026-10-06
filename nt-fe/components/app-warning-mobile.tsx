"use client";

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
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
import {
    parseWarningCopy,
    renderWithLinks,
    warningIconClassName,
} from "@/components/warning-message";
import {
    useResolveWarningMessage,
    useWarnings,
    type WarningSeverity,
    warningMatchesQuery,
} from "@/hooks/use-warnings";
import { cn } from "@/lib/utils";

const APP_WARNING_SEVERITY_RANK: Record<WarningSeverity, number> = {
    low: 0,
    high: 1,
    critical: 2,
};

export interface AppWarningCopy {
    id: number;
    heading: string | null;
    body: string;
}

/** App-wide notices plus the balance notice, most severe first. */
export function useAppWarningCopies(): AppWarningCopy[] {
    const { warnings } = useWarnings();
    const resolveMessage = useResolveWarningMessage();

    return useMemo(() => {
        const seen = new Set<number>();
        return warnings
            .filter((warning) => {
                const matches =
                    warningMatchesQuery(warning, "app") ||
                    warningMatchesQuery(warning, "data.balances");
                if (!matches || seen.has(warning.id)) return false;
                seen.add(warning.id);
                return true;
            })
            .sort(
                (a, b) =>
                    APP_WARNING_SEVERITY_RANK[b.severity] -
                    APP_WARNING_SEVERITY_RANK[a.severity],
            )
            .map((warning) => ({
                id: warning.id,
                ...parseWarningCopy(
                    resolveMessage(warning, warning.slot ?? "app"),
                ),
            }))
            .filter((copy) => copy.heading || copy.body);
    }, [warnings, resolveMessage]);
}

/** First app-wide warning, for callers that only need to know one is live. */
export function useAppWarningCopy(): AppWarningCopy {
    const copies = useAppWarningCopies();
    return copies[0] ?? { id: 0, heading: null, body: "" };
}

const warningTitleClassName =
    "text-xl font-bold leading-[1.2] tracking-[-0.4px]";
const warningBodyClassName =
    "text-sm font-medium text-general-secondary-foreground";

/**
 * Small-screen trigger for app-wide warnings and the balance notice. Sits
 * beside the profile when that control is shown, and in the header's
 * top-right when it is not. Large screens keep the sidebar banners instead.
 */
export function AppWarningMobileControl() {
    const t = useTranslations("warnings");
    const copies = useAppWarningCopies();
    const [open, setOpen] = useState(false);

    if (copies.length === 0) {
        return null;
    }

    return (
        <>
            <Button
                type="button"
                variant="warning"
                size="icon"
                onClick={() => setOpen(true)}
                aria-label={copies[0]?.heading || copies[0]?.body}
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
                    <DialogHeader className="mx-0 border-0 px-0 pb-0" />
                    <div className="flex flex-col gap-4">
                        {copies.map((copy, index) => {
                            const title = copy.heading || copy.body;
                            const body =
                                copy.heading && copy.body
                                    ? renderWithLinks(copy.body)
                                    : null;
                            return (
                                <div
                                    key={copy.id}
                                    className="flex flex-col items-center gap-2 text-center"
                                >
                                    {index === 0 ? (
                                        <DialogTitle
                                            className={warningTitleClassName}
                                        >
                                            {title}
                                        </DialogTitle>
                                    ) : (
                                        <p className={warningTitleClassName}>
                                            {title}
                                        </p>
                                    )}
                                    {body ? (
                                        index === 0 ? (
                                            <DialogDescription
                                                className={warningBodyClassName}
                                            >
                                                {body}
                                            </DialogDescription>
                                        ) : (
                                            <p className={warningBodyClassName}>
                                                {body}
                                            </p>
                                        )
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                    <DialogFooter className="mx-0 px-0 pt-0">
                        <Button
                            type="button"
                            className="h-10 w-full rounded-2xl focus-visible:border-transparent focus-visible:ring-0"
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

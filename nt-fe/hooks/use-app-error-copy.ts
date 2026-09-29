import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { AppError, AppErrorAction } from "@/lib/app-error";

export interface AppErrorCopy {
    title: string;
    body: string;
    /** Label of the one action worth offering for this error, if any. */
    actionLabel?: string;
}

/** The user-facing copy for an error: the frontend owns it, keyed by code. */
export function useAppErrorCopy(): (
    error: AppError,
    action?: AppErrorAction,
) => AppErrorCopy {
    const t = useTranslations("errors");
    return useCallback(
        (error: AppError, action?: AppErrorAction) => {
            const title = t(`codes.${error.code}.title`);
            const actionLabel = action ? t(action.kind) : undefined;
            if (error.code === "TX_FAILED") {
                return {
                    title,
                    body: t(`reasons.${error.reason ?? "UNKNOWN"}`),
                    actionLabel,
                };
            }
            return {
                title,
                body: t(`codes.${error.code}.body`),
                actionLabel,
            };
        },
        [t],
    );
}

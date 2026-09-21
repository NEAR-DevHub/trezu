import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { AppError } from "@/lib/app-error";

export interface AppErrorCopy {
    title: string;
    body: string;
    /** "Error ID: TRZ-…", present when the backend tagged the request. */
    errorId?: string;
    /** Label of the one action worth offering for this error, if any. */
    actionLabel?: string;
}

/** The user-facing copy for an error: the frontend owns it, keyed by code. */
export function useAppErrorCopy(): (error: AppError) => AppErrorCopy {
    const t = useTranslations("errors");
    return useCallback(
        (error: AppError) => {
            const errorId = error.requestId
                ? t("errorId", { id: error.requestId })
                : undefined;
            const title = t(`codes.${error.code}.title`);
            if (error.code === "TX_FAILED") {
                const reason = t(`reasons.${error.reason ?? "UNKNOWN"}`);
                return {
                    title,
                    body: `${reason} ${t("feeCovered")}`,
                    errorId,
                    actionLabel: error.txHash ? t("viewOnExplorer") : undefined,
                };
            }
            return {
                title,
                body: t(`codes.${error.code}.body`),
                errorId,
                actionLabel:
                    error.code === "TX_STATUS_UNKNOWN"
                        ? t("viewRequests")
                        : undefined,
            };
        },
        [t],
    );
}

"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { type AppErrorCopy, useAppErrorCopy } from "@/hooks/use-app-error-copy";
import type { AppError, AppErrorAction } from "@/lib/app-error";

export interface NearStoreMessages {
    connectAndAcceptTerms: string;
    transactionNotApproved: string;
    viewRequest: string;
    proposalRemoved: string;
    voteSubmitted: string;
    votesSubmitted: string;
}

const fallback: NearStoreMessages = {
    connectAndAcceptTerms:
        "Please connect wallet and accept terms to continue.",
    transactionNotApproved: "Transaction wasn't approved in your wallet.",
    viewRequest: "View Request",
    proposalRemoved: "Your proposal has been removed",
    voteSubmitted: "Your vote has been submitted",
    votesSubmitted: "Your votes have been submitted",
};

let current: Readonly<NearStoreMessages> = Object.freeze(fallback);

let describeError: (error: AppError, action?: AppErrorAction) => AppErrorCopy =
    () => ({
        title: "Transaction failed",
        body: "",
    });

export function getAppErrorCopy(
    error: AppError,
    action?: AppErrorAction,
): AppErrorCopy {
    return describeError(error, action);
}

export function getNearStoreMessages(): Readonly<NearStoreMessages> {
    return current;
}

export function useSyncNearStoreMessages() {
    const t = useTranslations("nearStore");
    const getErrorCopy = useAppErrorCopy();
    useEffect(() => {
        describeError = getErrorCopy;
    }, [getErrorCopy]);
    useEffect(() => {
        current = Object.freeze({
            connectAndAcceptTerms: t("connectAndAcceptTerms"),
            transactionNotApproved: t("transactionNotApproved"),
            viewRequest: t("viewRequest"),
            proposalRemoved: t("proposalRemoved"),
            voteSubmitted: t("voteSubmitted"),
            votesSubmitted: t("votesSubmitted"),
        });
    }, [t]);
}

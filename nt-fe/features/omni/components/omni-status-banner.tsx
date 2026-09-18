"use client";

import { CircleAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/alert";
import { cn } from "@/lib/utils";
import type { NearNetwork, VerificationResult } from "../types";
import { CliHint } from "./cli-hint";

interface OmniStatusBannerProps {
    verification: VerificationResult;
    dao: string;
    proposalId: number;
    network: NearNetwork;
    /** Sidebar variant: shorter copy, no CLI block. */
    compact?: boolean;
    className?: string;
}

export function omniStatusClasses(
    status: VerificationResult["status"],
): string {
    switch (status) {
        case "verified":
            return "bg-general-success-background-faded text-general-success-foreground [&>svg]:text-general-success-foreground";
        case "mismatch":
            return "bg-red-600 text-white [&>svg]:text-white dark:bg-red-700 border-2 border-red-800";
        case "unverified":
            return "bg-general-warning-background-faded text-general-warning-foreground [&>svg]:text-general-warning-foreground";
    }
}

export function OmniStatusBanner({
    verification,
    dao,
    proposalId,
    network,
    compact = false,
    className,
}: OmniStatusBannerProps) {
    const t = useTranslations("proposals.omni");
    const { status, notPlainSignRequest } = verification;

    const Icon =
        status === "verified"
            ? ShieldCheck
            : status === "mismatch"
              ? TriangleAlert
              : CircleAlert;

    const failing = verification.checks.filter((c) => c.state === "fail");

    return (
        <Alert
            data-testid={`omni-status-${status}`}
            role={status === "mismatch" ? "alert" : "status"}
            className={cn(
                "w-full items-start",
                omniStatusClasses(status),
                className,
            )}
        >
            <Icon className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1 min-w-0 w-full">
                <AlertTitle className="font-bold tracking-wide">
                    {t(`status.${status}`)}
                </AlertTitle>
                {notPlainSignRequest && (
                    <p className="text-sm font-semibold">
                        {t("notPlainSignRequest")}
                    </p>
                )}
                <AlertDescription className="text-sm">
                    {status === "unverified" && verification.unverifiedReason
                        ? t(
                              `unverifiedReason.${verification.unverifiedReason}`,
                              {
                                  detail: verification.unverifiedDetail ?? "",
                              },
                          )
                        : t(`statusDescription.${status}`)}
                </AlertDescription>
                {status === "mismatch" && compact && failing[0] && (
                    <p className="text-sm break-all">
                        {t(
                            `checks.${failing[0].id}.fail`,
                            failing[0].detail ?? {},
                        )}
                    </p>
                )}
                {status === "mismatch" && !compact && failing.length > 0 && (
                    <ul className="text-sm list-disc pl-5 break-all">
                        {failing.map((check) => (
                            <li key={check.id}>
                                {t(
                                    `checks.${check.id}.fail`,
                                    check.detail ?? {},
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {status === "unverified" && !compact && (
                    <div className="mt-1 flex flex-col gap-1">
                        <span className="text-xs">{t("cli.verifyHint")}</span>
                        <CliHint
                            command={`omni proposal review ${dao} ${proposalId} network-config ${network}`}
                        />
                    </div>
                )}
            </div>
        </Alert>
    );
}

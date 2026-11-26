"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import QRCode from "react-qr-code";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { CopyButton } from "@/components/copy-button";
import Logo from "@/components/icons/logo";
import { Pill } from "@/components/pill";
import { NetworkIconDisplay } from "@/components/token-display";
import { Skeleton } from "@/components/ui/skeleton";
import { LANDING_PAGE } from "@/constants/config";
import { cn, formatUserDate } from "@/lib/utils";
import type { AsyncValue, TokenReceiptInfo } from "../utils/receipt-models";

/** The printed sheet: a flat white page, light even in dark mode. */
export const RECEIPT_CARD_CLASS =
    "force-light-theme bg-white text-foreground p-8 rounded-none print:bg-white print:shadow-none";

interface ReceiptPageShellProps {
    receiptUrl: string;
    showCopyLink: boolean;
    onPrint: () => void;
    children: React.ReactNode;
}

interface ReceiptLayoutProps {
    title: string;
    /** The "Receipt #… · … on <date>" line; requests read "Paid on". */
    headingKey?: "receiptTitle" | "receiveReceiptTitle";
    receiptNumber: string | number;
    receiptDate: AsyncValue<Date>;
    children: React.ReactNode;
}

interface ReceiptSectionTitleProps {
    children: React.ReactNode;
}

export function ReceiptSectionTitle({ children }: ReceiptSectionTitleProps) {
    return <p className="text-base font-semibold">{children}</p>;
}

interface ReceiptLabelValueRowProps {
    label: React.ReactNode;
    value: React.ReactNode;
    className?: string;
    labelClassName?: string;
    valueClassName?: string;
}

export function ReceiptLabelValueRow({
    label,
    value,
    className = "",
    labelClassName = "",
    valueClassName = "",
}: ReceiptLabelValueRowProps) {
    return (
        <div className={cn("flex items-start gap-6 text-sm", className)}>
            <p
                className={cn(
                    "w-60 shrink-0 text-muted-foreground text-sm",
                    labelClassName,
                )}
            >
                {label}
            </p>
            <div className={cn("flex-1 text-left font-medium", valueClassName)}>
                {value}
            </div>
        </div>
    );
}

export function ReceiptValueSkeleton({ width = "w-24" }: { width?: string }) {
    return <Skeleton className={cn("h-5", width)} />;
}

export function AsyncText({ value }: { value: AsyncValue<string> }) {
    const tCommon = useTranslations("common");

    if (value.isLoading || value.value == null) {
        if (!value.isLoading) {
            return tCommon("notAvailable");
        }
        return <ReceiptValueSkeleton width="w-24" />;
    }

    return value.value;
}

export function AsyncNetwork({
    metadata,
    width = "w-20",
}: {
    metadata: TokenReceiptInfo["metadata"];
    width?: string;
}) {
    const networkName = metadata.value?.network?.name;
    if (metadata.isLoading || !networkName) {
        return <ReceiptValueSkeleton width={width} />;
    }

    return (
        <div className="flex justify-start">
            <NetworkIconDisplay
                chainIcons={metadata.value?.network?.chainIcons ?? null}
                networkName={networkName}
                networkNameClassName="font-medium"
                expandNearComLabel
                className="gap-2"
            />
        </div>
    );
}

export function ReceiptPageShell({
    receiptUrl,
    showCopyLink,
    onPrint,
    children,
}: ReceiptPageShellProps) {
    const tReceipt = useTranslations("receiptPage");

    return (
        <div className="min-h-dvh bg-background print-color-exact print:bg-white">
            <header className="flex min-h-14 items-center justify-between border-b border-border bg-card px-4 md:px-6 print:hidden">
                <div className="flex items-center gap-3">
                    <Logo size="sm" />
                    <Pill
                        title={tReceipt("transactionConfirmation")}
                        variant="secondary"
                    />
                </div>
                <div className="flex items-center gap-2 print:hidden">
                    {showCopyLink && (
                        <CopyButton
                            text={receiptUrl}
                            variant="secondary"
                            iconClassName="size-4"
                        >
                            {tReceipt("copyLink")}
                        </CopyButton>
                    )}
                    <Button variant="default" onClick={onPrint}>
                        <FileText className="size-4" />
                        {tReceipt("printOrSavePdf")}
                    </Button>
                </div>
            </header>

            <main className="px-4 py-4 pb-8 print:bg-white print:px-0 print:py-0">
                <div className="mx-auto w-full max-w-[700px]">{children}</div>
            </main>
        </div>
    );
}

export function ReceiptLayout({
    title,
    headingKey = "receiptTitle",
    receiptNumber,
    receiptDate,
    children,
}: ReceiptLayoutProps) {
    const tReceipt = useTranslations("receiptPage");
    const tCommon = useTranslations("common");

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between border-b pb-4">
                <div>
                    <p className="text-xl font-medium">{title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {tReceipt("generatedOn", {
                            date: formatUserDate(new Date(), {
                                timezone: "UTC",
                                includeTime: false,
                            }),
                        })}
                    </p>
                </div>
                <Logo size="md" mode="light" />
            </div>
            <p className="text-xl font-medium">
                {tReceipt.rich(headingKey, {
                    proposalId: receiptNumber,
                    date: receiptDate.value
                        ? formatUserDate(receiptDate.value, {
                              timezone: "UTC",
                              includeTime: false,
                          })
                        : tCommon("notAvailable"),
                    datePart: (chunks) =>
                        receiptDate.isLoading ? (
                            <span className="inline-block align-middle">
                                <ReceiptValueSkeleton width="w-32" />
                            </span>
                        ) : (
                            chunks
                        ),
                })}
            </p>
            {children}
            <div className="flex items-center justify-between rounded-lg bg-secondary px-4 py-3">
                <div className="space-y-2">
                    <span className="inline-flex rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background">
                        Free to start
                    </span>
                    <div>
                        <p className="text-base font-medium">
                            {tReceipt("createYourTreasury")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {tReceipt("createYourTreasuryDescription")}
                        </p>
                    </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <a
                        href={LANDING_PAGE}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open Trezu landing page"
                    >
                        <QRCode size={66} value={LANDING_PAGE} />
                    </a>
                    <a
                        href={LANDING_PAGE}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[16px] font-medium underline"
                    >
                        trezu.org
                    </a>
                </div>
            </div>
        </div>
    );
}

function ReceiptPdfSkeletonLabelRow({
    className = "py-3",
    valueWidth = "w-36",
}: {
    className?: string;
    valueWidth?: string;
}) {
    return (
        <ReceiptLabelValueRow
            label={<Skeleton className="h-4 w-24" />}
            value={<Skeleton className={cn("h-4", valueWidth)} />}
            className={className}
        />
    );
}

export function ReceiptPdfSkeletonCard() {
    return (
        <PageCard className={RECEIPT_CARD_CLASS}>
            <div className="space-y-8">
                <div className="flex items-start justify-between border-b pb-4">
                    <div className="space-y-2">
                        <Skeleton className="h-7 w-64" />
                        <Skeleton className="h-4 w-40" />
                    </div>
                    <Skeleton className="h-8 w-24" />
                </div>

                <Skeleton className="h-7 w-80" />

                <section className="space-y-5">
                    <div>
                        <Skeleton className="h-6 w-20" />
                        <ReceiptLabelValueRow
                            label={<Skeleton className="h-4 w-16" />}
                            value={<Skeleton className="h-4 w-64" />}
                            className="mt-2 border-b pb-3 pt-3"
                            valueClassName="break-all"
                        />
                    </div>
                </section>

                <section className="space-y-3">
                    <Skeleton className="h-6 w-40" />
                    <div className="divide-y text-sm">
                        <ReceiptPdfSkeletonLabelRow valueWidth="w-20" />
                        <ReceiptPdfSkeletonLabelRow valueWidth="w-28" />
                        <ReceiptPdfSkeletonLabelRow valueWidth="w-32" />
                        <ReceiptPdfSkeletonLabelRow valueWidth="w-24" />
                        <ReceiptPdfSkeletonLabelRow valueWidth="w-48" />
                        <ReceiptPdfSkeletonLabelRow valueWidth="w-36" />
                    </div>
                </section>

                <div className="flex items-center justify-between rounded-lg bg-secondary px-4 py-3">
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-24 rounded-md" />
                        <Skeleton className="h-5 w-44" />
                        <Skeleton className="h-4 w-72" />
                    </div>
                    <div className="space-y-2">
                        <Skeleton className="size-[66px]" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                </div>
            </div>
        </PageCard>
    );
}

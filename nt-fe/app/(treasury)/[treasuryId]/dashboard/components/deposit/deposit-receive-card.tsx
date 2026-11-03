"use client";

import { Check, Copy, Info, Send, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { QrCode } from "@/components/qr-code";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDepositAddress } from "./deposit-format-address";
import { DepositOptionIcon } from "./deposit-option-icon";

const COPIED_RESET_MS = 2000;

/** Fixed card theme, independent of the app theme and viewport. */
export type DepositReceiveCardTone = "light" | "dark";

/**
 * `dark` applies the dark token block; `force-light-theme` pins the light
 * tokens under a dark app (see globals.css). Surfaces follow the Figma spec:
 * secondary for the card, tertiary + general border for the address box.
 */
function toneClasses(tone: DepositReceiveCardTone) {
    return cn(
        tone === "dark" ? "dark" : "force-light-theme",
        "bg-secondary text-secondary-foreground",
    );
}

const ADDRESS_BOX_CLASSES = "bg-general-tertiary border border-general-border";

export interface DepositReceiveCardProps {
    /** Public treasuries render light, confidential ones dark. */
    tone: DepositReceiveCardTone;
    title: ReactNode;
    subtitle: ReactNode;
    address: string;
    memo?: string | null;
    /** Label above the address, e.g. "NEAR address". */
    addressLabel: string;
    /** Plain text for `.near` names; hex addresses get their ends emphasised. */
    preferPlainAddress?: boolean;
    /** Logo drawn in the cleared centre of the QR code. */
    centerIcon?: { icon: string; name: string } | null;
    /** Accessible label for the QR code. */
    qrLabel?: string;
    onShare?: () => void;
    /** Info rows under the address box. */
    notices: { id: string; content: ReactNode }[];
    className?: string;
}

/**
 * Receive card: headline, QR with a logo in the middle, the address with
 * copy/share, and info rows. Its theme is fixed by `tone`, not the app theme.
 */
export function DepositReceiveCard({
    tone,
    title,
    subtitle,
    address,
    memo,
    addressLabel,
    preferPlainAddress = false,
    centerIcon,
    qrLabel,
    onShare,
    notices,
    className,
}: DepositReceiveCardProps) {
    const t = useTranslations("depositModal");

    return (
        <section
            className={cn(
                "rounded-2xl overflow-hidden",
                toneClasses(tone),
                className,
            )}
            data-testid="deposit-receive-card"
        >
            <div className="px-5 pt-5 text-center">
                <h3 className="font-semibold text-base leading-normal">
                    {title}
                </h3>
                <p className="text-base font-medium text-muted-foreground leading-normal">
                    {subtitle}
                </p>
            </div>

            <div className="flex justify-center px-5 pt-5 pb-4">
                <QrCode
                    value={address}
                    color="currentColor"
                    title={qrLabel}
                    className="size-[200px] text-foreground"
                >
                    {centerIcon ? (
                        <span className="flex size-[26%] items-center justify-center rounded-full bg-secondary p-[2px]">
                            <DepositOptionIcon
                                icon={centerIcon.icon}
                                name={centerIcon.name}
                                className="size-full text-sm"
                            />
                        </span>
                    ) : null}
                </QrCode>
            </div>

            <div
                className={cn(
                    "rounded-xl px-6 py-4 space-y-3",
                    ADDRESS_BOX_CLASSES,
                )}
            >
                <AddressField
                    label={addressLabel}
                    value={address}
                    display={formatDepositAddress(address, preferPlainAddress)}
                    copiedToast={t("addressCopied")}
                    onShare={onShare}
                    testId="deposit-receive-address"
                />
                {memo && (
                    <AddressField
                        label={t("memoLabel")}
                        value={memo}
                        display={memo}
                        copiedToast={t("memoCopied")}
                        testId="deposit-receive-memo"
                        className="border-t border-border pt-3"
                    />
                )}
            </div>

            {memo && (
                <div
                    className="mx-4 mt-3 flex gap-2 items-start text-sm bg-destructive/10 text-destructive rounded-lg p-3"
                    data-testid="deposit-receive-memo-warning"
                >
                    <TriangleAlert className="size-4 shrink-0 mt-0.5" />
                    <span>
                        {t.rich("memoWarning", {
                            bold: (chunks) => (
                                <span className="font-semibold">
                                    {chunks}
                                </span>
                            ),
                        })}
                    </span>
                </div>
            )}

            <div className="px-4 py-3 space-y-2">
                {notices.map((notice) => (
                    <div
                        key={notice.id}
                        className="flex gap-2 items-start text-sm text-muted-foreground"
                    >
                        <Info className="size-4 shrink-0 mt-0.5 fill-general-info-foreground text-card" />
                        <span>{notice.content}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

function AddressField({
    label,
    value,
    display,
    copiedToast,
    onShare,
    testId,
    className,
}: {
    label: string;
    value: string;
    display: ReactNode;
    copiedToast: string;
    onShare?: () => void;
    testId: string;
    className?: string;
}) {
    const t = useTranslations("depositModal");
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
        return () => clearTimeout(timer);
    }, [copied]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success(copiedToast);
        } catch {
            toast.error(t("errors.fetchFailed"));
        }
    };

    return (
        <div className={className}>
            <p className="text-sm text-muted-foreground font-medium leading-5">
                {label}
            </p>
            <div className="flex items-center gap-3 mt-1">
                <p
                    className="min-w-0 flex-1 font-mono break-all text-base leading-6 font-semibold"
                    data-testid={testId}
                >
                    {display}
                </p>
                <div className="flex shrink-0 gap-3">
                    <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        onClick={handleCopy}
                        aria-label={t("receive.copyAddress")}
                        className="rounded-lg"
                        data-testid={`${testId}-copy`}
                    >
                        {copied ? (
                            <Check className="size-4" />
                        ) : (
                            <Copy className="size-4" />
                        )}
                    </Button>
                    {onShare && (
                        <Button
                            type="button"
                            variant="secondary"
                            size="icon-sm"
                            onClick={onShare}
                            aria-label={t("receive.shareAddress")}
                            className="rounded-lg"
                            data-testid="deposit-share-button"
                        >
                            <Send className="size-4" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

export function DepositReceiveCardSkeleton({
    tone,
    className,
}: {
    tone: DepositReceiveCardTone;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "rounded-2xl overflow-hidden",
                toneClasses(tone),
                className,
            )}
            data-testid="deposit-address-skeleton"
        >
            <div className="flex flex-col items-center px-5 pt-5 gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex justify-center px-5 pt-5 pb-4">
                <Skeleton className="size-[200px] rounded-lg" />
            </div>
            <div
                className={cn(
                    "rounded-xl px-4 py-3 space-y-2",
                    ADDRESS_BOX_CLASSES,
                )}
            >
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="px-4 py-3 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
            </div>
        </div>
    );
}

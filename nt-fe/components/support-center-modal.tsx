"use client";

import { CustomerSupportIcon, File01Icon } from "@hugeicons/core-free-icons";
import Gleap from "gleap";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo } from "react";
import { Icon } from "@/components/icon";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    mobileInsetSheetClassName,
} from "@/components/modal";
import { APP_DOCS_URL, LANDING_PAGE } from "@/constants/config";
import { cn } from "@/lib/utils";
import { NearBusinessLogo } from "./icons/near-business-logo";

interface SupportItemProps {
    icon: ReactNode;
    title: string;
    description: string;
    href?: string;
    onClick?: () => void;
    closeModal?: () => void;
}

function SupportItem({
    icon,
    title,
    description,
    href,
    onClick,
    closeModal,
}: SupportItemProps) {
    const className =
        "flex w-full cursor-pointer items-center rounded-2xl px-1 text-left transition-colors hover:bg-general-secondary";
    const content = (
        <>
            <div className="flex h-16 items-center px-2">{icon}</div>
            <div className="flex h-16 min-w-0 flex-1 flex-col justify-center px-2">
                <span className="truncate text-base font-semibold leading-[1.2] text-general-foreground">
                    {title}
                </span>
                <span className="truncate text-sm font-medium leading-[1.5] text-general-secondary-foreground">
                    {description}
                </span>
            </div>
        </>
    );

    const link = href?.trim();
    if (link) {
        return (
            <Link
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
            >
                {content}
            </Link>
        );
    }

    if (onClick) {
        return (
            <button
                type="button"
                className={className}
                onClick={() => {
                    onClick();
                    closeModal?.();
                }}
            >
                {content}
            </button>
        );
    }

    return null;
}

function SupportGlyph({ children }: { children: ReactNode }) {
    return (
        <div className="flex size-6 shrink-0 items-center justify-center text-general-foreground">
            {children}
        </div>
    );
}

interface SupportCenterModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SupportCenterModal({
    open,
    onOpenChange,
}: SupportCenterModalProps) {
    const t = useTranslations("supportCenter");
    const items = useMemo<SupportItemProps[]>(
        () => [
            {
                icon: <NearBusinessLogo className="size-6" variant="mark" />,
                title: t("websiteTitle"),
                description: t("websiteDescription"),
                href: LANDING_PAGE,
            },
            {
                icon: (
                    <SupportGlyph>
                        <Icon icon={File01Icon} className="size-6" />
                    </SupportGlyph>
                ),
                title: t("docsTitle"),
                description: t("docsDescription"),
                href: APP_DOCS_URL,
            },
            {
                icon: (
                    <SupportGlyph>
                        <Icon icon={CustomerSupportIcon} className="size-6" />
                    </SupportGlyph>
                ),
                title: t("productSupportTitle"),
                description: t("productSupportDescription"),
                onClick: () => {
                    Gleap.open();
                },
            },
        ],
        [t],
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    mobileInsetSheetClassName,
                    "gap-3 bg-card sm:max-w-[448px]! sm:gap-3 sm:p-0",
                )}
            >
                <DialogHeader className="mx-0 border-b-0 px-0 pb-0 sm:px-5 sm:pt-4">
                    <DialogTitle className="text-left text-lg">
                        {t("title")}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col sm:px-3 sm:pb-4">
                    {items.map((item) => (
                        <SupportItem
                            key={item.title}
                            {...item}
                            closeModal={() => onOpenChange(false)}
                        />
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import {
    Delete01Icon,
    SentIcon,
    Wallet03Icon,
} from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import { FormattedDate } from "@/components/formatted-date";
import { Icon } from "@/components/icon";
import { SheetHandle } from "@/components/mobile-shell/sheet-handle";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    mobileInsetSheetClassName,
} from "@/components/modal";
import { NetworkList } from "@/components/network-list";
import { User } from "@/components/user";
import { formatShortAddress } from "@/lib/format-short-address";
import { cn } from "@/lib/utils";
import { useChains } from "../chains";
import type { AddressBookEntry } from "../types";
import { formatAddressBookDisplayAddress } from "../utils/find-entry";

const ACTION_CLASS =
    "h-10 min-w-0 w-auto flex-1 overflow-hidden rounded-2xl bg-general-bg-secondary px-5 text-base font-semibold text-general-secondary-foreground shadow-none hover:bg-general-bg-secondary/80";

const SECTION_LABEL_CLASS =
    "text-sm font-semibold leading-normal text-general-secondary-foreground";

function SheetSection({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-2.5">
            <p className={SECTION_LABEL_CLASS}>{label}</p>
            {children}
        </div>
    );
}

interface ContactActionSheetProps {
    entry: AddressBookEntry | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSend: () => void;
    onRemove: () => void;
}

export function ContactActionSheet({
    entry,
    open,
    onOpenChange,
    onSend,
    onRemove,
}: ContactActionSheetProps) {
    const t = useTranslations("addressBookTable");
    const tCommon = useTranslations("common");
    const { data: chains = [] } = useChains();

    if (!entry) return null;

    const displayAddress = formatAddressBookDisplayAddress(entry);
    const entryChains = chains.filter((chain) =>
        entry.networks.includes(chain.key),
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(mobileInsetSheetClassName, "gap-6")}
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <SheetHandle />
                <DialogTitle className="sr-only">{t("recipient")}</DialogTitle>
                <div className="flex flex-col gap-4">
                    <SheetSection label={t("recipient")}>
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-general-indigo-border bg-general-indigo-background-faded">
                                <Icon
                                    icon={Wallet03Icon}
                                    className="size-4 text-general-indigo-foreground"
                                />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-foreground">
                                    {entry.name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {formatShortAddress(displayAddress)}
                                </p>
                            </div>
                            <CopyButton
                                text={displayAddress}
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tCommon("copy")}
                                className="shrink-0 text-general-secondary-foreground"
                            />
                        </div>
                    </SheetSection>
                    {entryChains.length > 0 ? (
                        <SheetSection label={t("network")}>
                            <NetworkList
                                chains={entryChains}
                                maxVisible={entryChains.length}
                                badgeVariant="outline"
                                className="flex-wrap"
                            />
                        </SheetSection>
                    ) : null}
                    {entry.createdBy ? (
                        <SheetSection label={t("addedBy")}>
                            <User
                                accountId={entry.createdBy}
                                size="md"
                                withLink={false}
                                withHoverCard={false}
                                avatarClassName="size-9!"
                            />
                        </SheetSection>
                    ) : null}
                    {entry.note?.trim() ? (
                        <SheetSection label={t("note")}>
                            <p className="whitespace-pre-wrap wrap-break-word text-sm font-semibold leading-normal text-general-foreground">
                                {entry.note}
                            </p>
                        </SheetSection>
                    ) : null}
                    <SheetSection label={t("added")}>
                        <p className="truncate text-sm font-semibold leading-normal text-general-foreground">
                            <FormattedDate
                                date={entry.createdAt}
                                relative
                                withTooltip={false}
                                className="truncate"
                            />
                        </p>
                    </SheetSection>
                </div>
                <div className="mt-3 flex gap-3">
                    <Button
                        type="button"
                        variant="unstyled"
                        className={ACTION_CLASS}
                        onClick={onSend}
                    >
                        <Icon icon={SentIcon} />
                        {t("send")}
                    </Button>
                    <Button
                        type="button"
                        variant="unstyled"
                        className={ACTION_CLASS}
                        onClick={onRemove}
                    >
                        <Icon icon={Delete01Icon} />
                        {t("remove")}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

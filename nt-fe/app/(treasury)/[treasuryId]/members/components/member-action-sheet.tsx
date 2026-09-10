"use client";

import { Delete01Icon, SentIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AuthButton } from "@/components/auth-button";
import { CopyButton } from "@/components/copy-button";
import { Icon } from "@/components/icon";
import { SheetHandle } from "@/components/mobile-shell/sheet-handle";
import { Dialog, DialogContent, DialogTitle } from "@/components/modal";
import { FormattedDate } from "@/components/formatted-date";
import { Skeleton } from "@/components/ui/skeleton";
import { User } from "@/components/user";

interface Member {
    accountId: string;
    roles: string[];
}

const ACTION_CLASS =
    "h-10 flex-1 bg-general-bg-secondary px-5 text-base font-semibold text-general-secondary-foreground shadow-none hover:bg-general-bg-secondary/80";

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

interface MemberActionSheetProps {
    member: Member | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    addedAt?: number;
    addedAtLoading?: boolean;
    onSend: () => void;
    onRemove: () => void;
    removeDisabled?: boolean;
    removeTooltip?: string;
}

export function MemberActionSheet({
    member,
    open,
    onOpenChange,
    addedAt,
    addedAtLoading,
    onSend,
    onRemove,
    removeDisabled,
    removeTooltip,
}: MemberActionSheetProps) {
    const tMembers = useTranslations("members");
    const tCommon = useTranslations("common");

    if (!member) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="gap-6"
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <SheetHandle />
                <DialogTitle className="sr-only">
                    {tMembers("member")}
                </DialogTitle>
                <div className="flex flex-col gap-4">
                    <SheetSection label={tMembers("member")}>
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="min-w-0 flex-1">
                                <User
                                    accountId={member.accountId}
                                    size="md"
                                    withLink={false}
                                    withHoverCard={false}
                                    avatarClassName="rounded-lg"
                                />
                            </div>
                            <CopyButton
                                text={member.accountId}
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tCommon("copy")}
                                className="shrink-0 text-general-secondary-foreground"
                            />
                        </div>
                    </SheetSection>
                    {addedAt ? (
                        <SheetSection label={tMembers("added")}>
                            <p className="truncate text-sm font-semibold leading-normal text-general-foreground">
                                <FormattedDate
                                    date={addedAt}
                                    relative
                                    withTooltip={false}
                                    className="truncate"
                                />
                            </p>
                        </SheetSection>
                    ) : addedAtLoading ? (
                        <SheetSection label={tMembers("added")}>
                            <Skeleton className="h-5 w-28 bg-general-bg-secondary" />
                        </SheetSection>
                    ) : null}
                </div>
                <div className="flex gap-3 mt-3">
                    <AuthButton
                        permissionKind="transfer"
                        permissionAction="AddProposal"
                        variant="unstyled"
                        className={ACTION_CLASS}
                        onClick={onSend}
                    >
                        <Icon icon={SentIcon} />
                        {tMembers("send")}
                    </AuthButton>
                    <AuthButton
                        permissionKind="policy"
                        permissionAction="AddProposal"
                        balanceCheck={{ withProposalBond: true }}
                        variant="unstyled"
                        className={ACTION_CLASS}
                        onClick={onRemove}
                        disabled={removeDisabled}
                        tooltip={removeTooltip}
                        tooltipProps={{
                            disabled: !removeTooltip,
                            contentProps: { className: "max-w-[280px]" },
                        }}
                    >
                        <Icon icon={Delete01Icon} />
                        {tMembers("remove")}
                    </AuthButton>
                </div>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import { Delete01Icon, SentIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { AuthButton } from "@/components/auth-button";
import { CopyButton } from "@/components/copy-button";
import { Icon } from "@/components/icon";
import { SheetHandle } from "@/components/mobile-shell/sheet-handle";
import { Dialog, DialogContent, DialogTitle } from "@/components/modal";
import { User } from "@/components/user";

interface Member {
    accountId: string;
    roles: string[];
}

const ACTION_CLASS =
    "h-11 flex-1 rounded-2xl bg-general-bg-secondary px-5 text-base font-semibold text-general-secondary-foreground shadow-none hover:bg-general-bg-secondary/80";

interface MemberActionSheetProps {
    member: Member | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSend: () => void;
    onRemove: () => void;
    removeDisabled?: boolean;
    removeTooltip?: string;
}

export function MemberActionSheet({
    member,
    open,
    onOpenChange,
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
                className="gap-6 max-sm:gap-4"
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <SheetHandle />
                <DialogTitle className="sr-only">
                    {tMembers("member")}
                </DialogTitle>
                <div className="flex flex-col gap-2.5">
                    <p className="text-sm font-medium text-general-muted-foreground">
                        {tMembers("member")}
                    </p>
                    <div className="flex items-center gap-3">
                        <User
                            accountId={member.accountId}
                            size="md"
                            variant="avatar"
                            withLink={false}
                            avatarClassName="rounded-lg"
                        />
                        <div className="min-w-0 flex-1">
                            <User
                                accountId={member.accountId}
                                size="md"
                                variant="details"
                                withLink={false}
                                withHoverCard={false}
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
                </div>
                <div className="flex gap-3">
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

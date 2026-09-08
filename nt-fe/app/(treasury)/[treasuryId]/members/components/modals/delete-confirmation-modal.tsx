import { useTranslations } from "next-intl";
import { useState } from "react";
import { ButtonWithTooltip } from "@/components/button-with-tooltip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    mobileInsetSheetClassName,
} from "@/components/modal";
import { formatShortAddress } from "@/lib/format-short-address";
import { cn } from "@/lib/utils";
import { NEARN_IO_ACCOUNT } from "../../constants";

interface Member {
    accountId: string;
    roles: string[];
}

interface DeleteConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    member: Member | null;
    members?: Member[];
    onConfirm: () => Promise<void>;
    validationError?: string;
}

export function DeleteConfirmationModal({
    isOpen,
    onClose,
    member,
    members,
    onConfirm,
    validationError,
}: DeleteConfirmationModalProps) {
    const t = useTranslations("members.removeDialog");
    const tCommon = useTranslations("common");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            await onConfirm();
        } finally {
            setIsSubmitting(false);
        }
    };

    const membersToDelete =
        members && members.length > 0 ? members : member ? [member] : [];

    const isNearnAccountBeingDeleted = membersToDelete.some(
        (m) => m.accountId.toLowerCase() === NEARN_IO_ACCOUNT,
    );

    return (
        <Dialog
            open={isOpen && membersToDelete.length > 0}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent
                className={cn(
                    mobileInsetSheetClassName,
                    "gap-4 max-sm:gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md!",
                )}
            >
                <DialogHeader className="mx-0 border-0 px-0 pb-0" />
                <div className="flex flex-col items-center gap-2 text-center">
                    <DialogTitle className="text-xl font-bold leading-[1.2] tracking-[-0.4px]">
                        {t("title", { count: membersToDelete.length })}
                    </DialogTitle>
                    <DialogDescription className="text-sm font-medium text-general-secondary-foreground">
                        {isNearnAccountBeingDeleted
                            ? t("nearnBody", { account: NEARN_IO_ACCOUNT })
                            : t.rich("genericBody", {
                                  accounts: membersToDelete
                                      .map((m) =>
                                          formatShortAddress(m.accountId),
                                      )
                                      .join(", "),
                                  bold: (chunks) => (
                                      <span className="font-semibold text-foreground break-all overflow-wrap-anywhere text-wrap">
                                          {chunks}
                                      </span>
                                  ),
                              })}
                    </DialogDescription>
                </div>
                <DialogFooter className="mx-0 px-0 pt-0">
                    <ButtonWithTooltip
                        type="button"
                        onClick={handleConfirm}
                        variant="destructive"
                        size="xl"
                        className="w-full rounded-2xl bg-general-error-foreground hover:bg-general-error-foreground/90 dark:bg-general-error-foreground"
                        disabled={isSubmitting || !!validationError}
                        tooltipMessage={validationError}
                    >
                        {isSubmitting
                            ? t("creatingProposal")
                            : tCommon("remove")}
                    </ButtonWithTooltip>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

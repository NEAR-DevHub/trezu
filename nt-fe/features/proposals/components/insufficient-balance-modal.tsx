import { useTranslations } from "next-intl";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/modal";
import { Button } from "@/components/button";

interface InsufficientBalanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    requiredAmount: string;
    actionType: "vote" | "proposal";
}

export function InsufficientBalanceModal({
    isOpen,
    onClose,
    requiredAmount,
    actionType,
}: InsufficientBalanceModalProps) {
    const t = useTranslations("proposals.insufficientBalance");
    const bodyKey = actionType === "vote" ? "modalBodyVote" : "modalBodyProposal";

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("modalTitle")}</DialogTitle>
                </DialogHeader>
                <DialogDescription>
                    {t.rich(bodyKey, {
                        required: requiredAmount,
                        amount: (chunks) => <strong>{chunks}</strong>,
                    })}
                </DialogDescription>
                <DialogFooter>
                    <Button className="w-full" onClick={onClose}>
                        {t("gotIt")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

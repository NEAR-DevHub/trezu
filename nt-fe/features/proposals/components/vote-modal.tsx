import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/button";
import { InfoAlert } from "@/components/info-alert";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { useTreasury } from "@/hooks/use-treasury";
import type { Proposal } from "@/lib/proposals-api";
import { useNear } from "@/stores/near-store";

interface VoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    proposals: Proposal[];
    vote: "Approve" | "Reject" | "Remove";
    insufficientBalanceProposalIds?: number[];
}

export function VoteModal({
    isOpen,
    onClose,
    onSuccess,
    proposals,
    vote,
    insufficientBalanceProposalIds,
}: VoteModalProps) {
    const t = useTranslations("proposals.voteModal");
    const { treasuryId } = useTreasury();
    const { voteProposals } = useNear();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleVote = async () => {
        setIsSubmitting(true);
        const insufficientSet = new Set(insufficientBalanceProposalIds ?? []);
        const votableProposals = proposals.filter(
            (p) => !insufficientSet.has(p.id),
        );
        try {
            await voteProposals(
                treasuryId ?? "",
                votableProposals.map((proposal) => ({
                    proposalId: proposal.id,
                    vote: vote,
                    proposal: proposal,
                })),
            );
            onSuccess?.();
        } catch (error) {
            console.error(`Failed to ${vote.toLowerCase()} proposal:`, error);
        } finally {
            setIsSubmitting(false);
            onClose();
        }
    };

    const title =
        vote === "Remove" ? t("removeTitle") : t("confirmTitle");
    const action =
        vote === "Approve"
            ? t("actionApprove")
            : vote === "Reject"
              ? t("actionReject")
              : t("actionRemove");
    const isBulk = proposals.length > 1;
    const hasInsufficientBalance =
        vote === "Approve" &&
        insufficientBalanceProposalIds &&
        insufficientBalanceProposalIds.length > 0;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <DialogDescription>
                    {isBulk
                        ? t("bulkBody", { action })
                        : t("singleBody", { action })}
                </DialogDescription>
                {hasInsufficientBalance && (
                    <InfoAlert
                        message={
                            <span>
                                {t.rich("insufficientBalance", {
                                    ids: insufficientBalanceProposalIds!
                                        .map((id) => `#${id}`)
                                        .join(", "),
                                    highlight: (chunks) => (
                                        <span className="font-medium">
                                            {chunks}
                                        </span>
                                    ),
                                })}
                            </span>
                        }
                    />
                )}
                <DialogFooter>
                    <Button
                        className="w-full"
                        variant={vote === "Remove" ? "destructive" : "default"}
                        onClick={handleVote}
                        disabled={isSubmitting}
                    >
                        {vote === "Remove" ? t("remove") : t("confirm")}
                        {isSubmitting && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

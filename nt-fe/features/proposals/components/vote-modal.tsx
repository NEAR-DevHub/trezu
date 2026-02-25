import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/modal";
import { Button } from "@/components/button";
import { useNear } from "@/stores/near-store";
import { useTreasury } from "@/hooks/use-treasury";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { InfoAlert } from "@/components/info-alert";
import { Proposal } from "@/lib/proposals-api";

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

    const title = vote === "Remove" ? "Remove Request" : "Confirm Your Vote";
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
                        ? `You are about to ${vote.toLowerCase()} multiple requests. Once submitted, this decision cannot be changed.`
                        : `You are about to ${vote.toLowerCase()} this request. Once confirmed, this action cannot be undone.`}
                </DialogDescription>
                {hasInsufficientBalance && (
                    <InfoAlert
                        message={
                            <span>
                                Requests{" "}
                                <span className="font-medium">
                                    {insufficientBalanceProposalIds!
                                        .map((id) => `#${id}`)
                                        .join(", ")}
                                </span>{" "}
                                cannot be approved due to insufficient balance.
                                Your approval will only apply to the remaining
                                requests.
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
                        {vote === "Remove" ? "Remove" : "Confirm"}
                        {isSubmitting && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import { useEffect, useState } from "react";
import { PageCard } from "@/components/card";
import { StepperHeader } from "@/components/step-wizard";
import {
    ShieldCheck,
    Loader2,
    Check,
    AlertTriangle,
    ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTreasury } from "@/hooks/use-treasury";
import { getProposal } from "@/lib/proposals-api";
import { useNear } from "@/stores/near-store";

type TrackerPhase =
    | "signing_pending"
    | "signing_approving"
    | "signing_done"
    | "deposit_pending"
    | "deposit_approving"
    | "deposit_done"
    | "error";

interface ProposalTrackerProps {
    /** The signing proposal ID (deposit proposal is signingId + 1) */
    proposalId: number;
    onDone?: () => void;
}

/**
 * Tracks a confidential shield through two proposals:
 * 1. Signing proposal (v1.signer MPC sign) — backend auto-submits intent after approval
 * 2. Deposit proposal (ft_transfer_call to intents.near) — actually moves the tokens
 */
export function ProposalTracker({
    proposalId,
    onDone,
}: ProposalTrackerProps) {
    const { treasuryId } = useTreasury();
    const { voteProposals } = useNear();
    const [phase, setPhase] = useState<TrackerPhase>("signing_pending");
    const [error, setError] = useState<string | null>(null);
    const [signingProposal, setSigningProposal] = useState<any>(null);
    const [depositProposal, setDepositProposal] = useState<any>(null);

    const depositProposalId = proposalId + 1;

    // Fetch proposals on mount
    useEffect(() => {
        if (!treasuryId) return;
        getProposal(treasuryId, String(proposalId)).then((p) => {
            if (p) {
                setSigningProposal(p);
                if (p.status === "Approved") {
                    setPhase("deposit_pending");
                }
            }
        });
        getProposal(treasuryId, String(depositProposalId)).then((p) => {
            if (p) {
                setDepositProposal(p);
                if (p.status === "Approved") {
                    setPhase("deposit_done");
                }
            }
        });
    }, [treasuryId, proposalId, depositProposalId]);

    const handleApprove = async (
        id: number,
        proposal: any,
        nextPhase: TrackerPhase,
        approvingPhase: TrackerPhase,
    ) => {
        if (!treasuryId || !proposal) return;
        try {
            setPhase(approvingPhase);
            await voteProposals(treasuryId, [
                { proposalId: id, vote: "Approve", proposal },
            ]);
            setPhase(nextPhase);
        } catch (err: unknown) {
            setError(
                err instanceof Error ? err.message : "Failed to approve",
            );
            setPhase("error");
        }
    };

    // Poll for signing proposal approval
    useEffect(() => {
        if (phase !== "signing_pending" || !treasuryId) return;
        const interval = setInterval(async () => {
            try {
                const p = await getProposal(treasuryId, String(proposalId));
                if (!p) return;
                setSigningProposal(p);
                if (p.status === "Approved") {
                    clearInterval(interval);
                    setPhase("deposit_pending");
                    // Also fetch deposit proposal
                    const dp = await getProposal(treasuryId, String(depositProposalId));
                    if (dp) setDepositProposal(dp);
                }
                if (["Rejected", "Failed", "Expired"].includes(p.status)) {
                    clearInterval(interval);
                    setError(`Signing proposal ${p.status.toLowerCase()}`);
                    setPhase("error");
                }
            } catch { /* ignore */ }
        }, 5_000);
        return () => clearInterval(interval);
    }, [phase, treasuryId, proposalId, depositProposalId]);

    // Poll for deposit proposal approval
    useEffect(() => {
        if (phase !== "deposit_pending" || !treasuryId) return;
        const interval = setInterval(async () => {
            try {
                const p = await getProposal(treasuryId, String(depositProposalId));
                if (!p) return;
                setDepositProposal(p);
                if (p.status === "Approved") {
                    clearInterval(interval);
                    setPhase("deposit_done");
                }
                if (["Rejected", "Failed", "Expired"].includes(p.status)) {
                    clearInterval(interval);
                    setError(`Deposit proposal ${p.status.toLowerCase()}`);
                    setPhase("error");
                }
            } catch { /* ignore */ }
        }, 5_000);
        return () => clearInterval(interval);
    }, [phase, treasuryId, depositProposalId]);

    const signingDone = phase !== "signing_pending" && phase !== "signing_approving";
    const depositDone = phase === "deposit_done";

    return (
        <PageCard>
            <StepperHeader title="Shield Request Submitted" />

            <div className="flex flex-col gap-4">
                {/* Step 1: Signing proposal */}
                <PhaseRow
                    done={signingDone}
                    active={phase === "signing_pending" || phase === "signing_approving"}
                    label="Sign confidential intent"
                    sublabel={`Proposal #${proposalId}`}
                />

                {phase === "signing_pending" && signingProposal && (
                    <Button
                        onClick={() =>
                            handleApprove(
                                proposalId,
                                signingProposal,
                                "deposit_pending",
                                "signing_approving",
                            )
                        }
                        className="w-full"
                    >
                        Approve Signing
                    </Button>
                )}

                {phase === "signing_approving" && (
                    <Button disabled className="w-full">
                        <Loader2 className="size-4 animate-spin mr-2" />
                        Approving in wallet...
                    </Button>
                )}

                {/* Step 2: Deposit proposal */}
                <PhaseRow
                    done={depositDone}
                    active={phase === "deposit_pending" || phase === "deposit_approving"}
                    label="Deposit tokens to intents.near"
                    sublabel={signingDone ? `Proposal #${depositProposalId}` : undefined}
                />

                {phase === "deposit_pending" && depositProposal && (
                    <Button
                        onClick={() =>
                            handleApprove(
                                depositProposalId,
                                depositProposal,
                                "deposit_done",
                                "deposit_approving",
                            )
                        }
                        className="w-full"
                    >
                        Approve Deposit
                    </Button>
                )}

                {phase === "deposit_approving" && (
                    <Button disabled className="w-full">
                        <Loader2 className="size-4 animate-spin mr-2" />
                        Approving in wallet...
                    </Button>
                )}

                {phase === "deposit_done" && (
                    <div className="rounded-lg border bg-green-50 dark:bg-green-900/20 p-4 flex items-start gap-3">
                        <ShieldCheck className="size-5 text-green-600 mt-0.5" />
                        <span className="font-medium text-green-700 dark:text-green-400">
                            Confidential shield complete
                        </span>
                    </div>
                )}

                {phase === "error" && (
                    <div className="rounded-lg border bg-red-50 dark:bg-red-900/20 p-4 flex items-start gap-3">
                        <AlertTriangle className="size-5 text-red-600 mt-0.5" />
                        <div className="flex flex-col gap-1">
                            <span className="font-medium text-red-700 dark:text-red-400">
                                Error
                            </span>
                            <span className="text-sm text-muted-foreground">
                                {error}
                            </span>
                        </div>
                    </div>
                )}

                <div className="flex gap-2">
                    {(phase === "deposit_done" || phase === "error") && onDone && (
                        <Button
                            variant="outline"
                            onClick={onDone}
                            className="flex-1"
                        >
                            New Shield Request
                        </Button>
                    )}
                    {treasuryId && (
                        <Button
                            variant="ghost"
                            asChild
                            className="flex-1"
                        >
                            <a href={`/${treasuryId}/requests?proposal=${proposalId}`}>
                                View Proposals
                                <ExternalLink className="size-3 ml-1" />
                            </a>
                        </Button>
                    )}
                </div>
            </div>
        </PageCard>
    );
}

function PhaseRow({
    done,
    active,
    label,
    sublabel,
}: {
    done: boolean;
    active: boolean;
    label: string;
    sublabel?: string;
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="mt-0.5">
                {done ? (
                    <div className="size-5 rounded-full bg-green-600 flex items-center justify-center">
                        <Check className="size-3 text-white" />
                    </div>
                ) : active ? (
                    <Loader2 className="size-5 text-primary animate-spin" />
                ) : (
                    <div className="size-5 rounded-full border-2 border-muted-foreground/30" />
                )}
            </div>
            <div className="flex flex-col">
                <span
                    className={
                        done
                            ? "text-muted-foreground"
                            : active
                              ? "font-medium"
                              : "text-muted-foreground/50"
                    }
                >
                    {label}
                </span>
                {sublabel && (
                    <span className="text-sm text-muted-foreground">
                        {sublabel}
                    </span>
                )}
            </div>
        </div>
    );
}

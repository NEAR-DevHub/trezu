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

type TrackerPhase = "pending" | "approving" | "done" | "error";

interface ProposalTrackerProps {
    proposalId: number;
    onDone?: () => void;
}

/**
 * Tracks a confidential proposal (auth or shield signing).
 *
 * After approval, the backend automatically extracts the MPC signature
 * and submits the signed intent or authenticates the DAO.
 */
export function ProposalTracker({ proposalId, onDone }: ProposalTrackerProps) {
    const { treasuryId } = useTreasury();
    const { voteProposals } = useNear();
    const [phase, setPhase] = useState<TrackerPhase>("pending");
    const [error, setError] = useState<string | null>(null);
    const [proposal, setProposal] = useState<any>(null);

    // Fetch proposal on mount
    useEffect(() => {
        if (!treasuryId) return;
        getProposal(treasuryId, String(proposalId)).then((p) => {
            if (p) {
                setProposal(p);
                if (p.status === "Approved") {
                    setPhase("done");
                }
            }
        });
    }, [treasuryId, proposalId]);

    const handleApprove = async () => {
        if (!treasuryId || !proposal) return;
        try {
            setPhase("approving");
            await voteProposals(treasuryId, [
                { proposalId, vote: "Approve", proposal },
            ]);
            setPhase("done");
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to approve");
            setPhase("error");
        }
    };

    // Poll for proposal approval (in case someone else approves)
    useEffect(() => {
        if (phase !== "pending" || !treasuryId) return;
        const interval = setInterval(async () => {
            try {
                const p = await getProposal(treasuryId, String(proposalId));
                if (!p) return;
                setProposal(p);
                if (p.status === "Approved") {
                    clearInterval(interval);
                    setPhase("done");
                }
                if (["Rejected", "Failed", "Expired"].includes(p.status)) {
                    clearInterval(interval);
                    setError(`Proposal ${p.status.toLowerCase()}`);
                    setPhase("error");
                }
            } catch {
                /* ignore */
            }
        }, 5_000);
        return () => clearInterval(interval);
    }, [phase, treasuryId, proposalId]);

    return (
        <PageCard>
            <StepperHeader title="Proposal Submitted" />

            <div className="flex flex-col gap-4">
                <PhaseRow
                    done={phase === "done"}
                    active={phase === "pending" || phase === "approving"}
                    label="Awaiting approval"
                    sublabel={`Proposal #${proposalId}`}
                />

                {phase === "pending" && proposal && (
                    <Button onClick={handleApprove} className="w-full">
                        Approve
                    </Button>
                )}

                {phase === "approving" && (
                    <Button disabled className="w-full">
                        <Loader2 className="size-4 animate-spin mr-2" />
                        Approving in wallet...
                    </Button>
                )}

                {phase === "done" && (
                    <div className="rounded-lg border bg-green-50 dark:bg-green-900/20 p-4 flex items-start gap-3">
                        <ShieldCheck className="size-5 text-green-600 mt-0.5" />
                        <span className="font-medium text-green-700 dark:text-green-400">
                            Request complete
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
                    {(phase === "done" || phase === "error") && onDone && (
                        <Button
                            variant="outline"
                            onClick={onDone}
                            className="flex-1"
                        >
                            New Shield Request
                        </Button>
                    )}
                    {treasuryId && (
                        <Button variant="ghost" asChild className="flex-1">
                            <a
                                href={`/${treasuryId}/requests?proposal=${proposalId}`}
                            >
                                View Proposal
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

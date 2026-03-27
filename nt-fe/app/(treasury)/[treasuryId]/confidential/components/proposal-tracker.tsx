"use client";

import { useEffect, useState, useCallback } from "react";
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
import { submitIntent, GenerateIntentResponse } from "@/lib/api";
import { useTreasury } from "@/hooks/use-treasury";
import { getProposal, getProposalTransaction } from "@/lib/proposals-api";
import { useTreasuryPolicy } from "@/hooks/use-treasury-queries";
import {
    extractSignatureFromTx,
    formatSignature,
    MPC_PUBLIC_KEY,
} from "../utils/extract-signature";

type TrackerPhase =
    | "pending"
    | "approved"
    | "extracting"
    | "submitting"
    | "done"
    | "error";

interface ProposalTrackerProps {
    proposalId: number;
    intentResponse: GenerateIntentResponse;
    onDone?: () => void;
}

export function ProposalTracker({
    proposalId,
    intentResponse,
    onDone,
}: ProposalTrackerProps) {
    const { treasuryId } = useTreasury();
    const { data: policy } = useTreasuryPolicy(treasuryId);
    const [phase, setPhase] = useState<TrackerPhase>("pending");
    const [error, setError] = useState<string | null>(null);
    const [intentHash, setIntentHash] = useState<string | null>(null);

    const handlePostApproval = useCallback(async () => {
        if (!treasuryId || !policy) return;

        const proposalIdStr = String(proposalId);

        try {
            setPhase("extracting");

            // Get the execution transaction
            const proposal = await getProposal(treasuryId, proposalIdStr);
            if (!proposal) {
                throw new Error("Could not find proposal");
            }

            const txData = await getProposalTransaction(
                treasuryId,
                proposal,
                policy,
            );

            if (!txData?.transaction_hash) {
                throw new Error("Could not find execution transaction");
            }

            // Extract MPC signature from the transaction receipts
            const sigBytes = await extractSignatureFromTx(
                txData.transaction_hash,
                treasuryId,
            );

            if (!sigBytes) {
                throw new Error(
                    "Could not extract MPC signature from transaction",
                );
            }

            const signature = formatSignature(sigBytes);

            // Submit the signed intent
            setPhase("submitting");
            const result = await submitIntent({
                type: "swap_transfer",
                signedData: {
                    standard: "nep413",
                    payload: intentResponse.intent.payload,
                    public_key: MPC_PUBLIC_KEY,
                    signature,
                },
            });

            setIntentHash(result.intentHash);
            setPhase("done");
        } catch (err: unknown) {
            setError(
                err instanceof Error ? err.message : "Unknown error",
            );
            setPhase("error");
        }
    }, [treasuryId, policy, proposalId, intentResponse]);

    // Poll for proposal approval
    useEffect(() => {
        if (phase !== "pending" || !treasuryId) return;

        const interval = setInterval(async () => {
            try {
                const proposal = await getProposal(treasuryId, String(proposalId));
                if (!proposal) return;
                if (proposal.status === "Approved") {
                    clearInterval(interval);
                    setPhase("approved");
                }
                if (
                    proposal.status === "Rejected" ||
                    proposal.status === "Failed" ||
                    proposal.status === "Expired"
                ) {
                    clearInterval(interval);
                    setError(`Proposal ${proposal.status.toLowerCase()}`);
                    setPhase("error");
                }
            } catch {
                // Ignore polling errors
            }
        }, 5_000);

        return () => clearInterval(interval);
    }, [phase, treasuryId, proposalId]);

    // Trigger post-approval flow
    useEffect(() => {
        if (phase === "approved") {
            handlePostApproval();
        }
    }, [phase, handlePostApproval]);

    return (
        <PageCard>
            <StepperHeader title="Shield Request Submitted" />

            <div className="flex flex-col gap-4">
                <PhaseRow
                    done={phase !== "pending"}
                    active={phase === "pending"}
                    label="Proposal submitted to DAO"
                />
                <PhaseRow
                    done={
                        phase === "extracting" ||
                        phase === "submitting" ||
                        phase === "done"
                    }
                    active={phase === "pending"}
                    label="Waiting for DAO approval"
                    sublabel={
                        phase === "pending"
                            ? `Proposal #${proposalId} — council members need to approve`
                            : undefined
                    }
                />
                <PhaseRow
                    done={phase === "submitting" || phase === "done"}
                    active={phase === "extracting"}
                    label="Extracting MPC signature"
                />
                <PhaseRow
                    done={phase === "done"}
                    active={phase === "submitting"}
                    label="Submitting signed intent"
                />

                {phase === "done" && (
                    <div className="rounded-lg border bg-green-50 dark:bg-green-900/20 p-4 flex items-start gap-3">
                        <ShieldCheck className="size-5 text-green-600 mt-0.5" />
                        <div className="flex flex-col gap-1">
                            <span className="font-medium text-green-700 dark:text-green-400">
                                Intent submitted successfully
                            </span>
                            {intentHash && (
                                <span className="text-sm text-muted-foreground font-mono">
                                    {intentHash}
                                </span>
                            )}
                        </div>
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
                        <Button
                            variant="ghost"
                            asChild
                            className="flex-1"
                        >
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

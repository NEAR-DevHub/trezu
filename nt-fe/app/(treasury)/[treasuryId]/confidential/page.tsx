"use client";

import { PageCard } from "@/components/card";
import { TokenInput, tokenSchema } from "@/components/token-input";
import { PageComponentLayout } from "@/components/page-component-layout";
import { useForm, useFormContext } from "react-hook-form";
import { Form } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
    ReviewStep,
    StepperHeader,
    StepProps,
    StepWizard,
} from "@/components/step-wizard";
import { useTreasuryPolicy } from "@/hooks/use-treasury-queries";
import { useEffect, useState } from "react";
import { useTreasury } from "@/hooks/use-treasury";
import { useNear } from "@/stores/near-store";
import { useThemeStore } from "@/stores/theme-store";
import { cn, formatBalance } from "@/lib/utils";
import { CreateRequestButton } from "@/components/create-request-button";
import { Loader2, Shield, ShieldCheck } from "lucide-react";
import {
    IntentsQuoteResponse,
    GenerateIntentResponse,
    getConfidentialBalances,
    prepareConfidentialAuth,
} from "@/lib/api";
import { PendingButton } from "@/components/pending-button";
import { Skeleton } from "@/components/ui/skeleton";
import { WarningAlert } from "@/components/warning-alert";
import { InfoDisplay } from "@/components/info-display";
import { CopyButton } from "@/components/copy-button";
import {
    DRY_QUOTE_REFRESH_INTERVAL,
    PROPOSAL_REFRESH_INTERVAL,
} from "./constants";
import {
    useConfidentialQuote,
    ConfidentialQuoteData,
} from "./hooks/use-confidential-quote";
import { buildConfidentialProposal } from "./utils/proposal-builder";
import { ProposalTracker } from "./components/proposal-tracker";
import { getLastProposalId } from "@/lib/proposals-api";

const WNEAR_TOKEN = {
    address: "intents.near:nep141:wrap.near",
    symbol: "wNEAR",
    name: "Wrapped NEAR",
    icon: "",
    decimals: 24,
    network: "NEAR",
    residency: "Ft",
};

const confidentialFormSchema = z.object({
    amount: z
        .string()
        .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
            message: "Amount must be greater than 0",
        }),
    token: tokenSchema,
    receiveAmount: z.string().optional(),
    slippageTolerance: z.number().optional(),
});

type ConfidentialFormValues = z.infer<typeof confidentialFormSchema>;

interface ConfidentialToken {
    available: string;
    source: string;
    tokenId: string;
}

function ConfidentialBalance({
    onAuthProposal,
}: {
    onAuthProposal?: (proposalId: number) => void;
}) {
    const { treasuryId } = useTreasury();
    const { createProposal } = useNear();
    const { data: policy } = useTreasuryPolicy(treasuryId);
    const [balances, setBalances] = useState<ConfidentialToken[] | null>(
        null,
    );
    const [needsAuth, setNeedsAuth] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState(false);

    useEffect(() => {
        if (!treasuryId) return;
        getConfidentialBalances(treasuryId)
            .then((resp: any) => {
                setBalances(resp.balances || []);
                setNeedsAuth(false);
            })
            .catch((err) => {
                setBalances(null);
                const status = err?.response?.status;
                if (status === 401 || status === 502 || status === 403) {
                    setNeedsAuth(true);
                }
            });
    }, [treasuryId]);

    const handleAuthenticate = async () => {
        if (!treasuryId) return;
        setIsAuthenticating(true);
        try {
            const { proposal } = await prepareConfidentialAuth(treasuryId);
            const proposalBond = policy?.proposal_bond || "0";

            const prevCount = await getLastProposalId(treasuryId);

            await createProposal("Confidential auth request submitted", {
                treasuryId,
                proposal,
                proposalBond,
                proposalType: "confidential_transfer",
            });

            onAuthProposal?.(prevCount);
        } catch (err) {
            console.error("Auth proposal error", err);
            setIsAuthenticating(false);
        }
    };

    if (needsAuth) {
        return (
            <div className="rounded-lg border bg-muted/50 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Shield className="size-4 text-primary" />
                    Confidential Account
                </div>
                <p className="text-sm text-muted-foreground">
                    Authenticate your DAO to view confidential balances.
                    This creates a signing proposal via v1.signer.
                </p>
                <button
                    onClick={handleAuthenticate}
                    disabled={isAuthenticating}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                    {isAuthenticating ? (
                        <>
                            <Loader2 className="size-4 animate-spin mr-2" />
                            Authenticating...
                        </>
                    ) : (
                        "Authenticate DAO"
                    )}
                </button>
            </div>
        );
    }

    if (!balances || balances.length === 0) return null;

    return (
        <div className="rounded-lg border bg-muted/50 p-3 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4 text-primary" />
                Confidential Balance
            </div>
            {balances.map((b) => (
                <div
                    key={b.tokenId}
                    className="flex justify-between text-sm text-muted-foreground"
                >
                    <span>{b.tokenId.replace("nep141:", "")}</span>
                    <span className="font-mono">
                        {formatBalance(b.available, 24)}
                    </span>
                </div>
            ))}
        </div>
    );
}

function Step1({ handleNext }: StepProps) {
    const form = useFormContext<ConfidentialFormValues>();
    const { treasuryId: selectedTreasury } = useTreasury();
    const token = form.watch("token");
    const amount = form.watch("amount");
    const slippageTolerance = form.watch("slippageTolerance") || 1;

    const [debouncedAmount, setDebouncedAmount] = useState(amount);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedAmount(amount), 500);
        return () => clearTimeout(timer);
    }, [amount]);

    useEffect(() => {
        form.setValue("receiveAmount", "");
        form.clearErrors("receiveAmount");
    }, [token.address, amount, form]);

    const hasValidAmount =
        debouncedAmount &&
        !isNaN(Number(debouncedAmount)) &&
        Number(debouncedAmount) > 0;

    const { data: quoteData, isLoading: isLoadingQuote } =
        useConfidentialQuote({
            selectedTreasury,
            token,
            amount: debouncedAmount,
            slippageTolerance,
            form,
            enabled: Boolean(selectedTreasury && hasValidAmount),
            isDryRun: true,
            refetchInterval: DRY_QUOTE_REFRESH_INTERVAL,
        });

    const handleContinue = () => {
        form.trigger().then((isValid) => {
            if (isValid && handleNext && quoteData) {
                handleNext();
            }
        });
    };

    return (
        <PageCard className="relative">
            <div className="flex items-center justify-between gap-2">
                <StepperHeader title="Shield to Confidential" />
                <PendingButton
                    id="confidential-pending-btn"
                    types={["Function Call"]}
                />
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Shield className="size-4" />
                <span>
                    Move tokens from your public treasury to your confidential
                    account
                </span>
            </div>

            <TokenInput
                title="Shield"
                control={form.control}
                amountName="amount"
                tokenName="token"
                showInsufficientBalance={false}
                dynamicFontSize={true}
            />

            {isLoadingQuote && hasValidAmount && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Getting confidential quote...</span>
                </div>
            )}

            {quoteData?.quote && (
                <div className="flex flex-col gap-2 text-sm">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                            You will receive (confidential)
                        </span>
                        <span className="font-medium">
                            {quoteData.quote.quote.amountOutFormatted}{" "}
                            {token.symbol}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                            Estimated Time
                        </span>
                        <span className="font-medium">
                            {quoteData.quote.quote.timeEstimate} seconds
                        </span>
                    </div>
                </div>
            )}

            <div className="rounded-lg border bg-card p-0 overflow-hidden">
                <CreateRequestButton
                    onClick={handleContinue}
                    className="w-full h-10 rounded-none"
                    permissions={[{ kind: "call", action: "AddProposal" }]}
                    disabled={!hasValidAmount || !quoteData?.quote}
                    idleMessage={
                        !hasValidAmount
                            ? "Enter an amount to shield"
                            : !quoteData?.quote
                                ? "Loading quote..."
                                : "Review Shield Request"
                    }
                />
            </div>

            <div className="flex justify-center items-center gap-2 text-sm text-muted-foreground">
                <span>Powered by</span>
                <span className="font-semibold flex items-center gap-1">
                    <ShieldCheck className="size-3" />
                    Private Intents
                </span>
            </div>

            <ConfidentialBalance />
        </PageCard>
    );
}

function Step2({ handleBack }: StepProps) {
    const form = useFormContext<ConfidentialFormValues>();
    const { treasuryId: selectedTreasury } = useTreasury();
    const token = form.watch("token");
    const amount = form.watch("amount");
    const slippageTolerance = form.watch("slippageTolerance") || 1;

    const { data: liveQuoteData, isLoading: isLoadingLiveQuote } =
        useConfidentialQuote({
            selectedTreasury,
            token,
            amount,
            slippageTolerance,
            form,
            enabled: Boolean(selectedTreasury && amount),
            isDryRun: false,
            refetchInterval: PROPOSAL_REFRESH_INTERVAL,
        });

    return (
        <PageCard>
            <ReviewStep
                reviewingTitle="Review Confidential Shield"
                handleBack={handleBack}
            >
                {isLoadingLiveQuote ? (
                    <div className="flex flex-col gap-3">
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-6 w-full" />
                        <Skeleton className="h-6 w-full" />
                    </div>
                ) : liveQuoteData?.quote ? (
                    <>
                        {/* Shield summary */}
                        <div className="rounded-lg border bg-muted p-4 flex flex-col items-center gap-3">
                            <Shield className="size-8 text-primary" />
                            <div className="text-center">
                                <div className="text-2xl font-bold">
                                    {liveQuoteData.quote.quote
                                        .amountInFormatted}{" "}
                                    {token.symbol}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    ≈ $
                                    {liveQuoteData.quote.quote.amountInUsd}
                                </div>
                            </div>
                            <div className="text-sm text-muted-foreground">
                                Public → Confidential
                            </div>
                        </div>

                        {/* Details */}
                        <InfoDisplay
                            className="gap-0"
                            hideSeparator
                            size="sm"
                            items={[
                                {
                                    label: "Operation",
                                    value: "Shield (Public → Confidential)",
                                },
                                {
                                    label: "Estimated Time",
                                    value: `${liveQuoteData.quote.quote.timeEstimate} seconds`,
                                },
                                {
                                    label: "Minimum Received",
                                    value: `${formatBalance(
                                        liveQuoteData.quote.quote.minAmountOut,
                                        token.decimals,
                                    )} ${token.symbol}`,
                                    info: "Minimum amount after slippage tolerance",
                                },
                                {
                                    label: "Deposit Address",
                                    value: (
                                        <div className="flex items-center gap-2">
                                            {`${liveQuoteData.quote.quote.depositAddress.slice(0, 8)}....${liveQuoteData.quote.quote.depositAddress.slice(-6)}`}
                                            <CopyButton
                                                text={
                                                    liveQuoteData.quote.quote
                                                        .depositAddress
                                                }
                                                toastMessage="Deposit address copied"
                                                variant="unstyled"
                                                size="icon"
                                                className="h-6 w-6 p-0!"
                                                iconClassName="h-3 w-3"
                                            />
                                        </div>
                                    ),
                                },
                                {
                                    label: "Signing",
                                    value: "v1.signer (MPC chain-signatures)",
                                    info: "The DAO proposal will request an MPC signature over the intent hash. The actual intent contents are not revealed on-chain.",
                                },
                            ]}
                        />
                    </>
                ) : null}

                <WarningAlert message="This proposal will sign a confidential intent. The transfer details are not visible on-chain. Please approve within 24 hours." />

                <></>
            </ReviewStep>

            <div className="rounded-lg border bg-card p-0 overflow-hidden">
                <CreateRequestButton
                    isSubmitting={form.formState.isSubmitting}
                    type="submit"
                    className="w-full h-10 rounded-none"
                    permissions={[{ kind: "call", action: "AddProposal" }]}
                    idleMessage="Confirm and Submit Request"
                    disabled={isLoadingLiveQuote || !liveQuoteData?.intent}
                />
            </div>
        </PageCard>
    );
}

interface SubmittedProposal {
    proposalId: number;
}

export default function ConfidentialPage() {
    const { treasuryId: selectedTreasury } = useTreasury();
    const { createProposal } = useNear();
    const { data: policy } = useTreasuryPolicy(selectedTreasury);
    const [step, setStep] = useState(0);
    const [submittedProposal, setSubmittedProposal] =
        useState<SubmittedProposal | null>(null);
    const [authState, setAuthState] = useState<
        "loading" | "needs_auth" | "authenticated" | "auth_pending"
    >("loading");
    const [authProposalId, setAuthProposalId] = useState<number | null>(null);

    // Check if the DAO is authenticated with the 1Click API
    useEffect(() => {
        if (!selectedTreasury) return;
        getConfidentialBalances(selectedTreasury)
            .then(() => setAuthState("authenticated"))
            .catch((err) => {
                const status = err?.response?.status;
                if (status === 401 || status === 502 || status === 403) {
                    setAuthState("needs_auth");
                } else {
                    setAuthState("needs_auth");
                }
            });
    }, [selectedTreasury]);

    const handleAuthProposal = (proposalId: number) => {
        setAuthProposalId(proposalId);
        setAuthState("auth_pending");
    };

    const form = useForm<ConfidentialFormValues>({
        resolver: zodResolver(confidentialFormSchema),
        defaultValues: {
            amount: "",
            token: WNEAR_TOKEN,
            receiveAmount: "0",
            slippageTolerance: 1,
        },
    });

    const onSubmit = async () => {
        const proposalData = form.getValues("proposalData" as any) as
            | ConfidentialQuoteData
            | null;

        if (!proposalData?.intent || !proposalData?.quote || !selectedTreasury) {
            console.error("Missing proposal data or treasury");
            return;
        }

        try {
            const proposalBond = policy?.proposal_bond || "0";

            const result = await buildConfidentialProposal({
                intentResponse: proposalData.intent,
                treasuryId: selectedTreasury,
                proposalBond,
            });

            // Get proposal count before submission to determine the new proposal's ID
            const prevCount = await getLastProposalId(selectedTreasury);

            await createProposal(
                "Confidential shield request submitted",
                {
                    treasuryId: selectedTreasury,
                    proposal: result.proposal,
                    proposalBond,
                    proposalType: "confidential_transfer",
                },
            );

            // Show the tracker
            setSubmittedProposal({
                proposalId: prevCount,
            });
        } catch (error: any) {
            console.error("Confidential shield error", error);
        }
    };

    // Auth pending — show tracker for the auth proposal
    if (authState === "auth_pending" && authProposalId !== null) {
        return (
            <PageComponentLayout
                title="Confidential"
                description="Authenticating your DAO"
            >
                <div className="flex flex-col gap-4 max-w-[600px] mx-auto">
                    <ProposalTracker
                        proposalId={authProposalId}
                        onDone={() => {
                            setAuthProposalId(null);
                            setAuthState("authenticated");
                        }}
                    />
                </div>
            </PageComponentLayout>
        );
    }

    // Not authenticated — show auth prompt with button directly
    if (authState === "needs_auth") {
        const handleAuthenticate = async () => {
            if (!selectedTreasury) return;
            try {
                const { proposal } = await prepareConfidentialAuth(selectedTreasury);
                const proposalBond = policy?.proposal_bond || "0";
                const prevCount = await getLastProposalId(selectedTreasury);
                await createProposal("Confidential auth request submitted", {
                    treasuryId: selectedTreasury,
                    proposal,
                    proposalBond,
                    proposalType: "confidential_transfer",
                });
                handleAuthProposal(prevCount);
            } catch (err) {
                console.error("Auth proposal error", err);
            }
        };

        return (
            <PageComponentLayout
                title="Confidential"
                description="Shield tokens to your confidential account"
            >
                <div className="flex flex-col gap-4 max-w-[600px] mx-auto">
                    <PageCard>
                        <div className="flex flex-col items-center gap-4 py-6">
                            <Shield className="size-10 text-primary" />
                            <StepperHeader title="Authenticate DAO" />
                            <p className="text-sm text-muted-foreground text-center max-w-md">
                                Your DAO needs to authenticate with the confidential
                                intents system before you can shield tokens or view
                                private balances. This creates a one-time signing
                                proposal via v1.signer.
                            </p>
                            <CreateRequestButton
                                onClick={handleAuthenticate}
                                className="w-full"
                                permissions={[{ kind: "call", action: "AddProposal" }]}
                                idleMessage="Authenticate DAO"
                            />
                        </div>
                    </PageCard>
                </div>
            </PageComponentLayout>
        );
    }

    // Loading auth state
    if (authState === "loading") {
        return (
            <PageComponentLayout
                title="Confidential"
                description="Shield tokens to your confidential account"
            >
                <div className="flex flex-col gap-4 max-w-[600px] mx-auto items-center py-12">
                    <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
            </PageComponentLayout>
        );
    }

    // Show tracker while a proposal is being tracked
    if (submittedProposal) {
        return (
            <PageComponentLayout
                title="Confidential"
                description="Shield tokens to your confidential account"
            >
                <div className="flex flex-col gap-4 max-w-[600px] mx-auto">
                    <ProposalTracker
                        proposalId={submittedProposal.proposalId}
                        onDone={() => {
                            setSubmittedProposal(null);
                            form.reset();
                            setStep(0);
                        }}
                    />
                </div>
            </PageComponentLayout>
        );
    }

    // Authenticated — show shield form
    return (
        <PageComponentLayout
            title="Confidential"
            description="Shield tokens to your confidential account"
        >
            <Form {...form}>
                <form
                    onSubmit={(e) => {
                        if (step !== 1) {
                            e.preventDefault();
                            return;
                        }
                        form.handleSubmit(onSubmit)(e);
                    }}
                    className="flex flex-col gap-4 max-w-[600px] mx-auto"
                >
                    <StepWizard
                        step={step}
                        onStepChange={setStep}
                        steps={[
                            { component: Step1 },
                            { component: Step2 },
                        ]}
                    />
                </form>
            </Form>
        </PageComponentLayout>
    );
}

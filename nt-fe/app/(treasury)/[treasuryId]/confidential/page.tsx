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
import { useEffect, useMemo, useState } from "react";
import { useTreasury } from "@/hooks/use-treasury";
import { useNear } from "@/stores/near-store";
import { useThemeStore } from "@/stores/theme-store";
import { cn, formatBalance } from "@/lib/utils";
import { CreateRequestButton } from "@/components/create-request-button";
import { Loader2, Shield, ShieldCheck } from "lucide-react";
import { IntentsQuoteResponse, GenerateIntentResponse } from "@/lib/api";
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

const WNEAR_TOKEN = {
    address: "wrap.near",
    symbol: "wNEAR",
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
                showInsufficientBalance={true}
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

export default function ConfidentialPage() {
    const { treasuryId: selectedTreasury } = useTreasury();
    const { createProposal } = useNear();
    const { data: policy } = useTreasuryPolicy(selectedTreasury);
    const [step, setStep] = useState(0);

    const form = useForm<ConfidentialFormValues>({
        resolver: zodResolver(confidentialFormSchema),
        defaultValues: {
            amount: "",
            token: WNEAR_TOKEN,
            receiveAmount: "0",
            slippageTolerance: 1,
        },
    });

    const onSubmit = async (data: ConfidentialFormValues) => {
        const proposalData = form.getValues("proposalData" as any) as
            | ConfidentialQuoteData
            | null;

        if (!proposalData?.intent || !selectedTreasury) {
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

            await createProposal("Confidential shield request submitted", {
                treasuryId: selectedTreasury,
                proposal: result.proposal,
                proposalBond,
                proposalType: "confidential_transfer",
            });

            form.reset();
            setStep(0);
        } catch (error: any) {
            console.error("Confidential shield error", error);
        }
    };

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

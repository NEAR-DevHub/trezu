"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectorAction } from "@hot-labs/near-connect";
import { ArrowDownToLine, Info } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { AmountSummary } from "@/components/amount-summary";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { CreateRequestButton } from "@/components/create-request-button";
import { PageComponentLayout } from "@/components/page-component-layout";
import { PendingButton } from "@/components/pending-button";
import {
    ReviewStep,
    type StepProps,
    StepperHeader,
    StepWizard,
} from "@/components/step-wizard";
import { Textarea } from "@/components/textarea";
import { Tooltip } from "@/components/tooltip";
import { type Token, tokenSchema } from "@/components/token-input";
import { Form, FormField } from "@/components/ui/form";
import { default_near_token } from "@/constants/token";
import { useAddressBook } from "@/features/address-book";
import {
    PAGE_TOUR_NAMES,
    PAGE_TOUR_STORAGE_KEYS,
    useManualPageTour,
    usePageTour,
} from "@/features/onboarding/steps/page-tours";
import { type BridgeAsset, useBridgeTokens } from "@/hooks/use-bridge-tokens";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useTreasury } from "@/hooks/use-treasury";
import {
    useStorageDepositIsRegistered,
    useToken,
    useTreasuryPolicy,
} from "@/hooks/use-treasury-queries";
import { useIntentsWithdrawalFee } from "@/hooks/use-intents-withdrawal-fee";
import { trackEvent } from "@/lib/analytics";
import Big from "@/lib/big";
import { getBlockchainType } from "@/lib/blockchain-utils";
import { useNear } from "@/stores/near-store";
import { buildIntentsTransferProposal } from "../exchange/utils/proposal-builder";
import { buildConfidentialProposal } from "../../../../features/confidential/utils/proposal-builder";
import { generateIntent, getIntentsQuote } from "@/lib/api";
import type { IntentsQuoteResponse } from "@/lib/api";
import { PaymentFormSection } from "./components/payment-form-section";
import { Address } from "@/components/address";
import {
    useIntentsQuote,
    buildIntentsQuoteRequest,
} from "@/hooks/use-intents-quote";
import { parseTokenQueryParam } from "@/lib/token-query-param";
import {
    cn,
    encodeToMarkdown,
    formatCurrency,
    formatSmartAmount,
} from "@/lib/utils";
import {
    getNetworkFeeCoverageErrorMessage,
    isIntentsToken,
    NETWORK_FEE_TOOLTIP_TEXT,
} from "@/lib/intents-fee";
import { FunctionCallKind, TransferKind } from "@/lib/proposals-api";

function buildPaymentFormSchema(messages: {
    recipientMin: string;
    recipientMax: string;
    amountGreaterThanZero: string;
    recipientSameAsToken: string;
}) {
    return z
        .object({
            address: z
                .string()
                .min(2, messages.recipientMin)
                .max(128, messages.recipientMax),
            amount: z
                .string()
                .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
                    message: messages.amountGreaterThanZero,
                }),
            memo: z.string().optional(),
            isRegistered: z.boolean().optional(),
            token: tokenSchema,
        })
        .superRefine((data, ctx) => {
            if (data.address === data.token.address) {
                ctx.addIssue({
                    code: "custom",
                    path: ["address"],
                    message: messages.recipientSameAsToken,
                });
            }
        });
}

interface Step1Props extends StepProps {
    feeErrorMessage?: string | null;
    isFeeLoading?: boolean;
    quoteErrorMessage?: string | null;
    ensureQuoteBeforeReview?: () => Promise<boolean>;
    validatedRecipients?: React.MutableRefObject<Set<string>>;
}

function Step1({
    handleNext,
    feeErrorMessage,
    isFeeLoading,
    quoteErrorMessage,
    ensureQuoteBeforeReview,
    validatedRecipients,
}: Step1Props) {
    const tPay = useTranslations("payments");
    const form = useFormContext<PaymentFormValues>();
    const { treasuryId, isConfidential } = useTreasury();
    const isMobile = useMediaQuery("(max-width: 768px)");
    const address = form.watch("address");
    const amount = form.watch("amount");

    const handleSave = async () => {
        // Validate and proceed to next step
        const isValid = await form.trigger();
        if (!isValid || !handleNext) return;

        if (ensureQuoteBeforeReview) {
            const hasQuote = await ensureQuoteBeforeReview();
            if (!hasQuote) return;
        }

        handleNext();
    };

    const isFormFilled = !!amount && Number(amount) > 0 && !!address;
    const saveButtonText = isFormFilled
        ? tPay("reviewButton")
        : tPay("reviewButtonDisabled");

    return (
        <PageCard>
            <div className="flex justify-between items-center">
                <StepperHeader title={tPay("newPayment")} />
                <div className="flex items-center gap-2">
                    {isConfidential ? (
                        <Button
                            variant="outline"
                            size={isMobile ? "icon" : "default"}
                            className="flex items-center gap-2"
                            id="payments-bulk-btn"
                            disabled
                            tooltipContent={tPay("comingSoon")}
                        >
                            <ArrowDownToLine className="w-4 h-4" />
                            <span className="hidden md:block">
                                {tPay("bulkPayments")}
                            </span>
                        </Button>
                    ) : (
                        <Link href={`/${treasuryId}/payments/bulk-payment`}>
                            <Button
                                variant="ghost"
                                size={isMobile ? "icon" : "default"}
                                className="flex items-center gap-2 border-2"
                                id="payments-bulk-btn"
                                onClick={() => {
                                    trackEvent("bulk-payments-click", {
                                        source: "payments_page",
                                        treasury_id: treasuryId ?? "",
                                    });
                                }}
                            >
                                <ArrowDownToLine className="w-4 h-4" />
                                <span className="hidden md:block">
                                    {tPay("bulkPayments")}
                                </span>
                            </Button>
                        </Link>
                    )}
                    <PendingButton
                        id="payments-pending-btn"
                        types={["Payments"]}
                    />
                </div>
            </div>

            <PaymentFormSection
                control={form.control}
                amountName="amount"
                tokenName="token"
                recipientName="address"
                feeErrorMessage={feeErrorMessage || quoteErrorMessage}
                saveButtonText={saveButtonText}
                onSave={handleSave}
                isSubmitting={isFeeLoading}
                validatedRecipients={validatedRecipients}
            />
        </PageCard>
    );
}

interface Step2Props extends StepProps {
    networkFee?: string | null;
    showFeeBreakdown: boolean;
    liveQuote?: IntentsQuoteResponse | null;
    isLoadingLiveQuote?: boolean;
    isFetchingLiveQuote?: boolean;
}

function Step2({
    handleBack,
    networkFee,
    showFeeBreakdown,
    liveQuote,
    isLoadingLiveQuote,
    isFetchingLiveQuote,
}: Step2Props) {
    const tPay = useTranslations("payments");
    const form = useFormContext<PaymentFormValues>();
    const token = form.watch("token");
    const address = form.watch("address");
    const amount = form.watch("amount");
    const { data: storageDepositData } = useStorageDepositIsRegistered(
        address,
        token.address,
        token.residency === "Ft",
    );
    const { data: tokenData } = useToken(token.address);
    const { data: addressBook = [] } = useAddressBook();
    const contactName = addressBook.find(
        (e) => e.address.toLowerCase() === address?.toLowerCase(),
    )?.name;
    const isSelectedTokenIntents = isIntentsToken(token);

    useEffect(() => {
        if (storageDepositData !== undefined) {
            form.setValue("isRegistered", storageDepositData);
        }
    }, [storageDepositData, form]);

    useEffect(() => {
        form.setValue("proposalData" as any, liveQuote ?? null, {
            shouldValidate: false,
        });
    }, [form, liveQuote]);

    const {
        totalAmountWithFees,
        recipientAmount,
        estimatedUSDValue,
        recipientEstimatedUSDValue,
    } = useMemo(() => {
        const total = Big(amount || "0");
        const recipientRaw =
            showFeeBreakdown && networkFee ? total.minus(networkFee) : total;
        const recipient = recipientRaw.lt(0) ? Big(0) : recipientRaw;
        const price = tokenData?.price ?? 0;
        return {
            totalAmountWithFees: total,
            recipientAmount: recipient,
            estimatedUSDValue: price ? total.mul(price) : Big(0),
            recipientEstimatedUSDValue: price ? recipient.mul(price) : Big(0),
        };
    }, [amount, showFeeBreakdown, networkFee, tokenData?.price]);

    return (
        <PageCard>
            <ReviewStep
                reviewingTitle="Review Your Payment"
                handleBack={handleBack}
            >
                <AmountSummary
                    total={formatSmartAmount(totalAmountWithFees)}
                    totalUSD={estimatedUSDValue.toNumber()}
                    token={token}
                    showNetworkIcon={true}
                >
                    <p>{tPay("summaryRecipients", { count: 1 })}</p>
                </AmountSummary>
                <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1 w-full">
                        <div className="flex justify-between items-center gap-2 w-full text-xs">
                            <div className="flex flex-col gap-0.5 min-w-0">
                                {contactName && (
                                    <p className="font-semibold">
                                        {contactName}
                                    </p>
                                )}
                                <Address
                                    address={address}
                                    className={cn(
                                        contactName
                                            ? "text-muted-foreground"
                                            : "font-semibold",
                                    )}
                                />
                            </div>
                            <div className="flex items-center gap-5 min-w-fit">
                                <img
                                    src={token.icon}
                                    alt={token.symbol}
                                    className="size-5 rounded-full"
                                />
                                <div className="flex flex-col gap-[3px] items-end">
                                    <p className="text-xs font-semibold text-wrap break-all">
                                        {formatSmartAmount(recipientAmount)}{" "}
                                        {token.symbol}
                                    </p>
                                    <p className="text-xxs text-muted-foreground text-wrap break-all">
                                        ≈{" "}
                                        {formatCurrency(
                                            recipientEstimatedUSDValue,
                                        )}
                                    </p>
                                </div>
                            </div>
                        </div>
                        {showFeeBreakdown && networkFee && (
                            <div className="flex items-center justify-between gap-2 text-sm my-3">
                                <div className="flex items-center gap-1 text-muted-foreground">
                                    <p>{tPay("networkFee")}</p>
                                    <Tooltip
                                        content={NETWORK_FEE_TOOLTIP_TEXT}
                                        side="top"
                                    >
                                        <Info
                                            className="size-3 shrink-0"
                                            aria-label={tPay("networkFeeInfo")}
                                        />
                                    </Tooltip>
                                </div>
                                <p>
                                    {networkFee} {token.symbol}
                                </p>
                            </div>
                        )}
                        <FormField
                            control={form.control}
                            name="memo"
                            render={({ field }) => (
                                <Textarea
                                    value={field.value}
                                    onChange={field.onChange}
                                    borderless
                                    rows={2}
                                    placeholder={tPay("commentPlaceholder")}
                                />
                            )}
                        />
                    </div>
                </div>
            </ReviewStep>

            <div className="rounded-lg border bg-card p-0 overflow-hidden">
                <CreateRequestButton
                    isSubmitting={
                        form.formState.isSubmitting ||
                        (isSelectedTokenIntents &&
                            (isLoadingLiveQuote || isFetchingLiveQuote))
                    }
                    type="submit"
                    className="w-full h-10 rounded-none"
                    permissions={[
                        { kind: "transfer", action: "AddProposal" },
                        { kind: "call", action: "AddProposal" },
                    ]}
                    idleMessage={
                        isSelectedTokenIntents &&
                        (isLoadingLiveQuote || isFetchingLiveQuote)
                            ? tPay("preparingRoute")
                            : tPay("confirmSubmit")
                    }
                    disabled={
                        isSelectedTokenIntents &&
                        (isLoadingLiveQuote || isFetchingLiveQuote)
                    }
                />
            </div>
        </PageCard>
    );
}

type PaymentFormValues = z.infer<ReturnType<typeof buildPaymentFormSchema>>;

const STABLE_TOKEN_PRIORITY: Record<string, number> = {
    USDC: 2,
    USDT: 1,
};

function getNetworkMatchScore(
    tokenNetwork: string,
    preferredNetworks: string[],
): number {
    const normalizedTokenNetwork = tokenNetwork.trim().toLowerCase();
    const tokenBlockchain = getBlockchainType(normalizedTokenNetwork);
    let bestScore = 0;

    preferredNetworks.forEach((preferredNetwork, index) => {
        const normalizedPreferredNetwork = preferredNetwork
            .trim()
            .toLowerCase();

        if (normalizedPreferredNetwork === normalizedTokenNetwork) {
            bestScore = Math.max(bestScore, 200 - index);
            return;
        }

        const preferredBlockchain = getBlockchainType(
            normalizedPreferredNetwork,
        );

        if (
            preferredBlockchain !== "unknown" &&
            preferredBlockchain === tokenBlockchain
        ) {
            bestScore = Math.max(bestScore, 100 - index);
        }
    });

    return bestScore;
}

function pickCompatibleFallbackToken(
    preferredNetworks: string[],
    bridgeAssets: BridgeAsset[],
): Token | null {
    let bestCandidate: { score: number; token: Token } | null = null;

    for (const asset of bridgeAssets) {
        for (const network of asset.networks) {
            const networkScore = getNetworkMatchScore(
                network.name,
                preferredNetworks,
            );

            if (networkScore === 0) {
                continue;
            }

            const stablePriority =
                STABLE_TOKEN_PRIORITY[network.symbol.toUpperCase()] ?? 0;
            const candidateScore = networkScore * 10 + stablePriority;
            const candidate: Token = {
                address: network.id,
                symbol: network.symbol,
                decimals: network.decimals,
                name: asset.name,
                icon: asset.icon,
                network: network.name,
                chainIcons: network.chainIcons ?? undefined,
                residency: "Intents",
                minWithdrawalAmount: network.minWithdrawalAmount,
                minDepositAmount: network.minDepositAmount,
            };

            if (!bestCandidate || candidateScore > bestCandidate.score) {
                bestCandidate = {
                    score: candidateScore,
                    token: candidate,
                };
            }
        }
    }

    return bestCandidate?.token ?? null;
}

function buildIntentTransferDescription(
    data: PaymentFormValues,
    quote: Awaited<ReturnType<typeof getIntentsQuote>>,
): string {
    const notes = [data.memo?.trim()].filter(Boolean).join(" ");

    return encodeToMarkdown({
        proposal_action: "payment-transfer",
        notes,
        recipient: data.address,
        depositAddress: quote?.quote.depositAddress,
        signature: quote?.signature,
        timeEstimate: quote?.quote.timeEstimate
            ? `${quote.quote.timeEstimate} seconds`
            : undefined,
    });
}

const buildTransferProposal = (
    data: PaymentFormValues,
    parsedAmount: string,
    isConfidential: boolean,
): TransferKind => {
    const isNEAR =
        data.token.address === default_near_token(isConfidential).address;
    return {
        Transfer: {
            token_id: isNEAR ? "" : data.token.address,
            receiver_id: data.address,
            amount: parsedAmount,
            msg: null,
        },
    };
};

export default function PaymentsPage() {
    const t = useTranslations("pages.payments");
    const tValidation = useTranslations("paymentForm.validation");
    const paymentFormSchema = useMemo(
        () =>
            buildPaymentFormSchema({
                recipientMin: tValidation("recipientMin"),
                recipientMax: tValidation("recipientMax"),
                amountGreaterThanZero: tValidation("amountGreaterThanZero"),
                recipientSameAsToken: tValidation("recipientSameAsToken"),
            }),
        [tValidation],
    );
    const { treasuryId, isConfidential } = useTreasury();
    const { createProposal } = useNear();
    const { data: policy } = useTreasuryPolicy(treasuryId);
    const [step, setStep] = useState(0);
    const searchParams = useSearchParams();
    const autoSelectedTokenKeyRef = useRef<string | null>(null);
    const validatedRecipientsRef = useRef(new Set<string>());

    const tokenParam = searchParams.get("token");
    const preferredNetworks = useMemo(
        () =>
            (searchParams.get("networks") ?? searchParams.get("network") ?? "")
                .split(",")
                .map((network) => network.trim())
                .filter(Boolean),
        [searchParams],
    );
    const autoSelectionKey = useMemo(
        () => preferredNetworks.join(","),
        [preferredNetworks],
    );
    const { data: bridgeAssets = [] } = useBridgeTokens(
        !tokenParam && preferredNetworks.length > 0,
    );

    // Parse token from query params
    const defaultToken = useMemo(() => {
        const fallbackToken = default_near_token(isConfidential);
        return parseTokenQueryParam(tokenParam, fallbackToken);
    }, [tokenParam, isConfidential]);

    const compatibleDefaultToken = useMemo(() => {
        if (tokenParam || preferredNetworks.length === 0) {
            return null;
        }

        return pickCompatibleFallbackToken(preferredNetworks, bridgeAssets);
    }, [bridgeAssets, preferredNetworks, tokenParam]);

    const defaultAddress = useMemo(() => {
        const addressParam = searchParams.get("address");
        return addressParam ? decodeURIComponent(addressParam) : "";
    }, [searchParams]);

    // Onboarding tours
    usePageTour(
        PAGE_TOUR_NAMES.PAYMENTS_BULK,
        PAGE_TOUR_STORAGE_KEYS.PAYMENTS_BULK_SHOWN,
        {
            enabled: !isConfidential,
        },
    );
    const { triggerTour: triggerPendingTour } = useManualPageTour(
        PAGE_TOUR_NAMES.PAYMENTS_PENDING,
        PAGE_TOUR_STORAGE_KEYS.PAYMENTS_PENDING_SHOWN,
    );

    const form = useForm<PaymentFormValues>({
        resolver: zodResolver(paymentFormSchema),
        defaultValues: {
            address: defaultAddress,
            amount: "",
            memo: "",
            token: defaultToken,
        },
    });
    const [watchedToken, watchedAmount, watchedAddress] = useWatch({
        control: form.control,
        name: ["token", "amount", "address"],
    }) as [PaymentFormValues["token"], string, string];

    const {
        data: intentsFeeData,
        isIntentsCrossChainToken,
        isLoading: isIntentsFeeLoading,
        isError: hasIntentsFeeError,
    } = useIntentsWithdrawalFee({
        token: watchedToken,
        destinationAddress: watchedAddress,
    });
    const hasFeeData = !!intentsFeeData && !hasIntentsFeeError;

    const feeErrorMessage = useMemo(() => {
        if (
            !isIntentsCrossChainToken ||
            !watchedAmount ||
            isNaN(Number(watchedAmount)) ||
            Number(watchedAmount) <= 0 ||
            isIntentsFeeLoading ||
            !hasFeeData
        ) {
            return null;
        }

        return getNetworkFeeCoverageErrorMessage({
            amount: watchedAmount,
            networkFee: Big(intentsFeeData!.networkFee),
            decimals: watchedToken.decimals,
            symbol: watchedToken.symbol,
        });
    }, [
        intentsFeeData,
        isIntentsCrossChainToken,
        isIntentsFeeLoading,
        hasFeeData,
        watchedAmount,
        watchedToken?.decimals,
        watchedToken?.symbol,
    ]);

    const isSelectedTokenIntents = isIntentsToken(watchedToken);

    const {
        quote: liveQuote,
        isLoading: isLoadingLiveQuote,
        isFetching: isFetchingLiveQuote,
        isEnsuring: isEnsuringQuote,
        isSyncPending: isQuoteSyncPending,
        hasError: hasLiveQuoteError,
        errorMessage: liveQuoteErrorMessage,
        ensureBeforeReview,
    } = useIntentsQuote({
        treasuryId,
        token: watchedToken,
        amount: watchedAmount,
        address: watchedAddress,
        isConfidential,
        proposalPeriod: policy?.proposal_period,
        feeErrorMessage,
    });

    const ensureQuoteBeforeReview = async () => {
        const formValues = form.getValues();
        const result = await ensureBeforeReview(formValues);
        if (result.ok) {
            if (result.quote) {
                form.setValue("proposalData" as any, result.quote, {
                    shouldValidate: false,
                });
            }
            form.clearErrors("amount");
            return true;
        }
        if (result.error) {
            if (result.error.includes("initializing")) {
                toast.error(result.error);
            } else {
                form.setError("amount", {
                    type: "manual",
                    message: result.error,
                });
            }
        }
        return false;
    };

    // Update token/address when query params change
    useEffect(() => {
        form.setValue("token", defaultToken);
    }, [defaultToken, form]);

    useEffect(() => {
        if (defaultAddress) {
            form.setValue("address", defaultAddress);
        }
    }, [defaultAddress, form]);

    useEffect(() => {
        if (!compatibleDefaultToken || tokenParam) {
            return;
        }

        const currentToken = form.getValues("token");
        const defaultNearToken = default_near_token(isConfidential);
        const isStillDefaultNearToken =
            currentToken?.address === defaultNearToken.address &&
            currentToken?.network === defaultNearToken.network;

        if (
            !isStillDefaultNearToken ||
            autoSelectedTokenKeyRef.current === autoSelectionKey
        ) {
            return;
        }

        form.setValue("token", compatibleDefaultToken);
        autoSelectedTokenKeyRef.current = autoSelectionKey;
    }, [autoSelectionKey, compatibleDefaultToken, form, tokenParam]);

    const onSubmit = async (data: PaymentFormValues) => {
        try {
            const isNEAR = data.token.symbol === "NEAR";
            const proposalBond = policy?.proposal_bond || "0";
            const gas = Big(255).mul(Big(10).pow(12)).toFixed(); // 255 Tgas for storage_deposit

            const additionalTransactions: Array<{
                receiverId: string;
                actions: ConnectorAction[];
            }> = [];
            const isSubmittedTokenIntents = isIntentsToken(data.token);

            const needsStorageDeposit =
                !data.isRegistered && !isNEAR && !isSubmittedTokenIntents;

            if (needsStorageDeposit) {
                const depositInYocto = Big(0.00125)
                    .mul(Big(10).pow(24))
                    .toFixed();
                additionalTransactions.push({
                    receiverId: data.token.address,
                    actions: [
                        {
                            type: "FunctionCall",
                            params: {
                                methodName: "storage_deposit",
                                args: {
                                    account_id: data.address,
                                    registration_only: true,
                                } as any,
                                gas,
                                deposit: depositInYocto,
                            },
                        } as ConnectorAction,
                    ],
                });
            }

            const parsedAmount = Big(data.amount)
                .mul(Big(10).pow(data.token.decimals))
                .toFixed();

            let description = encodeToMarkdown({
                notes: data.memo || "",
            });
            let proposalKind: FunctionCallKind | TransferKind;

            if (isSubmittedTokenIntents) {
                const cachedQuote = form.getValues(
                    "proposalData" as any,
                ) as IntentsQuoteResponse | null;
                const quote =
                    cachedQuote ??
                    (await getIntentsQuote(
                        buildIntentsQuoteRequest(
                            treasuryId!,
                            data.token,
                            data.address,
                            parsedAmount,
                            isConfidential,
                            policy?.proposal_period,
                        ),
                        false,
                    ));

                if (!quote) {
                    throw new Error("Failed to create 1Click transfer quote");
                }

                if (isConfidential) {
                    // Confidential path: generate intent + build v1.signer proposal
                    // Pass the full quote (minus correlationId, already stored separately)
                    // so the backend can persist it for displaying proposal details.
                    const { correlationId: _, ...quoteMetadata } =
                        quote as unknown as Record<string, unknown>;
                    const intentResponse = await generateIntent({
                        type: "swap_transfer",
                        standard: "nep413",
                        signerId: treasuryId!,
                        quoteMetadata,
                        notes: data.memo?.trim() || undefined,
                    });

                    const confidentialResult = await buildConfidentialProposal({
                        intentResponse,
                        treasuryId: treasuryId!,
                    });

                    description = confidentialResult.proposal.description;
                    proposalKind = confidentialResult.proposal
                        .kind as FunctionCallKind;
                } else {
                    description = buildIntentTransferDescription(data, quote);
                    proposalKind = buildIntentsTransferProposal(
                        data.token.address,
                        quote.quote.depositAddress,
                        quote.quote.amountIn,
                    );
                }
            } else {
                proposalKind = buildTransferProposal(
                    data,
                    parsedAmount,
                    isConfidential,
                );
            }

            await createProposal("Request to send payment submitted", {
                treasuryId: treasuryId!,
                proposal: {
                    description,
                    kind: proposalKind,
                },
                proposalBond,
                additionalTransactions,
                proposalType: "payment",
            })
                .then(() => {
                    trackEvent("payment-submitted", {
                        treasury_id: treasuryId ?? "",
                        token_symbol: data.token.symbol,
                        amount: data.amount,
                    });
                    form.reset();
                    setStep(0);
                    triggerPendingTour();
                })
                .catch((error) => {
                    console.error("Payments error", error);
                });
        } catch (error) {
            console.error("Payments error", error);
        }
    };

    const steps = useMemo(
        () => [
            {
                component: Step1,
                props: {
                    feeErrorMessage,
                    isFeeLoading:
                        isIntentsFeeLoading ||
                        (isSelectedTokenIntents &&
                            (isLoadingLiveQuote ||
                                isFetchingLiveQuote ||
                                isEnsuringQuote ||
                                isQuoteSyncPending)),
                    quoteErrorMessage:
                        isSelectedTokenIntents && hasLiveQuoteError
                            ? liveQuoteErrorMessage
                            : null,
                    ensureQuoteBeforeReview,
                    validatedRecipients: validatedRecipientsRef,
                },
            },
            {
                component: Step2,
                props: {
                    showFeeBreakdown: isIntentsCrossChainToken && hasFeeData,
                    networkFee: hasFeeData ? intentsFeeData?.networkFee : null,
                    liveQuote,
                    isLoadingLiveQuote,
                    isFetchingLiveQuote,
                },
            },
        ],
        [
            feeErrorMessage,
            isIntentsFeeLoading,
            isIntentsCrossChainToken,
            hasFeeData,
            intentsFeeData?.networkFee,
            liveQuote,
            isLoadingLiveQuote,
            isFetchingLiveQuote,
            isEnsuringQuote,
            isQuoteSyncPending,
            hasLiveQuoteError,
            liveQuoteErrorMessage,
            isSelectedTokenIntents,
            ensureQuoteBeforeReview,
        ],
    );

    return (
        <PageComponentLayout title={t("title")} description={t("description")}>
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-4 max-w-[600px] mx-auto"
                >
                    <StepWizard
                        step={step}
                        onStepChange={setStep}
                        steps={steps}
                    />
                </form>
            </Form>
        </PageComponentLayout>
    );
}

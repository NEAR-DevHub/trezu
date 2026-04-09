"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectorAction } from "@hot-labs/near-connect";
import { ArrowDownToLine, Info } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFormContext, useWatch } from "react-hook-form";
import { useDebounce } from "use-debounce";
import { z } from "zod";
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
import { buildConfidentialProposal } from "../confidential/utils/proposal-builder";
import { generateIntent } from "@/lib/api";
import { PaymentFormSection } from "./components/payment-form-section";
import { Address } from "@/components/address";
import { useQuery } from "@tanstack/react-query";
import { getIntentsQuote, IntentsQuoteResponse } from "@/lib/api";
import { cn, encodeToMarkdown, formatCurrency, nanosToMs } from "@/lib/utils";
import {
    getNetworkFeeCoverageErrorMessage,
    NETWORK_FEE_TOOLTIP_TEXT,
} from "@/lib/intents-fee";
import { FunctionCallKind, TransferKind } from "@/lib/proposals-api";

const paymentFormSchema = z
    .object({
        address: z
            .string()
            .min(2, "Recipient should be at least 2 characters")
            .max(128, "Recipient must be less than 128 characters"),
        amount: z
            .string()
            .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
                message: "Amount must be greater than 0",
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
                message: "Recipient and token address cannot be the same",
            });
        }
    });

interface Step1Props extends StepProps {
    feeErrorMessage?: string | null;
    isFeeLoading?: boolean;
    quoteErrorMessage?: string | null;
}

function Step1({
    handleNext,
    feeErrorMessage,
    isFeeLoading,
    quoteErrorMessage,
}: Step1Props) {
    const form = useFormContext<PaymentFormValues>();
    const { treasuryId, isConfidential } = useTreasury();
    const isMobile = useMediaQuery("(max-width: 768px)");
    const address = form.watch("address");
    const amount = form.watch("amount");

    const handleSave = () => {
        // Validate and proceed to next step
        form.trigger().then((isValid) => {
            if (isValid && handleNext) {
                handleNext();
            }
        });
    };

    const isFormFilled = !!amount && Number(amount) > 0 && !!address;
    const saveButtonText = isFormFilled
        ? "Review Payment"
        : "Enter amount and address";

    return (
        <PageCard>
            <div className="flex justify-between items-center">
                <StepperHeader title="New Payment" />
                <div className="flex items-center gap-2">
                    {isConfidential ? (
                        <Button
                            variant="outline"
                            size={isMobile ? "icon" : "default"}
                            className="flex items-center gap-2"
                            id="payments-bulk-btn"
                            disabled
                            tooltipContent="Coming soon"
                        >
                            <ArrowDownToLine className="w-4 h-4" />
                            <span className="hidden md:block">
                                Bulk Payments
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
                                    Bulk Payments
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
    hasLiveQuoteError?: boolean;
    liveQuoteErrorMessage?: string | null;
}

function Step2({
    handleBack,
    networkFee,
    showFeeBreakdown,
    liveQuote,
    isLoadingLiveQuote,
    isFetchingLiveQuote,
    hasLiveQuoteError,
    liveQuoteErrorMessage,
}: Step2Props) {
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
        if (liveQuote) {
            form.setValue("proposalData" as any, liveQuote, {
                shouldValidate: false,
            });
        }
    }, [form, liveQuote]);

    const totalAmountWithFees = Big(amount || "0");
    const recipientAmountRaw =
        showFeeBreakdown && networkFee
            ? Big(amount || "0").minus(networkFee)
            : Big(amount || "0");
    const recipientAmount = recipientAmountRaw.lt(0)
        ? Big(0)
        : recipientAmountRaw;
    const estimatedUSDValue = !!tokenData?.price
        ? totalAmountWithFees.mul(tokenData.price)
        : Big(0);
    const recipientEstimatedUSDValue = !!tokenData?.price
        ? recipientAmount.mul(tokenData.price)
        : Big(0);

    return (
        <PageCard>
            <ReviewStep
                reviewingTitle="Review Your Payment"
                handleBack={handleBack}
            >
                <AmountSummary
                    total={totalAmountWithFees}
                    totalUSD={estimatedUSDValue.toNumber()}
                    token={token}
                    showNetworkIcon={true}
                >
                    <p>to 1 recipient</p>
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
                                        {recipientAmount.toString()}{" "}
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
                                    <p>Network Fee</p>
                                    <Tooltip
                                        content={NETWORK_FEE_TOOLTIP_TEXT}
                                        side="top"
                                    >
                                        <Info
                                            className="size-3 shrink-0"
                                            aria-label="Network fee info"
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
                                    placeholder="Add a comment (optional)..."
                                />
                            )}
                        />
                    </div>
                </div>
                <></>
            </ReviewStep>

            <div className="rounded-lg border bg-card p-0 overflow-hidden">
                <CreateRequestButton
                    isSubmitting={form.formState.isSubmitting}
                    type="submit"
                    className="w-full h-10 rounded-none"
                    permissions={[
                        { kind: "transfer", action: "AddProposal" },
                        { kind: "call", action: "AddProposal" },
                    ]}
                    idleMessage={
                        isSelectedTokenIntents
                            ? hasLiveQuoteError
                                ? liveQuoteErrorMessage ||
                                  "Failed to prepare 1Click transfer route"
                                : isLoadingLiveQuote || isFetchingLiveQuote
                                  ? "Preparing 1Click transfer route..."
                                  : "Confirm and Submit Request"
                            : "Confirm and Submit Request"
                    }
                    disabled={
                        isSelectedTokenIntents &&
                        (isLoadingLiveQuote ||
                            isFetchingLiveQuote ||
                            hasLiveQuoteError ||
                            !liveQuote)
                    }
                />
            </div>
        </PageCard>
    );
}

type PaymentFormValues = z.infer<typeof paymentFormSchema>;

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

function isIntentsToken(token: Token): boolean {
    return (
        token.address.startsWith("nep141:") ||
        token.address.startsWith("nep245:")
    );
}

function buildIntentsPaymentQuoteRequest(
    treasuryId: string,
    data: PaymentFormValues,
    parsedAmount: string,
    isConfidential: boolean,
    proposalPeriod?: string,
) {
    const deadlineMs = proposalPeriod
        ? nanosToMs(proposalPeriod)
        : 24 * 60 * 60 * 1000;

    return {
        daoId: treasuryId,
        swapType: "EXACT_INPUT",
        slippageTolerance: 0,
        originAsset: data.token.address,
        depositType: isConfidential
            ? ("CONFIDENTIAL_INTENTS" as const)
            : ("INTENTS" as const),
        destinationAsset: data.token.address,
        amount: parsedAmount,
        refundTo: treasuryId,
        refundType: isConfidential
            ? ("CONFIDENTIAL_INTENTS" as const)
            : ("INTENTS" as const),
        recipient: data.address,
        recipientType: "DESTINATION_CHAIN" as const,
        deadline: new Date(Date.now() + deadlineMs).toISOString(),
        quoteWaitingTimeMs: 0,
    };
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
    const { treasuryId, isConfidential } = useTreasury();
    const { createProposal } = useNear();
    const { data: policy } = useTreasuryPolicy(treasuryId);
    const [step, setStep] = useState(0);
    const searchParams = useSearchParams();
    const autoSelectedTokenKeyRef = useRef<string | null>(null);

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
        if (tokenParam) {
            try {
                return JSON.parse(decodeURIComponent(tokenParam));
            } catch {
                return default_near_token(isConfidential);
            }
        }
        return default_near_token(isConfidential);
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
    const [debouncedAddress] = useDebounce(watchedAddress, 300);
    const {
        data: intentsFeeData,
        isIntentsCrossChainToken,
        isLoading: isIntentsFeeLoading,
    } = useIntentsWithdrawalFee({
        token: watchedToken,
        destinationAddress: debouncedAddress,
    });

    const feeErrorMessage = useMemo(() => {
        if (
            !isIntentsCrossChainToken ||
            !watchedAmount ||
            isNaN(Number(watchedAmount)) ||
            Number(watchedAmount) <= 0 ||
            isIntentsFeeLoading ||
            !intentsFeeData
        ) {
            return null;
        }

        return getNetworkFeeCoverageErrorMessage({
            amount: watchedAmount,
            networkFee: Big(intentsFeeData.networkFee),
            decimals: watchedToken.decimals,
            symbol: watchedToken.symbol,
        });
    }, [
        intentsFeeData,
        isIntentsCrossChainToken,
        isIntentsFeeLoading,
        watchedAmount,
        watchedToken?.decimals,
        watchedToken?.symbol,
    ]);

    const isSelectedTokenIntents = isIntentsToken(watchedToken);
    const parsedAmount = useMemo(() => {
        if (!watchedAmount || Number(watchedAmount) <= 0) {
            return null;
        }

        return Big(watchedAmount)
            .mul(Big(10).pow(watchedToken.decimals))
            .toFixed();
    }, [watchedAmount, watchedToken.decimals]);

    const {
        data: liveQuote,
        isLoading: isLoadingLiveQuote,
        isFetching: isFetchingLiveQuote,
        isError: hasLiveQuoteError,
        error: liveQuoteError,
    } = useQuery({
        queryKey: [
            "paymentLiveQuote",
            treasuryId,
            watchedToken.address,
            watchedAmount,
            debouncedAddress,
        ],
        queryFn: async (): Promise<IntentsQuoteResponse | null> => {
            if (!treasuryId || !parsedAmount) {
                return null;
            }

            return getIntentsQuote(
                buildIntentsPaymentQuoteRequest(
                    treasuryId,
                    form.getValues(),
                    parsedAmount,
                    isConfidential,
                    policy?.proposal_period,
                ),
                false,
            );
        },
        enabled:
            isSelectedTokenIntents &&
            !!treasuryId &&
            !!debouncedAddress &&
            !!parsedAmount &&
            !!policy?.proposal_period,
        refetchOnWindowFocus: false,
        retry: false,
    });

    const liveQuoteErrorMessage = useMemo(() => {
        if (!hasLiveQuoteError || !liveQuoteError) return null;
        const message =
            liveQuoteError instanceof Error
                ? liveQuoteError.message
                : "Failed to prepare 1Click transfer route";

        // Convert raw amount in "at least <raw>" pattern to human-readable format
        // e.g. "Amount is too low for bridge, try at least 432" → "...at least 0.000433 USDC"
        // Bump by 1 because the API returns an exclusive minimum
        return message.replace(/at least (\d+)/i, (_, rawAmount) => {
            try {
                const formatted = Big(rawAmount)
                    .plus(1)
                    .div(Big(10).pow(watchedToken.decimals))
                    .toFixed()
                    .replace(/\.?0+$/, "");
                return `at least ${formatted} ${watchedToken.symbol}`;
            } catch {
                return `at least ${rawAmount}`;
            }
        });
    }, [
        hasLiveQuoteError,
        liveQuoteError,
        watchedToken.decimals,
        watchedToken.symbol,
    ]);

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
            const isSelectedTokenIntents = isIntentsToken(data.token);

            const needsStorageDeposit =
                !data.isRegistered && !isNEAR && !isSelectedTokenIntents;

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

            if (isSelectedTokenIntents) {
                const cachedQuote = form.getValues(
                    "proposalData" as any,
                ) as IntentsQuoteResponse | null;
                const quote =
                    cachedQuote ??
                    (await getIntentsQuote(
                        buildIntentsPaymentQuoteRequest(
                            treasuryId!,
                            data,
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
                    isFeeLoading: isIntentsFeeLoading,
                    quoteErrorMessage: liveQuoteErrorMessage?.includes(
                        "at least",
                    )
                        ? liveQuoteErrorMessage
                        : null,
                },
            },
            {
                component: Step2,
                props: {
                    showFeeBreakdown: isIntentsCrossChainToken,
                    networkFee: intentsFeeData?.networkFee,
                    liveQuote,
                    isLoadingLiveQuote,
                    isFetchingLiveQuote,
                    hasLiveQuoteError,
                    liveQuoteErrorMessage,
                },
            },
        ],
        [
            feeErrorMessage,
            isIntentsFeeLoading,
            isIntentsCrossChainToken,
            intentsFeeData?.networkFee,
            liveQuote,
            isLoadingLiveQuote,
            isFetchingLiveQuote,
            hasLiveQuoteError,
            liveQuoteErrorMessage,
        ],
    );

    return (
        <PageComponentLayout
            title="Payments"
            description="Send and receive funds securely"
        >
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

import { useQuery } from "@tanstack/react-query";
import { UseFormReturn } from "react-hook-form";
import Big from "@/lib/big";
import {
    getIntentsQuote,
    generateIntent,
    IntentsQuoteResponse,
    GenerateIntentResponse,
} from "@/lib/api";
import { Token } from "@/components/token-input";

// PoC mode: use mock responses from captured near.com fixtures
// TODO: Remove this when 1Click API supports confidential quotes with our API key
const USE_MOCK_QUOTES = true;

interface UseConfidentialQuoteParams {
    selectedTreasury: string | null | undefined;
    token: Token;
    amount: string;
    slippageTolerance: number;
    form: UseFormReturn<any>;
    enabled: boolean;
    isDryRun: boolean;
    refetchInterval: number;
}

export interface ConfidentialQuoteData {
    quote: IntentsQuoteResponse;
    intent?: GenerateIntentResponse;
}

/**
 * Hook for fetching confidential shield quotes and generating intent payloads.
 *
 * For dry runs (Step 1): only fetches quote to show estimated amounts.
 * For live runs (Step 2): fetches quote + calls generate-intent to get
 * the NEP-413 payload that needs to be signed via v1.signer.
 */
export function useConfidentialQuote({
    selectedTreasury,
    token,
    amount,
    slippageTolerance,
    form,
    enabled,
    isDryRun,
    refetchInterval,
}: UseConfidentialQuoteParams) {
    return useQuery({
        queryKey: [
            isDryRun ? "dryConfidentialQuote" : "liveConfidentialQuote",
            selectedTreasury,
            token.address,
            amount,
            slippageTolerance,
        ],
        queryFn: async (): Promise<ConfidentialQuoteData | null> => {
            if (!selectedTreasury) return null;

            try {
                const parsedAmount = Big(amount)
                    .mul(Big(10).pow(token.decimals))
                    .toFixed();

                const originAsset = token.address === "near"
                    ? "near"
                    : `nep141:${token.address}`;

                let quote: IntentsQuoteResponse | null;

                if (USE_MOCK_QUOTES) {
                    // PoC: build a mock quote based on captured real data
                    const amountFormatted = amount;
                    const depositAddress = "d32b552aa188face5952516a370bc5a9d91f77a19c48d5b7b16e6c59eb79b08e";
                    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

                    quote = {
                        quote: {
                            amountIn: parsedAmount,
                            amountInFormatted: amountFormatted,
                            amountInUsd: "0.00", // PoC placeholder
                            minAmountIn: parsedAmount,
                            amountOut: parsedAmount,
                            amountOutFormatted: amountFormatted,
                            amountOutUsd: "0.00",
                            minAmountOut: Big(parsedAmount).mul(0.99).toFixed(0),
                            timeEstimate: 10,
                            depositAddress,
                            deadline,
                            timeWhenInactive: deadline,
                        },
                        quoteRequest: {
                            swapType: "EXACT_INPUT",
                            slippageTolerance: Math.round(slippageTolerance * 100),
                            originAsset,
                            depositType: "INTENTS",
                            destinationAsset: originAsset,
                            amount: parsedAmount,
                            refundTo: selectedTreasury,
                            refundType: "CONFIDENTIAL_INTENTS",
                            recipient: selectedTreasury,
                            recipientType: "CONFIDENTIAL_INTENTS",
                            deadline,
                        },
                        signature: "mock",
                        timestamp: new Date().toISOString(),
                        correlationId: `poc-${Date.now()}`,
                    };
                } else {
                    // Real API call
                    quote = await getIntentsQuote(
                        {
                            swapType: "EXACT_INPUT",
                            slippageTolerance: Math.round(
                                slippageTolerance * 100,
                            ),
                            originAsset,
                            depositType: "INTENTS",
                            destinationAsset: originAsset,
                            amount: parsedAmount,
                            refundTo: selectedTreasury,
                            refundType: "CONFIDENTIAL_INTENTS",
                            recipient: selectedTreasury,
                            recipientType: "CONFIDENTIAL_INTENTS",
                            deadline: new Date(
                                Date.now() + 24 * 60 * 60 * 1000,
                            ).toISOString(),
                            quoteWaitingTimeMs: isDryRun ? 3000 : 5000,
                        },
                        isDryRun,
                    );
                }

                if (!quote) return null;

                if (isDryRun) {
                    form.setValue(
                        "receiveAmount",
                        quote.quote.amountOutFormatted,
                    );
                    form.clearErrors("receiveAmount");
                    return { quote };
                }

                let intent: GenerateIntentResponse;

                if (USE_MOCK_QUOTES) {
                    // PoC: build a mock intent based on captured real data
                    const message = JSON.stringify({
                        deadline: quote.quote.deadline,
                        intents: [{
                            intent: "transfer",
                            receiver_id: quote.quote.depositAddress,
                            tokens: { [originAsset]: parsedAmount },
                        }],
                        signer_id: selectedTreasury,
                    });

                    intent = {
                        intent: {
                            standard: "nep413",
                            payload: {
                                message,
                                nonce: "Vij2xgAlKBKzgB67tZAvnxgPVIiJkIBxtPcWOQPg6MM=", // mock nonce
                                recipient: "intents.near",
                            },
                        },
                        correlationId: quote.correlationId,
                    };
                } else {
                    // Real API call
                    intent = await generateIntent({
                        type: "SWAP_TRANSFER",
                        standard: "nep413",
                        depositAddress: quote.quote.depositAddress,
                        signerId: selectedTreasury,
                    });
                }

                // Store both for proposal building
                form.setValue(
                    "proposalData" as any,
                    { quote, intent },
                    { shouldValidate: false },
                );

                return { quote, intent };
            } catch (error: any) {
                console.error("Error fetching confidential quote:", error);
                if (isDryRun) {
                    form.setError("receiveAmount", {
                        type: "manual",
                        message:
                            error?.message || "Failed to get confidential quote",
                    });
                }
                return null;
            }
        },
        enabled,
        refetchInterval,
        refetchIntervalInBackground: false,
    });
}

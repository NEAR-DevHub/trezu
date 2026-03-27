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

                const originAsset =
                    token.address === "near"
                        ? "near"
                        : `nep141:${token.address}`;

                const quote = await getIntentsQuote(
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

                if (!quote) return null;

                if (isDryRun) {
                    form.setValue(
                        "receiveAmount",
                        quote.quote.amountOutFormatted,
                    );
                    form.clearErrors("receiveAmount");
                    return { quote };
                }

                // Generate the intent payload (stored by the backend for auto-submission)
                const intent = await generateIntent({
                    type: "SWAP_TRANSFER",
                    standard: "nep413",
                    depositAddress: quote.quote.depositAddress,
                    signerId: selectedTreasury,
                });

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
                            error?.message ||
                            "Failed to get confidential quote",
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

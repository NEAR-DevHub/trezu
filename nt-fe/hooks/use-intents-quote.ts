"use client";

import { useCallback, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { useQuery } from "@tanstack/react-query";
import { getAddressPattern } from "@/lib/address-validation";
import Big from "@/lib/big";
import { getBlockchainType } from "@/lib/blockchain-utils";
import { isValidNearAddressFormat } from "@/lib/near-validation";
import { getIntentsQuote, type IntentsQuoteResponse } from "@/lib/api";
import { nanosToMs } from "@/lib/utils";
import type { Token } from "@/components/token-input";
import { isIntentsToken } from "@/lib/intents-fee";

function isAddressValidForToken(address: string, token: Token): boolean {
    if (!address) return false;
    const blockchain = getBlockchainType(token.network);
    if (blockchain === "near") return isValidNearAddressFormat(address);
    if (blockchain === "unknown") return true;
    const pattern = getAddressPattern(blockchain);
    return pattern ? pattern.test(address) : true;
}

export function buildIntentsQuoteRequest(
    treasuryId: string,
    token: Token,
    address: string,
    parsedAmount: string,
    isConfidential: boolean,
    proposalPeriod?: string,
) {
    const deadlineMs = proposalPeriod
        ? nanosToMs(proposalPeriod)
        : 24 * 60 * 60 * 1000;

    const depositType = isConfidential
        ? ("CONFIDENTIAL_INTENTS" as const)
        : ("INTENTS" as const);

    return {
        daoId: treasuryId,
        swapType: "EXACT_INPUT",
        slippageTolerance: 0,
        originAsset: token.address,
        depositType,
        destinationAsset: token.address,
        amount: parsedAmount,
        refundTo: treasuryId,
        refundType: depositType,
        recipient: address,
        recipientType: isConfidential
            ? "CONFIDENTIAL_INTENTS"
            : ("DESTINATION_CHAIN" as const),
        deadline: new Date(Date.now() + deadlineMs).toISOString(),
        quoteWaitingTimeMs: 0,
    };
}

function formatErrorMessage(
    message: string,
    tokenDecimals: number,
    tokenSymbol: string,
) {
    const lower = message.toLowerCase();

    if (
        lower.includes("amount is too low") ||
        lower.includes("at least ") ||
        lower.includes("increase the amount")
    ) {
        return message.replace(/at least (\d+)/i, (_, rawAmount) => {
            try {
                const formatted = Big(rawAmount)
                    .plus(1)
                    .div(Big(10).pow(tokenDecimals))
                    .toFixed()
                    .replace(/\.?0+$/, "");
                return `at least ${formatted} ${tokenSymbol}`;
            } catch {
                return `at least ${rawAmount}`;
            }
        });
    }

    if (lower.includes("no route") || lower.includes("no quote")) {
        return "No payment route found for this amount. Increase the amount or change token/network.";
    }

    return "Could not prepare a payment route right now. Please retry.";
}

interface UseIntentsQuoteParams {
    treasuryId: string | undefined;
    token: Token;
    amount: string;
    address: string;
    isConfidential: boolean;
    proposalPeriod?: string;
    feeErrorMessage?: string | null;
}

export function useIntentsQuote({
    treasuryId,
    token,
    amount,
    address,
    isConfidential,
    proposalPeriod,
    feeErrorMessage,
}: UseIntentsQuoteParams) {
    const isIntents = isIntentsToken(token);
    const [debouncedAddress] = useDebounce(address, 300);
    const [debouncedAmount] = useDebounce(amount, 400);
    const [isEnsuring, setIsEnsuring] = useState(false);

    const isRecipientReady =
        !!debouncedAddress && isAddressValidForToken(debouncedAddress, token);

    const parsedAmount = useMemo(() => {
        if (!debouncedAmount || Number(debouncedAmount) <= 0) return null;
        return Big(debouncedAmount).mul(Big(10).pow(token.decimals)).toFixed();
    }, [debouncedAmount, token.decimals]);

    const {
        data: quote,
        isLoading,
        isFetching,
        isError: hasError,
        error,
    } = useQuery({
        queryKey: [
            "paymentLiveQuote",
            treasuryId,
            token.address,
            debouncedAmount,
            debouncedAddress,
        ],
        queryFn: async (): Promise<IntentsQuoteResponse | null> => {
            if (!treasuryId || !parsedAmount) return null;
            return getIntentsQuote(
                buildIntentsQuoteRequest(
                    treasuryId,
                    token,
                    debouncedAddress,
                    parsedAmount,
                    isConfidential,
                    proposalPeriod,
                ),
                false,
            );
        },
        enabled:
            isIntents &&
            !!treasuryId &&
            isRecipientReady &&
            !!parsedAmount &&
            !!proposalPeriod &&
            !feeErrorMessage,
        refetchOnWindowFocus: false,
        retry: false,
    });

    const errorMessage = useMemo(() => {
        if (!hasError || !error) return null;
        const msg =
            error instanceof Error
                ? error.message
                : "Failed to prepare 1Click transfer route";
        return formatErrorMessage(msg, token.decimals, token.symbol);
    }, [hasError, error, token.decimals, token.symbol]);

    const isSyncPending =
        amount !== debouncedAmount || address !== debouncedAddress;

    const ensureBeforeReview = useCallback(
        async (formValues: {
            token: Token;
            address: string;
            amount: string;
        }): Promise<{
            ok: boolean;
            quote?: IntentsQuoteResponse | null;
            error?: string;
        }> => {
            if (!isIntents) return { ok: true };

            if (!treasuryId || !proposalPeriod) {
                return {
                    ok: false,
                    error: "Quote service is still initializing. Please try again.",
                };
            }

            if (feeErrorMessage) return { ok: false };

            if (quote && !isLoading && !isFetching && !isSyncPending) {
                return { ok: true, quote };
            }

            setIsEnsuring(true);
            try {
                const immediateParsed = Big(formValues.amount)
                    .mul(Big(10).pow(formValues.token.decimals))
                    .toFixed();

                const freshQuote = await getIntentsQuote(
                    buildIntentsQuoteRequest(
                        treasuryId,
                        formValues.token,
                        formValues.address,
                        immediateParsed,
                        isConfidential,
                        proposalPeriod,
                    ),
                    false,
                );

                if (!freshQuote) {
                    return {
                        ok: false,
                        error: "Could not prepare a payment route right now. Please retry.",
                    };
                }

                return { ok: true, quote: freshQuote };
            } catch (err) {
                const msg =
                    err instanceof Error
                        ? formatErrorMessage(
                              err.message,
                              formValues.token.decimals,
                              formValues.token.symbol,
                          )
                        : "Could not prepare a payment route right now. Please retry.";
                return { ok: false, error: msg };
            } finally {
                setIsEnsuring(false);
            }
        },
        [
            isIntents,
            treasuryId,
            proposalPeriod,
            feeErrorMessage,
            quote,
            isLoading,
            isFetching,
            isSyncPending,
            isConfidential,
        ],
    );

    return {
        quote,
        isLoading,
        isFetching,
        isEnsuring,
        isSyncPending,
        hasError,
        errorMessage,
        isIntents,
        ensureBeforeReview,
    };
}

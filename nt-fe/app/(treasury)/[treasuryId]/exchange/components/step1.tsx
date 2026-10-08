"use client";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { useCallback, useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { CreateRequestButton } from "@/components/create-request-button";
import { useFormatDate } from "@/components/formatted-date";
import { Icon } from "@/components/icon";
import { InfoAlert } from "@/components/info-alert";
import type { StepProps } from "@/components/step-wizard";
import { TokenInput } from "@/components/token-input";
import { SlotWarning } from "@/components/warning-message";
import { WRAP_NEAR_TOKEN_ID } from "@/constants/network-ids";
import type { BridgeAsset } from "@/hooks/use-bridge-tokens";
import {
    useStockMarketClock,
    useStockRegionRestricted,
} from "@/hooks/use-stock-restrictions";
import { useTreasury } from "@/hooks/use-treasury";
import { useBridgeScopedWarning } from "@/hooks/use-warnings";
import { trackEvent } from "@/lib/analytics";
import {
    isChainDeliveryRoute,
    isOffNearChainDelivery,
} from "@/lib/oneclick-asset-routing";
import { cn } from "@/lib/utils";
import { BTC_TOKEN, DRY_QUOTE_REFRESH_INTERVAL, ETH_TOKEN } from "../constants";
import type { ExchangeFormValues } from "../exchange-form";
import { useExchangeAmountQuote } from "../hooks/use-exchange-amount-quote";
import { SwapQuoteDetails } from "./swap-quote-details";

export function Step1({
    handleNext,
    bridgeAssets,
}: StepProps & { bridgeAssets: BridgeAsset[] }) {
    const tEx = useTranslations("exchange");
    const tCreate = useTranslations("createRequestButton");
    const form = useFormContext<ExchangeFormValues>();
    const { treasuryId: selectedTreasury, isConfidential } = useTreasury();

    const { blocked: exchangeSlotBlocked, scopedMessage: sendWarningMessage } =
        useBridgeScopedWarning(
            "exchange",
            bridgeAssets,
            form.watch("sellToken")?.address,
        );
    const { scopedMessage: receiveWarningMessage } = useBridgeScopedWarning(
        "exchange",
        bridgeAssets,
        form.watch("receiveToken")?.address,
    );

    const {
        sellToken,
        receiveToken,
        slippageTolerance,
        areSameTokens,
        hasValidAmount,
        quoteData,
        quoteError,
        isQuoteBusy,
        derivedAmount,
        isSellDerived,
        isReceiveDerived,
        onSellAmountInput,
        onReceiveAmountInput,
        onQuoteInputsChanged,
    } = useExchangeAmountQuote({
        form,
        selectedTreasury,
        isConfidential,
        exchangeSlotBlocked,
        isDryRun: true,
        refetchInterval: DRY_QUOTE_REFRESH_INTERVAL,
    });

    const tStock = useTranslations("stockRestrictions");
    const formatDate = useFormatDate();
    const stockRegionRestricted = useStockRegionRestricted();
    const market = useStockMarketClock();
    const isStockSwap =
        sellToken.assetClass === "stock" || receiveToken.assetClass === "stock";
    const marketHoursStock = [sellToken, receiveToken].find(
        (token) => token.marketHoursOnly,
    );
    const stockRegionBlocked = isStockSwap && stockRegionRestricted;
    const marketHoursNotice =
        !marketHoursStock || stockRegionBlocked
            ? null
            : market.isOpen || !market.reopensAt
              ? tStock("marketHours", { symbol: marketHoursStock.symbol })
              : tStock("marketClosed", {
                    symbol: marketHoursStock.symbol,
                    reopensAt: formatDate(market.reopensAt),
                });

    // Check if sell token is wNEAR (FT NEAR with Ft residency, not Intents)
    const isSellTokenFTNEAR =
        sellToken.address === WRAP_NEAR_TOKEN_ID &&
        sellToken.residency === "Ft";

    // Filter function for receive token
    const filterReceiveTokens = useCallback(
        (token: {
            address: string;
            symbol: string;
            network: string;
            residency?: string;
        }) => {
            // Confidential treasury: only show intents tokens
            if (isConfidential) {
                return token.residency === "Intents";
            }
            // Hide native NEAR unless selling FT NEAR (for unwrapping)
            if (token.residency === "Near") {
                return isSellTokenFTNEAR;
            }
            // FT NEAR and Intents NEAR are always visible
            return true;
        },
        [isSellTokenFTNEAR, isConfidential],
    );

    // Filter function for sell token - confidential treasury only shows intents tokens
    const filterSellTokens = useCallback(
        (token: {
            address: string;
            symbol: string;
            network: string;
            residency?: string;
        }) => {
            if (isConfidential) {
                return token.residency === "Intents";
            }
            return true;
        },
        [isConfidential],
    );

    // Reset receive token if it's no longer valid based on filter
    useEffect(() => {
        const isReceiveTokenValid =
            filterReceiveTokens({
                address: receiveToken.address,
                symbol: receiveToken.symbol,
                network: receiveToken.network,
                residency: receiveToken.residency,
            }) &&
            !isOffNearChainDelivery({
                id: receiveToken.address,
                balanceAssetId: receiveToken.balanceAssetId,
                quoteAssetId: receiveToken.quoteAssetId,
            });

        if (!isReceiveTokenValid) {
            if (
                isOffNearChainDelivery({
                    id: receiveToken.address,
                    balanceAssetId: receiveToken.balanceAssetId,
                    quoteAssetId: receiveToken.quoteAssetId,
                })
            ) {
                toast.info(tEx("chainDeliveryUnsupported"), {
                    id: "chain-delivery-unsupported",
                });
            }
            // Reset to a default valid token (ETH or first available)
            form.setValue("receiveToken", ETH_TOKEN);
            onQuoteInputsChanged();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- form.setValue is stable
    }, [
        isSellTokenFTNEAR,
        receiveToken.address,
        receiveToken.balanceAssetId,
        receiveToken.quoteAssetId,
        receiveToken.symbol,
        receiveToken.network,
        receiveToken.residency,
        filterReceiveTokens,
        onQuoteInputsChanged,
        tEx,
    ]);

    // A chain-delivery sell row repeats a held balance under another network
    // (ZEC on NEAR, NEAR on Solana). The flip button can still put one here
    // from the receive side, so fall back to BTC.
    useEffect(() => {
        if (
            !isChainDeliveryRoute({
                id: sellToken.address,
                balanceAssetId: sellToken.balanceAssetId,
                quoteAssetId: sellToken.quoteAssetId,
            })
        ) {
            return;
        }
        toast.info(tEx("chainDeliveryUnsupported"), {
            id: "chain-delivery-unsupported",
        });
        form.setValue("sellToken", BTC_TOKEN);
        onQuoteInputsChanged();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- form.setValue is stable
    }, [
        sellToken.address,
        sellToken.balanceAssetId,
        sellToken.quoteAssetId,
        onQuoteInputsChanged,
        tEx,
    ]);

    // Validate tokens when they change
    useEffect(() => {
        form.trigger(["sellToken", "receiveToken"]);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- form.trigger is stable
    }, [
        sellToken.address,
        receiveToken.address,
        sellToken.network,
        receiveToken.network,
    ]);

    const handleContinue = () => {
        form.trigger().then((isValid) => {
            if (isValid && handleNext && quoteData && !quoteError) {
                handleNext();
            }
        });
    };

    const handleSwapTokens = () => {
        // Swap sell and receive tokens
        const tempSellToken = { ...sellToken };
        const tempReceiveToken = { ...receiveToken };
        const sellAmount = form.getValues("sellAmount") || "";
        const receiveAmount = form.getValues("receiveAmount") || "";
        // Prefer former receive as the new sell input; fall back to sell if empty.
        const nextSellAmount = receiveAmount || sellAmount;

        form.setValue("sellToken", tempReceiveToken);
        form.setValue("receiveToken", tempSellToken);
        form.setValue("sellAmount", nextSellAmount);
        // Clear receive — it will be re-quoted as exact-input.
        form.setValue("receiveAmount", "");
        form.setValue("amountMode", "EXACT_INPUT");
    };

    return (
        <>
            <SlotWarning slot="exchange" />
            <div className="flex flex-col gap-2">
                {/* The flip button hangs off the sell card's bottom edge so a
                    warning growing the card can't shift it out of the gap. */}
                <div className="relative">
                    <TokenInput
                        control={form.control}
                        amountName="sellAmount"
                        tokenName="sellToken"
                        variant="swapCard"
                        enableUsdToggle
                        showInsufficientBalance={true}
                        dynamicFontSize={true}
                        readOnly={isSellDerived && isQuoteBusy}
                        loading={isSellDerived && isQuoteBusy}
                        customValue={
                            isSellDerived && isQuoteBusy
                                ? (derivedAmount ?? "")
                                : undefined
                        }
                        tokenSelect={{
                            filterTokens: filterSellTokens,
                            autoSelect: false,
                            hideOffNearChainDelivery: true,
                            hideChainDeliveryRoutes: true,
                            stocks: "held",
                        }}
                        usdValueOverride={
                            quoteData?.quote
                                ? Number(quoteData.quote.amountInUsd) || 0
                                : null
                        }
                        errorMessage={isSellDerived ? quoteError : null}
                        warningMessage={sendWarningMessage}
                        onAmountInput={onSellAmountInput}
                        onMaxSet={() => {
                            trackEvent("sell_max", {
                                treasury_id: selectedTreasury,
                            });
                            onSellAmountInput();
                        }}
                        onTokenChange={onQuoteInputsChanged}
                    />
                    <div className="absolute bottom-0 left-1/2 z-10 -translate-x-1/2 translate-y-1/2">
                        <Button
                            type="button"
                            variant="unstyled"
                            className={cn(
                                "size-8 rounded-lg border border-general-border p-0 shadow-sm",
                                !isQuoteBusy &&
                                    "bg-card text-muted-foreground hover:bg-card",
                            )}
                            onClick={handleSwapTokens}
                            loading={isQuoteBusy}
                        >
                            {isQuoteBusy ? null : (
                                <Icon icon={ArrowDown01Icon} />
                            )}
                        </Button>
                    </div>
                </div>
                <TokenInput
                    control={form.control}
                    amountName="receiveAmount"
                    tokenName="receiveToken"
                    variant="swapCard"
                    enableUsdToggle
                    readOnly={isReceiveDerived && isQuoteBusy}
                    loading={isReceiveDerived && isQuoteBusy}
                    customValue={
                        isReceiveDerived && isQuoteBusy
                            ? (derivedAmount ?? "")
                            : undefined
                    }
                    dynamicFontSize={true}
                    tokenSelect={{
                        filterTokens: filterReceiveTokens,
                        showPopularAssets: true,
                        autoSelect: false,
                        hideOffNearChainDelivery: true,
                        stocks: "browse",
                    }}
                    usdValueOverride={
                        quoteData?.quote
                            ? Number(quoteData.quote.amountOutUsd) || 0
                            : null
                    }
                    errorMessage={isReceiveDerived ? quoteError : null}
                    warningMessage={receiveWarningMessage}
                    onAmountInput={onReceiveAmountInput}
                    onMaxSet={() => {
                        trackEvent("receive_max", {
                            treasury_id: selectedTreasury,
                        });
                        onReceiveAmountInput();
                    }}
                    onTokenChange={onQuoteInputsChanged}
                />
            </div>

            {stockRegionBlocked && (
                <InfoAlert message={tStock("createRegion")} />
            )}
            {marketHoursNotice && <InfoAlert message={marketHoursNotice} />}

            <CreateRequestButton
                onClick={handleContinue}
                className="w-full h-12"
                permissions={[{ kind: "call", action: "AddProposal" }]}
                disabled={
                    areSameTokens ||
                    !hasValidAmount ||
                    !quoteData ||
                    !!quoteError ||
                    exchangeSlotBlocked ||
                    stockRegionBlocked
                }
                idleMessage={
                    exchangeSlotBlocked
                        ? tCreate("brieflyUnavailable")
                        : stockRegionBlocked
                          ? tStock("unavailableInRegion")
                          : areSameTokens
                            ? tEx("disabled.differentTokens")
                            : !hasValidAmount
                              ? tEx("disabled.enterAmount")
                              : tEx("review")
                }
            />

            {quoteData?.quote ? (
                <SwapQuoteDetails
                    quote={quoteData.quote}
                    sellToken={sellToken}
                    receiveToken={receiveToken}
                    slippageTolerance={slippageTolerance}
                    onSlippageChange={(value) => {
                        form.setValue("slippageTolerance", value);
                        onQuoteInputsChanged();
                    }}
                />
            ) : null}
        </>
    );
}

"use client";
import {
    ArrowDown01Icon,
    ArrowLeft01Icon,
    InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { NEAR_NETWORK_ID } from "@/constants/network-ids";
import {
    iconTintVars,
    useIconAccentColor,
} from "@/hooks/use-icon-accent-color";
import {
    type MergedNetwork,
    type MergedToken,
    useMergedTokens,
} from "@/hooks/use-merged-tokens";
import { useScrollOverflow } from "@/hooks/use-scroll-overflow";
import { usePopularAssetsByActivity } from "@/hooks/use-treasury-queries";
import { decimalFromBaseUnitsOrNull } from "@/lib/amount-format";
import type { ChainIcons } from "@/lib/api";
import Big from "@/lib/big";
import {
    getLocalizedNetworkDisplayName,
    getNetworkDisplayCaseClass,
    getNetworkDisplayName,
} from "@/lib/intents-network";
import {
    isChainDeliveryRoute,
    isOffNearChainDelivery,
} from "@/lib/oneclick-asset-routing";
import { pickDefaultSelectedToken } from "@/lib/pick-default-token";
import {
    canonicalizeTokenIdForMatch,
    cn,
    formatBalance,
    formatCurrencyWithSubCent,
    formatSmartAmount,
} from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Dialog, DialogHeader, DialogTitle, DialogTrigger } from "./modal";
import {
    PaymentSelectModalContent,
    PaymentSelectSearchRail,
} from "./payment-select-modal-content";
import { Pill } from "./pill";
import { PopularTokenTiles } from "./popular-token-tiles";
import { ScrollContainer } from "./scroll-container";
import { SelectListIcon } from "./select-list";
import {
    EmptySelectorIcon,
    paymentSelectModalListClassName,
    paymentSelectModalSearchInputClassName,
    paymentSelectModalSectionClassName,
    selectorTriggerClassName,
} from "./selector-field";
import {
    SelectorOptionBalance,
    SelectorOptionRow,
} from "./selector-option-row";
import { TokenDisplay } from "./token-display-with-network";
import { Tooltip } from "./tooltip";
import { Skeleton } from "./ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "./underline-tabs";

const TOKEN_SKELETON_IDS = ["one", "two", "three", "four"] as const;

const ASSET_TAB_TRIGGER_CLASS =
    "px-0 pt-1 pb-3 text-lg font-semibold md:text-lg data-[state=active]:after:h-[2px] data-[state=active]:after:bg-foreground";

function residencyDescription(
    residency: string | undefined,
    tResidency: (key: string) => string,
): string | null {
    if (!residency) return null;
    switch (residency) {
        case "Lockup":
            return tResidency("vestedToken");
        case "Staked":
            return tResidency("staked");
        case "Ft":
            return tResidency("fungibleToken");
        case "Near":
            return tResidency("nativeToken");
        default:
            return tResidency("intentsToken");
    }
}

// Selected token (asset + specific network)
export interface SelectedTokenData {
    address: string;
    symbol: string;
    decimals: number;
    name: string;
    icon: string;
    network: string;
    chainIcons?: ChainIcons;
    residency?: string;
    minWithdrawalAmount?: string;
    minDepositAmount?: string;
    balance?: string;
    price?: number;
    balanceDecimals?: number;
    balanceAssetId?: string;
    quoteAssetId?: string;
    assetClass?: "stock";
    marketHoursOnly?: boolean;
}

interface TokenSelectProps {
    selectedToken: SelectedTokenData | null;
    setSelectedToken: (token: SelectedTokenData) => void;
    disabled?: boolean;
    locked?: boolean;
    classNames?: {
        trigger?: string;
        icon?: string;
        symbol?: string;
    };
    lockedTokenData?: SelectedTokenData;
    /**
     * When true, only shows tokens that the user owns (has balance > 0).
     * When false, shows all tokens (treasury + bridge tokens).
     * Default: false (show all assets)
     */
    showOnlyOwnedAssets?: boolean;
    /**
     * Size of the token icon in the trigger button.
     * Options: "sm" | "md" | "lg"
     * Default: "md"
     */
    iconSize?: "sm" | "md" | "lg" | "xl" | "2xl";
    /** Optional field label used by card-style selector triggers. */
    triggerLabel?: string;
    /**
     * Optional filter function to exclude specific tokens from the list.
     * Return true to include the token, false to exclude it.
     */
    filterTokens?: (token: {
        address: string;
        symbol: string;
        network: string;
        residency?: string;
    }) => boolean;
    showPopularAssets?: boolean;
    disableTokenMessage?: string;
    disableTokens?: (token: {
        address: string;
        symbol: string;
        network: string;
        residency?: string;
    }) => boolean;
    /**
     * When true (default), auto-picks the highest-USD owned asset from the
     * assets cache, else USDC on NEAR. Set false for Exchange (and any flow
     * that seeds its own tokens).
     */
    autoSelect?: boolean;
    /**
     * Hide chain-delivery networks that need a non-NEAR address (Solana,
     * Hyperliquid, BNB, and the rest). Swap sets this. Send leaves it off.
     */
    hideOffNearChainDelivery?: boolean;
    /**
     * Hide every chain-delivery network, including ones that deliver on NEAR.
     * Those rows repeat a balance the treasury already holds. Send sets this
     * so the token network is only the real holding. The recipient network
     * picker still lists them.
     */
    hideChainDeliveryRoutes?: boolean;
    /** Balance column layout on asset rows. */
    balanceLayout?: "usdPrimary" | "tokenPrimary";
    /** Hide network subtitle under the trigger symbol. */
    hideNetworkSubtitle?: boolean;
    /** Full-width labeled card trigger (Send redesign). */
    appearance?: "default" | "card";
    /**
     * Tints the trigger with the selected icon's dominant colour (Swap pills).
     * Falls back to the trigger's own background for icons whose colour cannot
     * be read — monochrome art, or a host that serves no CORS headers.
     */
    tintTriggerFromIcon?: boolean;
    /**
     * Stocks are hidden unless set: like near.com, they can be swapped but not
     * sent or withdrawn. `held` lists the ones the treasury holds (Swap sell
     * side). `browse` loads every stock and shows All / Stocks tabs (Swap
     * receive side).
     */
    stocks?: TokenSelectStocks;
}

export type TokenSelectStocks = "held" | "browse";

export default function TokenSelect({
    selectedToken,
    setSelectedToken,
    disabled,
    locked,
    lockedTokenData,
    disableTokenMessage,
    disableTokens,
    classNames,
    showOnlyOwnedAssets = false,
    iconSize = "md",
    triggerLabel,
    filterTokens,
    showPopularAssets = false,
    autoSelect = true,
    hideOffNearChainDelivery = false,
    hideChainDeliveryRoutes = false,
    balanceLayout = "tokenPrimary",
    hideNetworkSubtitle = false,
    appearance = "default",
    tintTriggerFromIcon = false,
    stocks,
}: TokenSelectProps) {
    const stocksAllowed = stocks !== undefined;
    const showStockTabs = stocks === "browse";
    const t = useTranslations("tokenSelectDialog");
    const tDepositSections = useTranslations("depositModal.sections");
    const tResidency = useTranslations("residency");
    const tAddressBookTable = useTranslations("addressBookTable");
    const iconAccent = useIconAccentColor(
        tintTriggerFromIcon ? selectedToken?.icon : null,
    );
    const iconTint = iconTintVars(iconAccent);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedAsset, setSelectedAsset] = useState<MergedToken | null>(
        null,
    );
    const [step, setStep] = useState<"token" | "network">("token");
    const [assetTab, setAssetTab] = useState<"all" | "stocks">("all");
    const { viewportRef, hasContentAbove } = useScrollOverflow();
    const { data: popularAssets = [] } = usePopularAssetsByActivity(
        showPopularAssets && open && step === "token",
    );

    const { tokens, isLoading, isAssetsReady } = useMergedTokens({
        // Fetch while auto-selecting even if the modal is closed, so the
        // highest-USD default (and USDC fallback) can resolve immediately.
        enabled: !showOnlyOwnedAssets && (open || autoSelect),
        showOnlyOwned: showOnlyOwnedAssets,
        catalogKind: showStockTabs ? "swap-stocks" : "swap",
    });

    // Wait for assets cache/fetch before picking — avoids flashing USDC then
    // swapping to the highest-USD owned token when holdings arrive.
    useEffect(() => {
        if (!autoSelect || locked || selectedToken || !isAssetsReady) return;

        setSelectedToken(
            pickDefaultSelectedToken(
                stocksAllowed
                    ? tokens
                    : tokens.filter((token) => token.assetClass !== "stock"),
                {
                    disableTokens: (candidate) => {
                        if (disableTokens?.(candidate)) return true;
                        // Respect list filters (e.g. confidential intents-only).
                        if (filterTokens && !filterTokens(candidate))
                            return true;
                        return false;
                    },
                },
            ),
        );
    }, [
        autoSelect,
        isAssetsReady,
        tokens,
        selectedToken,
        locked,
        setSelectedToken,
        disableTokens,
        filterTokens,
        stocksAllowed,
    ]);

    // Source-agnostic list for rendering/selecting. The network filter runs
    // Big.js math per network, so it is kept out of the search memo — otherwise
    // every keystroke re-totals the whole bridge catalog.
    const selectableTokens = useMemo(() => {
        const applyNetworkFilter = (t: MergedToken): MergedToken | null => {
            if (
                !filterTokens &&
                !hideOffNearChainDelivery &&
                !hideChainDeliveryRoutes
            ) {
                return t;
            }
            const filtered = t.networks.filter((n) => {
                if (hideChainDeliveryRoutes && isChainDeliveryRoute(n)) {
                    return false;
                }
                if (hideOffNearChainDelivery && isOffNearChainDelivery(n)) {
                    return false;
                }
                if (!filterTokens) return true;
                return filterTokens({
                    address: n.id,
                    symbol: n.symbol,
                    network: n.name,
                    residency: n.residency,
                });
            });
            if (filtered.length === 0) return null;
            let totalBalance = 0;
            let totalBalanceUSD = 0;
            // Chain-delivery rows repeat a sibling holding. Count that holding
            // once, preferring the real balance row over the copies.
            const claimedHoldings = new Set<string>();
            const ordered = [
                ...filtered.filter((n) => !isChainDeliveryRoute(n)),
                ...filtered.filter((n) => isChainDeliveryRoute(n)),
            ];
            for (const n of ordered) {
                const holdingKey = (n.balanceAssetId || n.id).toLowerCase();
                if (claimedHoldings.has(holdingKey)) continue;
                claimedHoldings.add(holdingKey);
                totalBalanceUSD += n.balanceUSD ?? 0;
                const decimals = n.balanceDecimals ?? n.decimals;
                try {
                    totalBalance += Big(n.balance || "0")
                        .div(Big(10).pow(decimals))
                        .toNumber();
                } catch {
                    /* skip */
                }
            }
            return {
                ...t,
                networks: filtered,
                totalBalance,
                totalBalanceUSD,
            };
        };

        const selectable: { token: MergedToken; haystack: string }[] = [];

        for (const token of tokens) {
            if (!stocksAllowed && token.assetClass === "stock") continue;
            const filtered = applyNetworkFilter(token);
            if (!filtered) continue;
            // Built from the unfiltered token, matching the original search
            // behaviour. The NUL separator stops a query from matching across
            // two adjacent fields.
            selectable.push({
                token: filtered,
                haystack: [
                    token.id,
                    token.name,
                    token.symbol,
                    ...token.networks.map((n) => n.symbol),
                ]
                    .join("\u0000")
                    .toLowerCase(),
            });
        }

        return selectable;
    }, [
        tokens,
        filterTokens,
        hideOffNearChainDelivery,
        hideChainDeliveryRoutes,
        stocksAllowed,
    ]);

    const filteredTokens = useMemo(() => {
        const searchLower = search.toLowerCase();

        const stocksOnly = showStockTabs && assetTab === "stocks";

        return selectableTokens
            .filter(
                ({ token, haystack }) =>
                    haystack.includes(searchLower) &&
                    (!stocksOnly || token.assetClass === "stock"),
            )
            .map(({ token }) => token);
    }, [selectableTokens, search, showStockTabs, assetTab]);

    const { yourAssets, otherAssets } = useMemo(() => {
        const yourAssetsFiltered = filteredTokens.filter(
            (token) => (token.totalBalance ?? 0) > 0,
        );
        const otherAssetsFiltered = filteredTokens.filter(
            (token) => (token.totalBalance ?? 0) <= 0,
        );

        return {
            yourAssets: yourAssetsFiltered,
            otherAssets: otherAssetsFiltered,
        };
    }, [filteredTokens]);

    const popularTokens = useMemo(() => {
        if (!showPopularAssets || popularAssets.length === 0) return [];

        const popularIds = new Set<string>();
        for (const asset of popularAssets) {
            popularIds.add(asset.tokenId.toLowerCase());
            popularIds.add(canonicalizeTokenIdForMatch(asset.tokenId));
        }

        return filteredTokens
            .filter((token) => {
                const tokenCandidates = new Set<string>([
                    token.id.toLowerCase(),
                    canonicalizeTokenIdForMatch(token.id),
                ]);
                for (const network of token.networks) {
                    tokenCandidates.add(network.id.toLowerCase());
                    tokenCandidates.add(
                        canonicalizeTokenIdForMatch(network.id),
                    );
                    tokenCandidates.add(network.chainId.toLowerCase());
                    tokenCandidates.add(
                        canonicalizeTokenIdForMatch(network.chainId),
                    );
                }

                for (const candidate of tokenCandidates) {
                    if (popularIds.has(candidate)) {
                        return true;
                    }
                }
                return false;
            })
            .slice(0, 8);
    }, [showPopularAssets, popularAssets, filteredTokens]);

    const networkItems = useMemo((): MergedNetwork[] => {
        if (!selectedAsset) return [];

        return [...selectedAsset.networks].sort((a, b) => {
            const aUSD = a.balanceUSD ?? 0;
            const bUSD = b.balanceUSD ?? 0;
            if (aUSD > 0 !== bUSD > 0) return bUSD > 0 ? 1 : -1;
            return bUSD - aUSD;
        });
    }, [selectedAsset]);

    const selectNetwork = useCallback(
        (asset: MergedToken, network: MergedNetwork) => {
            setSelectedToken({
                address: network.id,
                symbol: network.symbol,
                decimals: network.decimals,
                name: asset.name,
                icon: asset.icon || "",
                network: network.name,
                chainIcons:
                    asset.assetClass === "stock"
                        ? undefined
                        : network.chainIcons || undefined,
                residency: network.residency,
                minWithdrawalAmount: network.minWithdrawalAmount,
                minDepositAmount: network.minDepositAmount,
                balance: network.balance,
                price: network.price,
                balanceDecimals: network.balanceDecimals,
                balanceAssetId: network.balanceAssetId || network.id,
                quoteAssetId:
                    network.quoteAssetId ||
                    network.balanceAssetId ||
                    network.id,
                assetClass: asset.assetClass,
                marketHoursOnly: asset.marketHoursOnly,
            });

            setOpen(false);
            setSearch("");
            setStep("token");
            setSelectedAsset(null);
            setAssetTab("all");
        },
        [setSelectedToken],
    );

    const handleTokenClick = useCallback(
        (token: MergedToken) => {
            const stockNetwork =
                token.assetClass === "stock"
                    ? (token.networks.find((n) => n.residency === "Intents") ??
                      token.networks[0])
                    : undefined;
            if (stockNetwork) {
                selectNetwork(token, stockNetwork);
                return;
            }
            setSelectedAsset(token);
            setStep("network");
        },
        [selectNetwork],
    );

    const handleNetworkClick = useCallback(
        (network: MergedNetwork) => {
            if (!selectedAsset) return;
            selectNetwork(selectedAsset, network);
        },
        [selectedAsset, selectNetwork],
    );

    const handleBack = useCallback(() => {
        setStep("token");
        setSelectedAsset(null);
    }, []);

    const handleOpenChange = useCallback((newOpen: boolean) => {
        setOpen(newOpen);
        if (!newOpen) {
            setStep("token");
            setSelectedAsset(null);
            setSearch("");
            setAssetTab("all");
        }
    }, []);

    // Render locked state
    if (locked && lockedTokenData) {
        return (
            <div className="flex gap-2 items-center h-9 px-4 py-2 has-[>svg]:px-3 bg-card rounded-full cursor-default hover:bg-card hover:border-border">
                <TokenDisplay
                    symbol={lockedTokenData.symbol}
                    icon={lockedTokenData.icon}
                    chainIcons={lockedTokenData.chainIcons}
                />
                <div className="flex flex-col items-start">
                    <span className="font-semibold text-sm leading-none">
                        {lockedTokenData.symbol}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground uppercase">
                        {lockedTokenData.network}
                    </span>
                </div>
            </div>
        );
    }

    const renderTokenButton = (token: MergedToken) => {
        const isSelectedAsset = token.networks.some(
            (network) =>
                network.id === selectedToken?.address &&
                network.name === selectedToken?.network,
        );
        return (
            <SelectorOptionRow
                key={token.id}
                selected={isSelectedAsset}
                onClick={() => handleTokenClick(token)}
                icon={
                    <SelectListIcon
                        icon={token.icon}
                        alt={token.symbol || token.name}
                    />
                }
                primary={token.symbol || token.name}
                secondary={
                    token.name && token.name !== token.symbol
                        ? token.name
                        : null
                }
                highlightQuery={search}
                trailing={
                    token.totalBalance !== undefined &&
                    token.totalBalance > 0 ? (
                        <SelectorOptionBalance
                            primary={
                                balanceLayout === "usdPrimary"
                                    ? formatCurrencyWithSubCent(
                                          token.totalBalanceUSD || 0,
                                      )
                                    : formatSmartAmount(token.totalBalance)
                            }
                            secondary={
                                balanceLayout === "usdPrimary"
                                    ? formatSmartAmount(token.totalBalance)
                                    : `≈${formatCurrencyWithSubCent(
                                          token.totalBalanceUSD || 0,
                                      )}`
                            }
                        />
                    ) : undefined
                }
            />
        );
    };

    // Payments/bulk wait for assets before seeding — show a skeleton. Exchange already has a seeded token.
    const showDefaultLoading = !selectedToken && !isAssetsReady;
    const iconSkeletonClass =
        iconSize === "2xl"
            ? "size-10"
            : iconSize === "xl"
              ? "size-9"
              : iconSize === "lg"
                ? "size-6"
                : iconSize === "sm"
                  ? "size-4"
                  : "size-5";

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild disabled={disabled || showDefaultLoading}>
                {appearance === "card" ? (
                    <Button
                        type="button"
                        variant="unstyled"
                        disabled={disabled || showDefaultLoading}
                        className={cn(
                            selectorTriggerClassName,
                            (disabled || locked) && "opacity-60",
                            classNames?.trigger,
                        )}
                    >
                        {showDefaultLoading ? (
                            <div className="flex w-full items-center gap-3 min-w-0">
                                <Skeleton className="size-10 rounded-full shrink-0" />
                                <div className="flex flex-col gap-1 flex-1">
                                    <Skeleton className="h-3 w-12" />
                                    <Skeleton className="h-4 w-16" />
                                </div>
                            </div>
                        ) : (
                            <>
                                {selectedToken ? (
                                    <TokenDisplay
                                        symbol={selectedToken.symbol}
                                        icon={selectedToken.icon}
                                        chainIcons={selectedToken.chainIcons}
                                        iconSize="2xl"
                                    />
                                ) : (
                                    <EmptySelectorIcon />
                                )}
                                <span className="flex min-w-0 flex-1 flex-col items-start gap-px">
                                    <span className="text-sm font-medium leading-normal text-muted-foreground">
                                        {triggerLabel ?? t("selectToken")}
                                    </span>
                                    <span
                                        className={cn(
                                            "max-w-full truncate text-base font-semibold leading-tight",
                                            selectedToken
                                                ? "text-foreground"
                                                : "text-muted-foreground",
                                        )}
                                    >
                                        {selectedToken?.symbol ??
                                            t("selectToken")}
                                    </span>
                                </span>
                                <Icon
                                    icon={ArrowDown01Icon}
                                    className="ml-auto size-4 shrink-0 text-muted-foreground"
                                />
                            </>
                        )}
                    </Button>
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        style={iconTint}
                        className={cn(
                            "bg-card hover:bg-card hover:border-muted-foreground rounded-full py-1 px-3! justify-start",
                            classNames?.trigger,
                            iconTint &&
                                "bg-[var(--icon-tint)] hover:bg-[var(--icon-tint-hover)]",
                        )}
                    >
                        {showDefaultLoading ? (
                            // Same pattern as treasury-selector loading state.
                            <div className="flex items-center gap-2 min-w-0 h-9">
                                <Skeleton
                                    className={cn(
                                        "rounded-full shrink-0",
                                        classNames?.icon ?? iconSkeletonClass,
                                    )}
                                />
                                <div className="flex flex-col gap-1">
                                    <Skeleton className="h-3 w-16" />
                                    <Skeleton className="h-3 w-12" />
                                </div>
                            </div>
                        ) : selectedToken ? (
                            <>
                                <TokenDisplay
                                    symbol={selectedToken.symbol}
                                    icon={selectedToken.icon}
                                    chainIcons={selectedToken.chainIcons}
                                    iconSize={iconSize}
                                    className={classNames?.icon}
                                />
                                <div className="flex flex-col items-start gap-px">
                                    {triggerLabel && (
                                        <span className="text-sm font-medium leading-5 text-muted-foreground">
                                            {triggerLabel}
                                        </span>
                                    )}
                                    <span
                                        className={cn(
                                            "font-semibold",
                                            triggerLabel
                                                ? "text-base leading-tight"
                                                : "text-sm leading-none",
                                            classNames?.symbol,
                                        )}
                                    >
                                        {selectedToken.symbol}
                                    </span>
                                    {!triggerLabel &&
                                        !hideNetworkSubtitle &&
                                        selectedToken.assetClass !==
                                            "stock" && (
                                            <span className="text-xs font-normal text-muted-foreground uppercase">
                                                {selectedToken.network}
                                            </span>
                                        )}
                                </div>
                            </>
                        ) : (
                            <span className="text-muted-foreground">
                                {t("selectToken")}
                            </span>
                        )}
                        <Icon
                            icon={ArrowDown01Icon}
                            className="text-muted-foreground ml-auto"
                        />
                    </Button>
                )}
            </DialogTrigger>
            <PaymentSelectModalContent>
                <DialogHeader
                    centerTitle={false}
                    className="sticky top-0 border-0 pb-0 text-left"
                >
                    <div className="flex w-full items-center gap-2">
                        {step === "network" && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleBack}
                                type="button"
                            >
                                <Icon icon={ArrowLeft01Icon} />
                            </Button>
                        )}
                        <DialogTitle className="w-full text-left text-lg font-semibold">
                            {step === "token"
                                ? t("selectToken")
                                : t("selectNetwork")}
                        </DialogTitle>
                    </div>
                </DialogHeader>
                {step === "token" && (
                    <div className="mt-4 flex min-h-0 flex-1 flex-col sm:mt-0">
                        {showStockTabs && (
                            <div className="sticky top-0 z-10 -mx-4 shrink-0 bg-card px-4 mb-4">
                                <Tabs
                                    value={assetTab}
                                    onValueChange={(value) => {
                                        if (
                                            value === "all" ||
                                            value === "stocks"
                                        ) {
                                            setAssetTab(value);
                                        }
                                    }}
                                >
                                    <TabsList className="gap-5 border-general-border">
                                        <TabsTrigger
                                            value="all"
                                            className={ASSET_TAB_TRIGGER_CLASS}
                                        >
                                            {t("all")}
                                        </TabsTrigger>
                                        <TabsTrigger
                                            value="stocks"
                                            className={ASSET_TAB_TRIGGER_CLASS}
                                        >
                                            {t("stocks")}
                                            <Pill
                                                title={t("beta")}
                                                variant="info"
                                                className="rounded-full px-2 py-px text-xs font-medium leading-4"
                                            />
                                        </TabsTrigger>
                                    </TabsList>
                                </Tabs>
                            </div>
                        )}
                        <PaymentSelectSearchRail scrolled={hasContentAbove}>
                            <Input
                                placeholder={t("searchByName")}
                                search
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                inputClassName={
                                    paymentSelectModalSearchInputClassName
                                }
                            />
                        </PaymentSelectSearchRail>
                        {isLoading ? (
                            <div className="space-y-1 animate-pulse">
                                {TOKEN_SKELETON_IDS.map((skeletonId) => (
                                    <div
                                        key={skeletonId}
                                        className="flex w-full items-center gap-3 rounded-lg py-3"
                                    >
                                        <div className="size-10 shrink-0 rounded-full bg-general-unofficial-accent-0" />
                                        <div className="flex-1 space-y-2">
                                            <div className="h-4 w-24 rounded bg-general-unofficial-accent-0" />
                                            <div className="h-3 w-32 rounded bg-general-unofficial-accent-0" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <ScrollContainer
                                ref={viewportRef}
                                className={paymentSelectModalListClassName}
                            >
                                {showPopularAssets &&
                                    popularTokens.length > 0 && (
                                        <div className="mb-3">
                                            <div
                                                className={cn(
                                                    paymentSelectModalSectionClassName,
                                                    "text-sm",
                                                )}
                                            >
                                                {tDepositSections(
                                                    "popularAssets",
                                                )}
                                            </div>
                                            <PopularTokenTiles
                                                items={popularTokens}
                                                searchQuery={search}
                                                onSelect={handleTokenClick}
                                                isItemSelected={(token) =>
                                                    token.networks.some(
                                                        (network) =>
                                                            network.id ===
                                                                selectedToken?.address &&
                                                            network.name ===
                                                                selectedToken?.network,
                                                    )
                                                }
                                            />
                                        </div>
                                    )}

                                {yourAssets.length > 0 && (
                                    <div>
                                        <div
                                            className={cn(
                                                paymentSelectModalSectionClassName,
                                                "text-xs font-medium",
                                            )}
                                        >
                                            {t("yourAssets")}
                                        </div>
                                        {yourAssets.map(renderTokenButton)}
                                    </div>
                                )}

                                {otherAssets.length > 0 && (
                                    <div>
                                        <div
                                            className={cn(
                                                paymentSelectModalSectionClassName,
                                                "text-xs font-medium",
                                            )}
                                        >
                                            {t("otherAssets")}
                                        </div>
                                        {otherAssets.map(renderTokenButton)}
                                    </div>
                                )}

                                {filteredTokens.length === 0 && (
                                    <div className="text-center py-8 text-muted-foreground">
                                        {showOnlyOwnedAssets
                                            ? t("noTokensWithBalance")
                                            : t("noTokensFound")}
                                    </div>
                                )}
                            </ScrollContainer>
                        )}
                    </div>
                )}
                {step === "network" && selectedAsset && (
                    <div className="mt-4 flex min-h-0 flex-1 flex-col sm:mt-0">
                        <PaymentSelectSearchRail scrolled={hasContentAbove} />
                        <ScrollContainer
                            ref={viewportRef}
                            className={paymentSelectModalListClassName}
                        >
                            {(() => {
                                const hasBalance = (item: MergedNetwork) => {
                                    const decimals =
                                        item.balanceDecimals ?? item.decimals;
                                    if (
                                        !item.balance ||
                                        item.balance.trim() === "" ||
                                        decimals === undefined
                                    ) {
                                        return false;
                                    }

                                    return (
                                        decimalFromBaseUnitsOrNull(
                                            item.balance,
                                            decimals,
                                        )?.gt(0) ?? false
                                    );
                                };

                                const isComingSoon = (item: MergedNetwork) =>
                                    Boolean(
                                        disableTokens?.({
                                            address: item.id,
                                            symbol: item.symbol,
                                            network: item.name,
                                            residency: item.residency,
                                        }),
                                    );

                                const withBalance =
                                    networkItems.filter(hasBalance);
                                const withoutBalance = networkItems.filter(
                                    (item) => !hasBalance(item),
                                );

                                const supportedWithBalance = withBalance.filter(
                                    (item) => !isComingSoon(item),
                                );
                                const supportedWithoutBalance =
                                    withoutBalance.filter(
                                        (item) => !isComingSoon(item),
                                    );
                                const comingSoonNetworks = [
                                    ...withBalance.filter(isComingSoon),
                                    ...withoutBalance.filter(isComingSoon),
                                ];

                                const renderNetworkButton = (
                                    item: MergedNetwork,
                                    idx: number,
                                ) => {
                                    const isSelectedNetwork =
                                        item.id === selectedToken?.address &&
                                        item.name === selectedToken?.network;
                                    const isDisabled = disableTokens?.({
                                        address: item.id,
                                        symbol: item.symbol,
                                        network: item.name,
                                        residency: item.residency,
                                    });
                                    const networkDescription =
                                        item.name.toLowerCase() ===
                                        NEAR_NETWORK_ID
                                            ? residencyDescription(
                                                  item.residency,
                                                  tResidency,
                                              )
                                            : null;
                                    return (
                                        <SelectorOptionRow
                                            key={`${item.id}-${idx}`}
                                            selected={isSelectedNetwork}
                                            disabled={isDisabled}
                                            onClick={() =>
                                                handleNetworkClick(item)
                                            }
                                            icon={
                                                <SelectListIcon
                                                    icon={item.chainIcons?.icon}
                                                    alt={item.name}
                                                />
                                            }
                                            primary={getLocalizedNetworkDisplayName(
                                                {
                                                    networkName: item.name,
                                                    networkLabel:
                                                        tAddressBookTable(
                                                            "network",
                                                        ),
                                                    fallbackName:
                                                        getNetworkDisplayName(
                                                            item.name,
                                                        ),
                                                },
                                            )}
                                            secondary={networkDescription}
                                            primaryClassName={getNetworkDisplayCaseClass(
                                                item.name,
                                            )}
                                            trailing={
                                                hasBalance(item) ? (
                                                    <SelectorOptionBalance
                                                        primary={formatBalance(
                                                            item.balance ?? "0",
                                                            item.balanceDecimals ??
                                                                item.decimals ??
                                                                0,
                                                        )}
                                                        secondary={`≈${formatCurrencyWithSubCent(
                                                            item.balanceUSD ||
                                                                0,
                                                        )}`}
                                                    />
                                                ) : undefined
                                            }
                                        />
                                    );
                                };

                                return (
                                    <>
                                        {supportedWithBalance.length > 0 && (
                                            <div>
                                                <div
                                                    className={cn(
                                                        paymentSelectModalSectionClassName,
                                                        "text-xs font-medium",
                                                    )}
                                                >
                                                    {t("networksWithAssets")}
                                                </div>
                                                {supportedWithBalance.map(
                                                    renderNetworkButton,
                                                )}
                                            </div>
                                        )}

                                        {supportedWithoutBalance.length > 0 && (
                                            <div>
                                                <div
                                                    className={cn(
                                                        paymentSelectModalSectionClassName,
                                                        "text-xs font-medium",
                                                    )}
                                                >
                                                    {t("supportedNetworks")}
                                                </div>
                                                {supportedWithoutBalance.map(
                                                    renderNetworkButton,
                                                )}
                                            </div>
                                        )}

                                        {comingSoonNetworks.length > 0 && (
                                            <div>
                                                <div
                                                    className={cn(
                                                        paymentSelectModalSectionClassName,
                                                        "flex items-center gap-1.5 text-xs font-medium",
                                                    )}
                                                >
                                                    {t("comingSoon")}
                                                    {disableTokenMessage && (
                                                        <Tooltip
                                                            content={
                                                                disableTokenMessage
                                                            }
                                                            side="top"
                                                        >
                                                            <span className="inline-flex items-center justify-center">
                                                                <Icon
                                                                    icon={
                                                                        InformationCircleIcon
                                                                    }
                                                                    className="text-muted-foreground normal-case"
                                                                />
                                                            </span>
                                                        </Tooltip>
                                                    )}
                                                </div>
                                                {comingSoonNetworks.map(
                                                    renderNetworkButton,
                                                )}
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </ScrollContainer>
                    </div>
                )}
            </PaymentSelectModalContent>
        </Dialog>
    );
}

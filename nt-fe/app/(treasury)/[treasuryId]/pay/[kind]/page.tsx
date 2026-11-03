"use client";

import { Clock, Link2, Zap } from "lucide-react";
import Link from "next/link";
import {
    useParams,
    usePathname,
    useRouter,
    useSearchParams,
} from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import Logo from "@/components/icons/logo";
import { PageComponentLayout } from "@/components/page-component-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { NEAR_COM_NETWORK_ID } from "@/constants/network-ids";
import { NEAR_COM_ICON } from "@/constants/token";
import { ActivityStatusPill } from "@/features/activity/components/activity-status-pill";
import type { ActivityStatus } from "@/features/activity/utils/history-utils";
import { useTokenCatalog } from "@/hooks/use-bridge-tokens";
import { useConfidentialBridgeAddress } from "@/hooks/use-confidential-bridge-address";
import { useDepositTracker } from "@/hooks/use-deposit-tracker";
import { useTreasury } from "@/hooks/use-treasury";
import type { TrackedDeposit } from "@/lib/bridge-api";
import {
    buildNearComSendHref,
    NEAR_COM_SEND_INTERNAL_NETWORK,
    withNearComAddressPrefix,
} from "@/lib/nearcom-address";
import { useNear } from "@/stores/near-store";
import { DepositConfidentialSourceTabs } from "../../dashboard/components/deposit/deposit-confidential-source-tabs";
import { DepositPayTreasuryModal } from "../../dashboard/components/deposit/deposit-pay-treasury-modal";
import {
    DepositReceiveCard,
    DepositReceiveCardSkeleton,
} from "../../dashboard/components/deposit/deposit-receive-card";
import {
    buildExternalReceiveCopy,
    buildInternalReceiveCopy,
    resolveMinDepositCopy,
} from "../../dashboard/components/deposit/deposit-receive-copy";
import { DepositTrackerPanel } from "../../dashboard/components/deposit/deposit-tracker-panel";
import {
    resolveBridgeChainId,
    resolveBridgeQuoteAssetId,
    resolvePayWithTrezuNextStep,
    resolveSendTokenMeta,
} from "../../dashboard/components/deposit/deposit-transfer-resolve";
import { DepositTransferSummary } from "../../dashboard/components/deposit/deposit-transfer-summary";
import {
    buildPaymentsDeepLink,
    CHOOSE_PAYER_QUERY,
    getAbsoluteTransferUrl,
    parsePayShareKind,
    withChoosePayerParam,
    withoutChoosePayerParam,
} from "../../dashboard/components/deposit/deposit-transfer-url";
import type { ConfidentialOrigin } from "../../dashboard/components/deposit/deposit-types";
import { formatMinDepositDisplay } from "../../dashboard/components/deposit/format-min-deposit";

/** Public addresses are reusable: in-flight deposits seen this long before the page opened still count. */
const TRACKER_IN_FLIGHT_LOOKBACK_MS = 10 * 60 * 1000;

/** Header pill for the tracked deposits: processing beats failed beats completed. */
function trackerPillStatus(deposits: { status: string }[]): ActivityStatus {
    if (
        deposits.some(
            (d) => d.status !== "ledger_confirmed" && d.status !== "failed",
        )
    ) {
        return "pending";
    }
    if (deposits.every((d) => d.status === "failed")) return "failed";
    return null;
}

export default function PaySharePage() {
    const t = useTranslations("depositModal");
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const params = useParams<{ kind?: string }>();
    const { accountId, isInitializing } = useNear();
    const { treasuryId, config, treasuries, isConfidential, isLoading } =
        useTreasury();
    const resumedChoosePayerRef = useRef(false);
    const [pickerOpen, setPickerOpen] = useState(false);

    const kind = parsePayShareKind(params.kind);
    const shareId = searchParams.get("id") || "";
    const tokenId = searchParams.get("token") || "";
    const networkFromUrl = searchParams.get("network") || "";
    const shouldOpenPicker = searchParams.get(CHOOSE_PAYER_QUERY) === "1";
    const confidentialOrigin: ConfidentialOrigin =
        searchParams.get("source") === "nearcom" ? "nearcom" : "trezu";

    // Confidential wallet share links carry the treasury's reusable quote
    // address as `id` plus token + network; the chain address is re-derived
    // for the treasury. Links without a network predate the reusable address
    // and are no longer servable.
    const isConfidentialWalletShare = kind === "public" && isConfidential;
    const isReusableConfidentialShare =
        isConfidentialWalletShare && !!networkFromUrl;
    const isPublicTreasuryShare = kind === "public" && !isConfidential;

    const networkId = networkFromUrl;

    const isShareIncomplete =
        !kind ||
        (kind === "public" && (!shareId || (!isLoading && !networkFromUrl)));

    const setConfidentialOrigin = useCallback(
        (origin: ConfidentialOrigin) => {
            if (kind !== "confidential") return;
            const next = new URLSearchParams(searchParams.toString());
            next.set("source", origin);
            const qs = next.toString();
            router.replace(`${pathname}${qs ? `?${qs}` : ""}`, {
                scroll: false,
            });
        },
        [kind, searchParams, pathname, router],
    );

    useEffect(() => {
        if (!treasuryId) return;
        if (isShareIncomplete) {
            router.replace(`/${treasuryId}/dashboard/deposit`);
        }
    }, [treasuryId, isShareIncomplete, router]);

    const recipientDaoId = treasuryId || "";
    const treasuryDisplayName = config?.name || recipientDaoId;

    const { data: bridgeAssets = [] } = useTokenCatalog({
        enabled: kind === "public",
        kind: "deposit",
    });

    const bridgeChainId = useMemo(() => {
        if (!networkId) return null;
        return resolveBridgeChainId(bridgeAssets, networkId) || networkId;
    }, [bridgeAssets, networkId]);
    // Reusable links name the asset by catalog id in `token`; the backend
    // wants the routing id the modal used, which the network row carries.
    const reusableTokenId = useMemo(
        () => resolveBridgeQuoteAssetId(bridgeAssets, networkFromUrl),
        [bridgeAssets, networkFromUrl],
    );

    const {
        address: bridgeAddress,
        memo: bridgeMemo,
        hasFetched: bridgeQueryFetched,
    } = useConfidentialBridgeAddress({
        enabled:
            isReusableConfidentialShare && !!bridgeChainId && !!reusableTokenId,
        bridgeChainId,
        treasuryId,
        tokenId: reusableTokenId,
    });

    // Settled when the chain or token is missing, or the query finished.
    const hasFetchedBridge =
        !bridgeChainId || !reusableTokenId || bridgeQueryFetched;

    const sendTokenMeta = useMemo(
        () =>
            kind === "public"
                ? resolveSendTokenMeta(bridgeAssets, tokenId, networkId)
                : null,
        [kind, bridgeAssets, tokenId, networkId],
    );

    // Live deposit progress for the payer, scoped to the treasury's quote
    // address (confidential) or the bridge chain (public), from page open.
    const [pageShownAtMs] = useState(() => Date.now());
    const { deposits: visibleDeposits } = useDepositTracker({
        enabled:
            kind === "public" &&
            !isLoading &&
            (isConfidentialWalletShare ? !!shareId : !!bridgeChainId),
        accountId: treasuryId,
        chain: isPublicTreasuryShare ? bridgeChainId : null,
        quoteDepositAddress: isConfidentialWalletShare ? shareId : null,
        shownAtMs: pageShownAtMs,
        inFlightLookbackMs: TRACKER_IN_FLIGHT_LOOKBACK_MS,
    });
    const hasTrackedDeposits = visibleDeposits.length > 0;

    const isStatusLoading =
        kind === "public" &&
        (isLoading || (isReusableConfidentialShare && !hasFetchedBridge));

    const depositAddress =
        kind === "confidential"
            ? withNearComAddressPrefix(recipientDaoId)
            : isConfidentialWalletShare
              ? bridgeAddress || ""
              : shareId;

    const minDepositDisplay = useMemo(
        () =>
            formatMinDepositDisplay(
                sendTokenMeta?.minDepositAmount,
                sendTokenMeta?.decimals ?? 0,
            ),
        [sendTokenMeta?.minDepositAmount, sendTokenMeta?.decimals],
    );

    const isConfidentialShare = kind === "confidential";
    const isConfidentialNearcomShare =
        isConfidentialShare && confidentialOrigin === "nearcom";

    const receiveCard = useMemo(() => {
        if (isConfidentialShare) return buildInternalReceiveCopy(t);
        if (!isReusableConfidentialShare && !isPublicTreasuryShare) {
            return null;
        }
        const network = sendTokenMeta?.networkName || networkId;
        return buildExternalReceiveCopy(t, {
            symbol: sendTokenMeta?.symbol || tokenId,
            network,
            locale,
            minCopy: resolveMinDepositCopy({
                minDepositRaw: sendTokenMeta?.minDepositAmount,
                decimals: sendTokenMeta?.decimals ?? 0,
                priceUsd: null,
                minDepositDisplay,
                // Direct deposits land on the treasury account: no 1Click floor.
                usdFloor: !(isPublicTreasuryShare && shareId === treasuryId),
            }),
            centerIcon: sendTokenMeta?.chainIcons?.icon
                ? { icon: sendTokenMeta.chainIcons.icon, name: network }
                : null,
        });
    }, [
        isConfidentialShare,
        isReusableConfidentialShare,
        isPublicTreasuryShare,
        shareId,
        treasuryId,
        sendTokenMeta,
        tokenId,
        networkId,
        minDepositDisplay,
        locale,
        t,
    ]);

    const paymentPrefill = useMemo(() => {
        // near.com CTA opens near.com/home — no Trezu payments prefill.
        if (isConfidentialNearcomShare) return null;
        if (kind === "public") {
            // Exact ids for payments matching — not display names or JSON blobs.
            if (
                !depositAddress ||
                !sendTokenMeta?.assetId ||
                !sendTokenMeta?.networkId
            ) {
                return null;
            }
            return {
                address: depositAddress,
                token: sendTokenMeta.assetId,
                network: sendTokenMeta.networkId,
            };
        }
        if (!recipientDaoId) return null;
        // Confidential Trezu pays via near.com into the nearcom:-prefixed DAO id.
        return {
            address: withNearComAddressPrefix(recipientDaoId),
            networks: NEAR_COM_NETWORK_ID,
        };
    }, [
        isConfidentialNearcomShare,
        kind,
        depositAddress,
        sendTokenMeta,
        recipientDaoId,
    ]);

    const payWithTrezuFilter = useMemo(
        () => ({
            destinationTreasuryId: recipientDaoId,
            confidentialOnly:
                isConfidentialShare && !isConfidentialNearcomShare,
        }),
        [recipientDaoId, isConfidentialShare, isConfidentialNearcomShare],
    );

    const currentSharePath = withoutChoosePayerParam(
        `${pathname}?${searchParams.toString()}`,
    );

    const stripChoosePayerParam = useCallback(() => {
        if (!shouldOpenPicker) return;
        router.replace(currentSharePath, { scroll: false });
    }, [shouldOpenPicker, currentSharePath, router]);

    const goToPayerTreasury = useCallback(
        (payerTreasuryId: string) => {
            if (!paymentPrefill) {
                toast.error(t("transfer.payRequiresTreasury"));
                return;
            }
            stripChoosePayerParam();
            router.push(buildPaymentsDeepLink(payerTreasuryId, paymentPrefill));
        },
        [paymentPrefill, stripChoosePayerParam, router, t],
    );

    const continuePayWithTrezu = useCallback(() => {
        if (!paymentPrefill) {
            toast.error(t("transfer.payRequiresTreasury"));
            return;
        }

        const next = resolvePayWithTrezuNextStep(
            treasuries,
            payWithTrezuFilter,
        );
        if (next.kind === "create") {
            stripChoosePayerParam();
            router.push("/create");
            return;
        }
        if (next.kind === "pay") {
            goToPayerTreasury(next.payerTreasuryId);
            return;
        }
        setPickerOpen(true);
    }, [
        paymentPrefill,
        treasuries,
        payWithTrezuFilter,
        router,
        t,
        stripChoosePayerParam,
        goToPayerTreasury,
    ]);

    const payWithTrezuStep = useMemo(() => {
        if (!accountId || isInitializing || isLoading) return null;
        return resolvePayWithTrezuNextStep(treasuries, payWithTrezuFilter);
    }, [accountId, isInitializing, isLoading, treasuries, payWithTrezuFilter]);

    const showPicker =
        pickerOpen ||
        (shouldOpenPicker &&
            !!paymentPrefill &&
            payWithTrezuStep?.kind === "choose");

    useEffect(() => {
        if (!shouldOpenPicker || isInitializing || isLoading) return;
        if (!accountId || resumedChoosePayerRef.current) return;
        if (!paymentPrefill || !payWithTrezuStep) return;
        if (payWithTrezuStep.kind === "choose") return;

        resumedChoosePayerRef.current = true;
        continuePayWithTrezu();
    }, [
        shouldOpenPicker,
        accountId,
        isInitializing,
        isLoading,
        paymentPrefill,
        payWithTrezuStep,
        continuePayWithTrezu,
    ]);

    const handleCopyLink = async () => {
        const url = getAbsoluteTransferUrl(currentSharePath);
        try {
            await navigator.clipboard.writeText(url);
            toast.success(t("linkCopied"));
        } catch {
            toast.error(t("errors.fetchFailed"));
        }
    };

    // Card share icon: the native share sheet where there is one, else copy.
    const handleShareLink = async () => {
        if (typeof navigator.share !== "function") {
            await handleCopyLink();
            return;
        }
        try {
            await navigator.share({
                url: getAbsoluteTransferUrl(currentSharePath),
            });
        } catch {
            // Dismissed share sheet — nothing to report.
        }
    };

    const handlePayWithNearcom = () => {
        if (!recipientDaoId) return;
        window.open(
            buildNearComSendHref({
                network: NEAR_COM_SEND_INTERNAL_NETWORK,
                recipient: withNearComAddressPrefix(recipientDaoId),
            }),
            "_blank",
            "noopener,noreferrer",
        );
    };

    const handlePayWithTrezu = () => {
        if (!paymentPrefill) {
            toast.error(t("transfer.payRequiresTreasury"));
            return;
        }

        if (!accountId) {
            const returnTo = withChoosePayerParam(currentSharePath);
            router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
            return;
        }

        if (isLoading) return;
        continuePayWithTrezu();
    };

    const handlePayCta = () => {
        if (isConfidentialNearcomShare) {
            handlePayWithNearcom();
            return;
        }
        handlePayWithTrezu();
    };

    const handlePickerOpenChange = (open: boolean) => {
        setPickerOpen(open);
        if (!open) stripChoosePayerParam();
    };

    const handleSelectPayerTreasury = (payerTreasuryId: string) => {
        setPickerOpen(false);
        goToPayerTreasury(payerTreasuryId);
    };

    const pageTitle =
        kind === "confidential" || isConfidential
            ? t("transfer.titleConfidential")
            : t("transfer.title");

    if (isShareIncomplete) {
        return null;
    }

    return (
        <PageComponentLayout
            title={pageTitle}
            hideCollapseButton
            hideAppWarningBanner
            logo={
                <Link href="/">
                    <Logo size="sm" />
                </Link>
            }
        >
            <div className="flex justify-center w-full md:mt-4">
                <PageCard className="w-full max-w-150 gap-4">
                    {isStatusLoading ? (
                        <div data-testid="deposit-transfer-status-skeleton">
                            <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3 pb-3 border-b border-general-border mb-3">
                                <Skeleton className="h-7 w-56" />
                                <Skeleton className="h-6 w-36 rounded-full" />
                            </div>
                            <DepositReceiveCardSkeleton
                                tone={isConfidential ? "dark" : "light"}
                            />
                            <div className="space-y-2 mt-4">
                                <Skeleton className="h-10 w-full rounded-xl" />
                                <Skeleton className="h-10 w-full rounded-xl" />
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3 pb-3 border-b border-general-border mb-3">
                                <h1 className="font-semibold text-lg leading-snug">
                                    {pageTitle}
                                </h1>
                                {hasTrackedDeposits ? (
                                    <ActivityStatusPill
                                        status={trackerPillStatus(
                                            visibleDeposits,
                                        )}
                                        className="shrink-0 rounded-full px-2.5"
                                    />
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-general-orange-background-faded text-general-orange-foreground px-2.5 py-1 text-xs font-medium shrink-0">
                                        <Clock className="size-3.5" />
                                        {t("transfer.waitingForPayment")}
                                    </span>
                                )}
                            </div>

                            {kind === "confidential" && (
                                <DepositConfidentialSourceTabs
                                    value={confidentialOrigin}
                                    onChange={setConfidentialOrigin}
                                />
                            )}

                            <DepositTransferSummary
                                variant={
                                    kind === "public"
                                        ? "public"
                                        : "confidential"
                                }
                                sendTokenMeta={sendTokenMeta}
                                tokenId={tokenId}
                                networkId={networkId}
                                treasuryDisplayName={treasuryDisplayName}
                                treasuryLogo={config?.metadata?.flagLogo}
                                isConfidentialTreasury={isConfidential}
                            />

                            {receiveCard ? (
                                <DepositReceiveCard
                                    tone={isConfidential ? "dark" : "light"}
                                    title={receiveCard.title}
                                    subtitle={receiveCard.subtitle}
                                    address={depositAddress}
                                    memo={bridgeMemo}
                                    addressLabel={receiveCard.addressLabel}
                                    preferPlainAddress={
                                        receiveCard.preferPlainAddress
                                    }
                                    centerIcon={receiveCard.centerIcon}
                                    qrLabel={receiveCard.qrLabel}
                                    onShare={handleShareLink}
                                    notices={receiveCard.notices}
                                />
                            ) : null}
                            {hasTrackedDeposits ? (
                                <DepositTrackerPanel
                                    deposits={visibleDeposits}
                                    assetIcon={sendTokenMeta?.icon}
                                    assetName={sendTokenMeta?.symbol}
                                    theme={isConfidential ? "dark" : "light"}
                                />
                            ) : null}

                            {
                                <div className="space-y-2">
                                    <Button
                                        type="button"
                                        onClick={handlePayCta}
                                        className="w-full gap-2"
                                        data-testid={
                                            isConfidentialNearcomShare
                                                ? "deposit-pay-with-nearcom"
                                                : "deposit-pay-with-trezu"
                                        }
                                    >
                                        {isConfidentialNearcomShare ? (
                                            <img
                                                src={NEAR_COM_ICON}
                                                alt=""
                                                className="size-4 rounded"
                                            />
                                        ) : (
                                            <Zap className="size-4 fill-current" />
                                        )}
                                        {isConfidentialNearcomShare
                                            ? t("transfer.payWithNearcom")
                                            : t("transfer.payWithTrezu")}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={handleCopyLink}
                                        className="w-full gap-2"
                                        data-testid="deposit-copy-link"
                                    >
                                        <Link2 className="size-4" />
                                        {t("transfer.copyLink")}
                                    </Button>
                                </div>
                            }
                        </>
                    )}
                </PageCard>
            </div>

            {!isConfidentialNearcomShare && (
                <DepositPayTreasuryModal
                    open={showPicker}
                    onOpenChange={handlePickerOpenChange}
                    treasuries={treasuries}
                    excludeTreasuryId={recipientDaoId}
                    confidentialOnly={isConfidentialShare}
                    isLoading={Boolean(accountId) && isLoading}
                    onSelect={handleSelectPayerTreasury}
                />
            )}
        </PageComponentLayout>
    );
}
